-- Idempotent registration, resume, credential consumption, expiry, and registration limits.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(41);

-- Clean slate for this transaction only (rolled back at the end).
truncate public.visitor_sessions, public.prize_awards cascade;
delete from private.rate_limit_buckets;

create function pg_temp.h(p_label text) returns text
language sql immutable
as $$ select encode(sha256(convert_to(p_label, 'UTF8')), 'hex') $$;

create temp table results (name text primary key, body jsonb not null);

create function pg_temp.r(p_name text) returns jsonb
language sql stable
as $$ select body from results where name = p_name $$;

create function pg_temp.session_id(p_token_label text) returns uuid
language sql stable
as $$
  select session_id from private.session_credentials
   where token_hash = decode(pg_temp.h(p_token_label), 'hex')
$$;

-- First registration -------------------------------------------------------------------
insert into results values ('first',
  public.register_visitor_session(pg_temp.h('reg-a'), pg_temp.h('tok-a'), pg_temp.h('salt-a'), null));

select is(pg_temp.r('first')->>'status', 'created', 'a new registration key creates a visitor');
select is((select visitor_count from public.site_stats), 1::bigint, 'visitor_count increases by exactly one');
select ok(
  (pg_temp.r('first')->'visitor'->>'alias') = any (private.alias_pool()),
  'the alias is drawn from the curated list');
select set_eq(
  $$ select jsonb_object_keys(pg_temp.r('first')) $$,
  array['status', 'visitor'],
  'a created registration returns only status and visitor (no hashes or salt)');
select set_eq(
  $$ select jsonb_object_keys(pg_temp.r('first')->'visitor') $$,
  array['visitorNumber', 'alias', 'knockCount', 'startedAt'],
  'the visitor object exposes only public fields');
select is(
  (select encode(registration_hash, 'hex') from private.session_credentials
    where session_id = pg_temp.session_id('tok-a')),
  pg_temp.h('reg-a'),
  'only the SHA-256 of the registration key is stored');

-- Replay of the same key (lost response) ----------------------------------------------
insert into results values ('replay',
  public.register_visitor_session(pg_temp.h('reg-a'), pg_temp.h('tok-a-retry'), pg_temp.h('salt-a-retry'), null));

select is(pg_temp.r('replay')->>'status', 'replayed', 'replaying the same key is recognized');
select is(pg_temp.r('replay')->'visitor', pg_temp.r('first')->'visitor', 'the replay returns the same visitor and alias');
select is(pg_temp.r('replay')->>'tokenSalt', pg_temp.h('salt-a'), 'the replay returns the original salt');
select is(pg_temp.r('replay')->>'tokenHash', pg_temp.h('tok-a'), 'the replay returns the original token hash');
select is((select visitor_count from public.site_stats), 1::bigint, 'a replay does not count another visitor');
select is((select count(*) from public.visitor_sessions), 1::bigint, 'a replay inserts nothing');
select is(
  (select count(*) from private.session_credentials where token_hash = decode(pg_temp.h('tok-a-retry'), 'hex')),
  0::bigint,
  'the hashes sent with a replay are discarded');

-- Resume, which is the token's first use ------------------------------------------------
insert into results values ('resume', public.resume_visitor_session(pg_temp.h('tok-a')));

select is(pg_temp.r('resume')->>'status', 'resumed', 'a valid token resumes the session');
select is(pg_temp.r('resume')->'visitor'->>'alias', pg_temp.r('first')->'visitor'->>'alias', 'the alias stays the same on resume');
select is(
  pg_temp.r('resume')->'visitor'->>'visitorNumber',
  pg_temp.r('first')->'visitor'->>'visitorNumber',
  'the visitor number stays the same on resume');
select ok(
  (select registration_hash is null and token_salt is null from private.session_credentials
    where session_id = pg_temp.session_id('tok-a')),
  'the first token use deletes the registration hash and salt');

insert into results values ('after-use',
  public.register_visitor_session(pg_temp.h('reg-a'), pg_temp.h('tok-a2'), pg_temp.h('salt-a2'), null));

select is(pg_temp.r('after-use')->>'status', 'created', 'a consumed key creates a separate visitor instead of returning the token');
select isnt(
  pg_temp.r('after-use')->'visitor'->>'visitorNumber',
  pg_temp.r('first')->'visitor'->>'visitorNumber',
  'the separate visitor gets its own number');
select is(
  public.resume_visitor_session(pg_temp.h('tok-a'))->>'status',
  'resumed',
  'the original token keeps working');

-- Replay window -----------------------------------------------------------------------------
insert into results values ('b',
  public.register_visitor_session(pg_temp.h('reg-b'), pg_temp.h('tok-b'), pg_temp.h('salt-b'), null));
update private.session_credentials
   set created_at = now() - interval '11 minutes'
 where session_id = pg_temp.session_id('tok-b');
insert into results values ('b-late',
  public.register_visitor_session(pg_temp.h('reg-b'), pg_temp.h('tok-b2'), pg_temp.h('salt-b2'), null));

select is(pg_temp.r('b-late')->>'status', 'created', 'a replay after the 10-minute window creates a separate visitor');
select ok(
  (select registration_hash is null and token_salt is null from private.session_credentials
    where session_id = pg_temp.session_id('tok-b')),
  'the expired registration material is detached from the original session');

-- Unknown and expired credentials ---------------------------------------------------------
select is(
  public.resume_visitor_session(pg_temp.h('never-issued'))->>'status',
  'invalid_session',
  'an unknown token is rejected');

insert into results values ('c',
  public.register_visitor_session(pg_temp.h('reg-c'), pg_temp.h('tok-c'), pg_temp.h('salt-c'), null));
update public.visitor_sessions
   set last_active_at = now() - interval '25 hours'
 where id = pg_temp.session_id('tok-c');
select is(
  public.resume_visitor_session(pg_temp.h('tok-c'))->>'status',
  'invalid_session',
  'a session idle for more than 24 hours is rejected');

insert into results values ('d',
  public.register_visitor_session(pg_temp.h('reg-d'), pg_temp.h('tok-d'), pg_temp.h('salt-d'), null));
update private.session_credentials
   set created_at = now() - interval '8 days'
 where session_id = pg_temp.session_id('tok-d');
select is(
  public.resume_visitor_session(pg_temp.h('tok-d'))->>'status',
  'invalid_session',
  'a credential older than 7 days is rejected even if recently active');

-- Input validation -------------------------------------------------------------------------
select throws_ok(
  $$ select public.register_visitor_session('not-hex', pg_temp.h('x'), pg_temp.h('y'), null) $$,
  '22023', null, 'malformed registration hashes are rejected');
select throws_ok(
  $$ select public.resume_visitor_session(upper(pg_temp.h('tok-a'))) $$,
  '22023', null, 'token hashes must be lowercase hex');
select throws_ok(
  $$ select public.register_visitor_session(pg_temp.h('reg-x'), pg_temp.h('tok-x'), pg_temp.h('salt-x'), 'bad key') $$,
  '22023', null, 'malformed network keys are rejected');
select ok(
  (select count(distinct visitor_number) = count(*) from public.visitor_sessions),
  'visitor numbers are unique');

-- Registration limits ---------------------------------------------------------------------
insert into results values ('e',
  public.register_visitor_session(pg_temp.h('reg-e'), pg_temp.h('tok-e'), pg_temp.h('salt-e'), null));

insert into private.rate_limit_buckets (bucket_key, window_started_at, used)
values ('global_registrations:all', now(), 300)
on conflict (bucket_key) do update set window_started_at = now(), used = 300;

insert into results values ('limited',
  public.register_visitor_session(pg_temp.h('reg-limited'), pg_temp.h('tok-limited'), pg_temp.h('salt-limited'), null));

select is(pg_temp.r('limited')->>'status', 'rate_limited', 'registrations stop at the site-wide ceiling');
select ok(
  (pg_temp.r('limited')->>'retryAfterSeconds')::integer between 1 and 60,
  'a rate-limited registration includes retry guidance');
select is(
  (select count(*) from private.session_credentials where token_hash = decode(pg_temp.h('tok-limited'), 'hex')),
  0::bigint,
  'a rate-limited registration records nothing');
select is(
  public.register_visitor_session(pg_temp.h('reg-e'), pg_temp.h('tok-e-retry'), pg_temp.h('salt-e-retry'), null)->>'status',
  'replayed',
  'replays of an existing registration are not blocked by the creation ceiling');

update private.rate_limit_buckets
   set window_started_at = now() - interval '61 seconds'
 where bucket_key = 'global_registrations:all';
insert into results values ('limited-retry',
  public.register_visitor_session(pg_temp.h('reg-limited'), pg_temp.h('tok-limited'), pg_temp.h('salt-limited'), null));
select is(pg_temp.r('limited-retry')->>'status', 'created', 'the same key succeeds once the window has reset');
select is(
  (select count(*) from private.session_credentials where registration_hash = decode(pg_temp.h('reg-limited'), 'hex')),
  1::bigint,
  'the retried registration exists exactly once');

insert into private.rate_limit_buckets (bucket_key, window_started_at, used)
values ('network_registrations:' || pg_temp.h('network-1'), now(), 30);
select is(
  public.register_visitor_session(pg_temp.h('reg-n1'), pg_temp.h('tok-n1'), pg_temp.h('salt-n1'), pg_temp.h('network-1'))->>'status',
  'rate_limited',
  'the per-network ceiling applies when a network key is supplied');
select is(
  public.register_visitor_session(pg_temp.h('reg-n2'), pg_temp.h('tok-n2'), pg_temp.h('salt-n2'), pg_temp.h('network-2'))->>'status',
  'created',
  'other networks are unaffected');
select is(
  public.register_visitor_session(pg_temp.h('reg-n3'), pg_temp.h('tok-n3'), pg_temp.h('salt-n3'), 'unknown')->>'status',
  'created',
  'the shared "unknown" network bucket is accepted');

-- Per-session request budget ----------------------------------------------------------------
insert into results values ('f',
  public.register_visitor_session(pg_temp.h('reg-f'), pg_temp.h('tok-f'), pg_temp.h('salt-f'), null));
insert into private.rate_limit_buckets (bucket_key, window_started_at, used)
values ('session_requests:' || pg_temp.session_id('tok-f'), now(), 120);

select is(
  public.register_visitor_session(pg_temp.h('reg-f'), pg_temp.h('tok-f-retry'), pg_temp.h('salt-f-retry'), null)->>'status',
  'rate_limited',
  'replays count against the session request budget');
select is(
  public.resume_visitor_session(pg_temp.h('tok-f'))->>'status',
  'rate_limited',
  'resumes count against the session request budget');
select ok(
  (select registration_hash is not null from private.session_credentials
    where session_id = pg_temp.session_id('tok-f')),
  'a rate-limited resume does not consume the registration material');

select * from finish();
rollback;
