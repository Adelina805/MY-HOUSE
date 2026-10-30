-- Trigger-maintained totals and private.rebuild_site_stats() (single-transaction checks).
-- Concurrency, locking, and isolation are exercised with real parallel connections in
-- supabase/functions/tests/integration/stats_rebuild_concurrency.test.ts.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

truncate public.visitor_sessions, public.prize_awards cascade;
delete from private.rate_limit_buckets;

create function pg_temp.h(p_label text) returns text
language sql immutable
as $$ select encode(sha256(convert_to(p_label, 'UTF8')), 'hex') $$;

create function pg_temp.actual() returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'visitorCount', (select count(*) from public.visitor_sessions),
    'giftsGiven', (select count(*) from public.prize_awards),
    'doorKnocks', (select coalesce(sum(knock_count), 0) from public.visitor_sessions))
$$;

create function pg_temp.stored() returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'visitorCount', visitor_count, 'giftsGiven', gifts_given, 'doorKnocks', door_knocks)
    from public.site_stats
   where id = 1
$$;

create function pg_temp.session_id(p_token_label text) returns uuid
language sql stable
as $$
  select session_id from private.session_credentials
   where token_hash = decode(pg_temp.h(p_token_label), 'hex')
$$;

select is(pg_temp.stored(), pg_temp.actual(), 'TRUNCATE leaves the totals correct without a manual rebuild');

-- Invariant across every write path --------------------------------------------------------
select public.register_visitor_session(pg_temp.h('reg-a'), pg_temp.h('tok-a'), pg_temp.h('salt-a'), null);
select public.register_visitor_session(pg_temp.h('reg-b'), pg_temp.h('tok-b'), pg_temp.h('salt-b'), null);
select public.register_visitor_session(pg_temp.h('reg-c'), pg_temp.h('tok-c'), pg_temp.h('salt-c'), null);
select public.record_knocks(pg_temp.h('tok-a'), 3);
select public.record_knocks(pg_temp.h('tok-b'), 6);
select public.record_prize_award(pg_temp.h('tok-a'), 'cccccccc-0000-4000-8000-000000000001', 'trophy', 'trophy', 'champion', 'Balboa Park', null);
select public.record_prize_award(pg_temp.h('tok-a'), 'cccccccc-0000-4000-8000-000000000002', 'trophy', 'trophy', 'plastic', 'Petco Park', null);
select public.record_prize_award(pg_temp.h('tok-b'), 'cccccccc-0000-4000-8000-000000000003', 'volleyball', 'volleyball', 'sandy', 'Ocean Beach', null);

select is(pg_temp.stored(), pg_temp.actual(), 'totals match the tables after registrations, knocks, and awards');
select is(
  pg_temp.stored(),
  '{"visitorCount": 3, "giftsGiven": 3, "doorKnocks": 9}'::jsonb,
  'the totals have the expected values');

-- Moderation through plain SQL keeps the totals correct -------------------------------------
delete from public.prize_awards where id = 'cccccccc-0000-4000-8000-000000000003';
select is(pg_temp.stored(), pg_temp.actual(), 'deleting an award adjusts gifts_given');

select throws_ok(
  $$ delete from public.visitor_sessions where id = pg_temp.session_id('tok-a') $$,
  '23503', null, 'a visitor with awards cannot be deleted until the awards are removed');

delete from public.visitor_sessions where id = pg_temp.session_id('tok-b');
select is(pg_temp.stored(), pg_temp.actual(), 'deleting a visitor removes its visit and its knocks from the totals');

update public.visitor_sessions set knock_count = 0 where id = pg_temp.session_id('tok-a');
select is(pg_temp.stored(), pg_temp.actual(), 'resetting a knock count adjusts door_knocks');

-- Rebuild repairs drift -----------------------------------------------------------------------
update public.site_stats set visitor_count = 999, gifts_given = 999, door_knocks = 999;

create temp table rebuild_result as select private.rebuild_site_stats() as body;

select is(
  (select body->'before' from rebuild_result),
  '{"visitorCount": 999, "giftsGiven": 999, "doorKnocks": 999}'::jsonb,
  'the rebuild reports the drifted totals it replaced');
select is((select body->'after' from rebuild_result), pg_temp.actual(), 'the rebuild reports the recomputed totals');
select is(pg_temp.stored(), pg_temp.actual(), 'the stats row matches the tables after the rebuild');

select is(
  (select body->'before' = body->'after' from (select private.rebuild_site_stats() as body) as again),
  true,
  'a rebuild with no drift changes nothing');

-- Missing stats row -----------------------------------------------------------------------------
delete from public.site_stats;
select throws_ok(
  $$ select public.register_visitor_session(pg_temp.h('reg-d'), pg_temp.h('tok-d'), pg_temp.h('salt-d'), null) $$,
  'P0002', null, 'writes fail loudly while the stats row is missing');
select throws_ok(
  $$ select public.record_prize_award(pg_temp.h('tok-a'), 'cccccccc-0000-4000-8000-000000000004', 'trophy', 'trophy', 'champion', 'Balboa Park', null) $$,
  'P0002', null, 'award writes fail loudly too');
select is(
  (select body->'before' from (select private.rebuild_site_stats() as body) as rebuilt),
  'null'::jsonb,
  'the rebuild reports that no stats row existed');
select is(pg_temp.stored(), pg_temp.actual(), 'the rebuild recreates the stats row');
select is(
  public.register_visitor_session(pg_temp.h('reg-d'), pg_temp.h('tok-d'), pg_temp.h('salt-d'), null)->>'status',
  'created',
  'writes work again after the rebuild');
select is(pg_temp.stored(), pg_temp.actual(), 'totals stay correct after recovery');

-- TRUNCATE ---------------------------------------------------------------------------------------
truncate public.prize_awards;
select is(pg_temp.stored(), pg_temp.actual(), 'truncating awards resets gifts_given automatically');
truncate public.visitor_sessions cascade;
select is(
  pg_temp.stored(),
  '{"visitorCount": 0, "giftsGiven": 0, "doorKnocks": 0}'::jsonb,
  'truncating everything resets every total');

-- Properties the concurrency guarantees depend on ---------------------------------------------
select is(
  (select provolatile::text from pg_proc where oid = 'private.rebuild_site_stats()'::regprocedure),
  'v',
  'the rebuild is VOLATILE, so each statement takes a fresh snapshot after the lock');
select ok(
  (select 'lock_timeout=5s' = any (proconfig) from pg_proc where oid = 'private.rebuild_site_stats()'::regprocedure),
  'the rebuild bounds its lock wait');
select is(
  (select count(*) from pg_trigger
    where tgrelid in ('public.visitor_sessions'::regclass, 'public.prize_awards'::regclass)
      and not tgisinternal),
  4::bigint,
  'row and truncate triggers are installed on both domain tables');

select * from finish();
rollback;
