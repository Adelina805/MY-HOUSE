-- Fixed-window limiter mechanics and expired-data cleanup.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

truncate public.visitor_sessions, public.prize_awards cascade;
delete from private.rate_limit_buckets;

create function pg_temp.h(p_label text) returns text
language sql immutable
as $$ select encode(sha256(convert_to(p_label, 'UTF8')), 'hex') $$;

-- Window accounting ------------------------------------------------------------------------
select is(
  (select count(*) from generate_series(1, 30) where private.take_rate_limit('session_awards', 'subject-a') = 0),
  30::bigint,
  'the first 30 units in a window are granted');
select ok(
  private.take_rate_limit('session_awards', 'subject-a') between 1 and 600,
  'the next unit is denied with the seconds remaining in the window');
select is(
  (select used from private.rate_limit_buckets where bucket_key = 'session_awards:subject-a'),
  30,
  'a denied request takes nothing');
select is(
  private.take_rate_limit('session_awards', 'subject-b'),
  0,
  'subjects are counted independently');

update private.rate_limit_buckets
   set window_started_at = now() - interval '601 seconds'
 where bucket_key = 'session_awards:subject-a';
select is(private.take_rate_limit('session_awards', 'subject-a'), 0, 'a new window starts after the old one ends');
select is(
  (select used from private.rate_limit_buckets where bucket_key = 'session_awards:subject-a'),
  1,
  'the new window counts from zero');

-- Costs ---------------------------------------------------------------------------------------
select is(private.take_rate_limit('global_knocks', 'all', 29990), 0, 'a multi-unit cost is granted when it fits');
select ok(private.take_rate_limit('global_knocks', 'all', 11) > 0, 'a cost that does not fit is denied as a whole');
select is(private.take_rate_limit('global_knocks', 'all', 10), 0, 'a smaller cost that fits is still granted');
select throws_ok(
  $$ select private.take_rate_limit('global_knocks', 'all', 30001) $$,
  '22023', null, 'a cost larger than the whole window is a programming error');
select throws_ok(
  $$ select private.take_rate_limit('no_such_policy', 'x') $$,
  '22023', null, 'unknown policies are rejected');

-- Cleanup -------------------------------------------------------------------------------------
insert into private.rate_limit_buckets (bucket_key, window_started_at, used)
values ('session_awards:stale', now() - interval '2 days', 3);

select public.register_visitor_session(pg_temp.h('reg-idle'), pg_temp.h('tok-idle'), pg_temp.h('salt-idle'), null);
select public.register_visitor_session(pg_temp.h('reg-old'), pg_temp.h('tok-old'), pg_temp.h('salt-old'), null);
select public.register_visitor_session(pg_temp.h('reg-live'), pg_temp.h('tok-live'), pg_temp.h('salt-live'), null);

update public.visitor_sessions s
   set last_active_at = now() - interval '25 hours'
  from private.session_credentials c
 where c.session_id = s.id and c.token_hash = decode(pg_temp.h('tok-idle'), 'hex');
update private.session_credentials
   set created_at = now() - interval '11 minutes'
 where token_hash = decode(pg_temp.h('tok-old'), 'hex');

create temp table cleanup_result as select private.cleanup_expired_data() as body;

select is((select (body->>'expiredCredentials')::integer from cleanup_result), 1, 'cleanup deletes expired credentials');
select is((select (body->>'clearedRegistrations')::integer from cleanup_result), 1, 'cleanup clears registration material past its window');
select is((select (body->>'staleRateLimitBuckets')::integer from cleanup_result), 1, 'cleanup deletes stale rate-limit buckets');
select is(
  public.resume_visitor_session(pg_temp.h('tok-live'))->>'status',
  'resumed',
  'live sessions survive cleanup');
select is(
  (select count(*) from public.visitor_sessions),
  3::bigint,
  'cleanup keeps every visitor row (guestbook history)');
select ok(
  exists (select 1 from private.rate_limit_buckets where bucket_key = 'session_awards:subject-a'),
  'current rate-limit buckets survive cleanup');

select * from finish();
rollback;
