-- Award recording: idempotency, conflicts, duplicate prizes, authentication, and limits.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

truncate public.visitor_sessions, public.prize_awards cascade;
delete from private.rate_limit_buckets;

create function pg_temp.h(p_label text) returns text
language sql immutable
as $$ select encode(sha256(convert_to(p_label, 'UTF8')), 'hex') $$;

create function pg_temp.session_id(p_token_label text) returns uuid
language sql stable
as $$
  select session_id from private.session_credentials
   where token_hash = decode(pg_temp.h(p_token_label), 'hex')
$$;

create function pg_temp.award(p_token_label text, p_award_id uuid, p_adjective text default 'champion')
returns jsonb
language sql volatile
as $$
  select public.record_prize_award(
    pg_temp.h(p_token_label), p_award_id, 'trophy', 'trophy', p_adjective, 'Balboa Park', null)
$$;

create temp table results (name text primary key, body jsonb not null);

create function pg_temp.r(p_name text) returns jsonb
language sql stable
as $$ select body from results where name = p_name $$;

select public.register_visitor_session(pg_temp.h('reg-a'), pg_temp.h('tok-a'), pg_temp.h('salt-a'), null);
select public.register_visitor_session(pg_temp.h('reg-b'), pg_temp.h('tok-b'), pg_temp.h('salt-b'), null);

-- Create --------------------------------------------------------------------------------
insert into results values ('first', pg_temp.award('tok-a', '11111111-1111-4111-8111-111111111111'));

select is(pg_temp.r('first')->>'status', 'created', 'a new award id is recorded');
select is((select gifts_given from public.site_stats), 1::bigint, 'gifts_given increases by one');
select set_eq(
  $$ select jsonb_object_keys(pg_temp.r('first')->'award') $$,
  array['awardId', 'visitorNumber', 'alias', 'prizeId', 'objectName', 'adjective', 'location', 'awardedAt'],
  'the award exposes only public guestbook fields');
select is(
  (select object_name from public.prize_awards where id = '11111111-1111-4111-8111-111111111111'),
  'trophy',
  'the object name supplied by the Edge Function catalog is stored');
select is(
  (select awarded_at from public.prize_awards where id = '11111111-1111-4111-8111-111111111111'),
  now(),
  'awarded_at is assigned by the server');
select ok(
  (select registration_hash is null from private.session_credentials where session_id = pg_temp.session_id('tok-a')),
  'recording an award consumes the registration material');

-- Idempotent replay and conflicts -----------------------------------------------------------
insert into results values ('replay', pg_temp.award('tok-a', '11111111-1111-4111-8111-111111111111'));

select is(pg_temp.r('replay')->>'status', 'duplicate', 'retrying the same award is recognized as a duplicate');
select is(pg_temp.r('replay')->'award', pg_temp.r('first')->'award', 'the duplicate returns the original award');
select is((select gifts_given from public.site_stats), 1::bigint, 'a duplicate is counted once');

insert into results values ('conflict', pg_temp.award('tok-a', '11111111-1111-4111-8111-111111111111', 'plastic'));
select is(pg_temp.r('conflict')->>'status', 'conflict', 'reusing an award id with different fields is a conflict');
select set_eq(
  $$ select jsonb_object_keys(pg_temp.r('conflict')) $$,
  array['status'],
  'a conflict reveals nothing about the existing award');
select is(
  (select adjective from public.prize_awards where id = '11111111-1111-4111-8111-111111111111'),
  'champion',
  'a conflicting retry does not overwrite the original');

select is(
  pg_temp.award('tok-b', '11111111-1111-4111-8111-111111111111')->>'status',
  'conflict',
  'another session cannot claim an existing award id');

-- Duplicate prizes are allowed --------------------------------------------------------------
select is(
  pg_temp.award('tok-a', '22222222-2222-4222-8222-222222222222')->>'status',
  'created',
  'the same prize can be awarded again with a new award id');
select is((select gifts_given from public.site_stats), 2::bigint, 'each distinct award is a gift');
select is(
  (select count(*) from public.prize_awards where session_id = pg_temp.session_id('tok-a')),
  2::bigint,
  'one session can hold several awards');

-- Authentication -------------------------------------------------------------------------------
select is(
  pg_temp.award('never-issued', '33333333-3333-4333-8333-333333333333')->>'status',
  'invalid_session',
  'an unknown token cannot record awards');
update public.visitor_sessions set last_active_at = now() - interval '25 hours'
 where id = pg_temp.session_id('tok-b');
select is(
  pg_temp.award('tok-b', '33333333-3333-4333-8333-333333333333')->>'status',
  'invalid_session',
  'an expired session cannot record awards');
select is(
  (select count(*) from public.prize_awards where id = '33333333-3333-4333-8333-333333333333'),
  0::bigint,
  'rejected awards are not stored');

-- Input checks enforced by the table ----------------------------------------------------------
select throws_ok(
  $$ select public.record_prize_award(pg_temp.h('tok-a'), '44444444-4444-4444-8444-444444444444',
       'Not A Prize Id', 'x', 'champion', 'Balboa Park', null) $$,
  '23514', null, 'prize ids must be lowercase slugs');
select throws_ok(
  $$ select public.record_prize_award(pg_temp.h('tok-a'), null, 'trophy', 'trophy', 'champion', 'Balboa Park', null) $$,
  '22023', null, 'an award id is required');

-- Limits ---------------------------------------------------------------------------------------
insert into private.rate_limit_buckets (bucket_key, window_started_at, used)
values ('session_awards:' || pg_temp.session_id('tok-a'), now(), 30)
on conflict (bucket_key) do update set window_started_at = now(), used = 30;

insert into results values ('session-limited', pg_temp.award('tok-a', '55555555-5555-4555-8555-555555555555'));
select is(pg_temp.r('session-limited')->>'status', 'rate_limited', 'a session is limited to 30 new awards per 10 minutes');
select ok(
  (pg_temp.r('session-limited')->>'retryAfterSeconds')::integer between 1 and 600,
  'the session award limit includes retry guidance');
select is(
  pg_temp.award('tok-a', '22222222-2222-4222-8222-222222222222')->>'status',
  'duplicate',
  'retries of recorded awards still succeed while the session is limited');

delete from private.rate_limit_buckets where bucket_key like 'session_awards:%';
insert into private.rate_limit_buckets (bucket_key, window_started_at, used)
values ('global_awards:all', now(), 300)
on conflict (bucket_key) do update set window_started_at = now(), used = 300;

select is(
  pg_temp.award('tok-a', '66666666-6666-4666-8666-666666666666')->>'status',
  'rate_limited',
  'awards stop at the site-wide ceiling');
select is(
  (select count(*) from public.prize_awards where id = '66666666-6666-4666-8666-666666666666'),
  0::bigint,
  'a rate-limited award records nothing');

update private.rate_limit_buckets
   set window_started_at = now() - interval '61 seconds'
 where bucket_key = 'global_awards:all';
select is(
  pg_temp.award('tok-a', '66666666-6666-4666-8666-666666666666')->>'status',
  'created',
  'the same award id succeeds once the window has reset');
select is((select gifts_given from public.site_stats), 3::bigint, 'the retried award is counted exactly once');

insert into private.rate_limit_buckets (bucket_key, window_started_at, used)
values ('network_awards:' || pg_temp.h('network-1'), now(), 60)
on conflict (bucket_key) do update set window_started_at = now(), used = 60;
select is(
  public.record_prize_award(pg_temp.h('tok-a'), '77777777-7777-4777-8777-777777777777',
    'trophy', 'trophy', 'champion', 'Balboa Park', pg_temp.h('network-1'))->>'status',
  'rate_limited',
  'the per-network award ceiling applies when a network key is supplied');
select is(
  public.record_prize_award(pg_temp.h('tok-a'), '77777777-7777-4777-8777-777777777777',
    'trophy', 'trophy', 'champion', 'Balboa Park', pg_temp.h('network-2'))->>'status',
  'created',
  'other networks are unaffected');

select * from finish();
rollback;
