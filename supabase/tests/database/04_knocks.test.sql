-- Cumulative knock reports: idempotency, plausibility cap, site-wide ceiling, validation.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

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

create function pg_temp.knocks(p_token_label text, p_total integer) returns jsonb
language sql volatile
as $$ select public.record_knocks(pg_temp.h(p_token_label), p_total) $$;

create temp table results (name text primary key, body jsonb not null);

create function pg_temp.r(p_name text) returns jsonb
language sql stable
as $$ select body from results where name = p_name $$;

select public.register_visitor_session(pg_temp.h('reg-a'), pg_temp.h('tok-a'), pg_temp.h('salt-a'), null);
-- 100 seconds into the session, the cap is 30 + 100 = 130 knocks.
update public.visitor_sessions set started_at = now() - interval '100 seconds'
 where id = pg_temp.session_id('tok-a');

-- Cumulative totals ------------------------------------------------------------------------
insert into results values ('five', pg_temp.knocks('tok-a', 5));
select is(pg_temp.r('five')->>'status', 'ok', 'a knock total is accepted');
select is((pg_temp.r('five')->>'accepted')::integer, 5, 'the first report adds its whole total');
select is((select door_knocks from public.site_stats), 5::bigint, 'door_knocks reflects the report');

select is((pg_temp.knocks('tok-a', 5)->>'accepted')::integer, 0, 'retrying the same total adds nothing');
select is((select door_knocks from public.site_stats), 5::bigint, 'door_knocks is unchanged by a retry');

insert into results values ('eight', pg_temp.knocks('tok-a', 8));
select is((pg_temp.r('eight')->>'accepted')::integer, 3, 'a higher total adds only the difference');
select is((pg_temp.r('eight')->>'knockCount')::integer, 8, 'the acknowledged total is returned');

insert into results values ('lower', pg_temp.knocks('tok-a', 2));
select is((pg_temp.r('lower')->>'accepted')::integer, 0, 'a lower (stale) total adds nothing');
select is((pg_temp.r('lower')->>'knockCount')::integer, 8, 'a stale total never lowers the count');
select is(
  (select knock_count from public.visitor_sessions where id = pg_temp.session_id('tok-a')),
  8,
  'the session row holds the acknowledged total');

-- Plausibility cap (all-or-nothing) ------------------------------------------------------------
insert into results values ('over-cap', pg_temp.knocks('tok-a', 131));
select is(pg_temp.r('over-cap')->>'status', 'rate_limited', 'a total above the session cap is rejected');
select is(
  (pg_temp.r('over-cap')->>'retryAfterSeconds')::integer,
  1,
  'retry guidance says when the cap will admit the total');
select is((select door_knocks from public.site_stats), 8::bigint, 'a rejected report records nothing');
select is((pg_temp.knocks('tok-a', 130)->>'accepted')::integer, 122, 'a total at the cap is accepted');

select public.register_visitor_session(pg_temp.h('reg-b'), pg_temp.h('tok-b'), pg_temp.h('salt-b'), null);
select is(pg_temp.knocks('tok-b', 30)->>'status', 'ok', 'a new session may report up to 30 knocks immediately');
insert into results values ('fresh-over', pg_temp.knocks('tok-b', 45));
select is(pg_temp.r('fresh-over')->>'status', 'rate_limited', 'a new session cannot jump past the cap');
select is((pg_temp.r('fresh-over')->>'retryAfterSeconds')::integer, 15, 'retry guidance grows with the excess');

-- Site-wide ceiling (all-or-nothing) ------------------------------------------------------------
insert into private.rate_limit_buckets (bucket_key, window_started_at, used)
values ('global_knocks:all', now(), 29999)
on conflict (bucket_key) do update set window_started_at = now(), used = 29999;

select is(pg_temp.knocks('tok-b', 29)->>'status', 'ok', 'reports that add nothing are not limited');
select is(pg_temp.knocks('tok-b', 1)->>'status', 'ok', 'lower totals are not limited either');
update public.visitor_sessions set started_at = now() - interval '100 seconds'
 where id = pg_temp.session_id('tok-b');
select is(pg_temp.knocks('tok-b', 32)->>'status', 'rate_limited', 'an increment that does not fit the site-wide ceiling is rejected');
select is(
  (select knock_count from public.visitor_sessions where id = pg_temp.session_id('tok-b')),
  30,
  'the rejected increment is not partially applied');

-- Authentication and validation ---------------------------------------------------------------
select is(pg_temp.knocks('never-issued', 3)->>'status', 'invalid_session', 'an unknown token cannot report knocks');
select throws_ok($$ select pg_temp.knocks('tok-a', -1) $$, '22023', null, 'negative totals are rejected');
select throws_ok($$ select pg_temp.knocks('tok-a', 5001) $$, '22023', null, 'totals above 5000 are rejected');

select * from finish();
rollback;
