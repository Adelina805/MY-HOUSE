-- Guestbook reads: empty state, ordering, ties, keyset pagination, validation, public fields.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

truncate public.visitor_sessions, public.prize_awards cascade;
delete from private.rate_limit_buckets;

-- Empty guestbook -----------------------------------------------------------------------------
select is(
  public.get_guestbook_page(20, null),
  '{"status": "ok", "stats": {"visitorCount": 0, "giftsGiven": 0, "doorKnocks": 0}, "entries": [], "nextCursor": null}'::jsonb,
  'an empty guestbook returns zero stats, no entries, and no cursor');

-- Fixture: two visitors, six awards, three of them sharing one timestamp ---------------------
insert into public.visitor_sessions (id, alias, knock_count)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'curious raccoon', 3),
       ('aaaaaaaa-0000-4000-8000-000000000002', 'friendly ghost', 6);

insert into public.prize_awards (id, session_id, prize_id, object_name, adjective, location, awarded_at)
values
  ('00000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'trophy', 'trophy', 'champion', 'Balboa Park', '2026-10-01 10:00:00+00'),
  ('00000000-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000002', 'volleyball', 'volleyball', 'sandy', 'Ocean Beach', '2026-10-01 11:00:00+00'),
  ('00000000-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-000000000001', 'trophy', 'trophy', 'plastic', 'Petco Park', '2026-10-01 11:00:00+00'),
  ('00000000-0000-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-000000000002', 'toy-dinosaur', 'toy dinosaur', 'roaring', 'Balboa Park', '2026-10-01 11:00:00+00'),
  ('00000000-0000-4000-8000-00000000000e', 'aaaaaaaa-0000-4000-8000-000000000001', 'traffic-cone', 'traffic cone', 'orange', 'Little Italy', '2026-10-01 12:00:00+00'),
  ('00000000-0000-4000-8000-00000000000f', 'aaaaaaaa-0000-4000-8000-000000000002', 'volleyball', 'volleyball', 'deflated', 'Mission Beach', '2026-10-01 09:00:00+00');

create temp table page_one as select public.get_guestbook_page(20, null) as body;

select is(
  (select body->'stats' from page_one),
  '{"visitorCount": 2, "giftsGiven": 6, "doorKnocks": 9}'::jsonb,
  'stats come from the trigger-maintained totals');
select is(
  (select array_agg(e->>'awardId' order by ordinality) from page_one, jsonb_array_elements(body->'entries') with ordinality as t (e, ordinality)),
  array['00000000-0000-4000-8000-00000000000e',
        '00000000-0000-4000-8000-00000000000d',
        '00000000-0000-4000-8000-00000000000c',
        '00000000-0000-4000-8000-00000000000b',
        '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-00000000000f'],
  'entries are newest first, and equal timestamps are ordered by award id descending');
select is((select body->'nextCursor' from page_one), 'null'::jsonb, 'the last page has no cursor');
select set_eq(
  $$ select jsonb_object_keys(body->'entries'->0) from page_one $$,
  array['awardId', 'visitorNumber', 'alias', 'prizeId', 'objectName', 'adjective', 'location', 'awardedAt'],
  'entries expose only public fields');
select is(
  (select body->'entries'->0->>'alias' from page_one),
  'curious raccoon',
  'entries carry the visitor alias');
select is(
  (select body->'entries'->0->>'awardedAt' from page_one),
  '2026-10-01T12:00:00.000Z',
  'timestamps are ISO-8601 UTC');
select ok(
  (select (body->'entries'->0->>'visitorNumber')::bigint > 0 from page_one),
  'entries carry the visitor number');

-- Keyset pagination across the tie -----------------------------------------------------------
create temp table walk as
with recursive pages (n, body) as (
  select 1, public.get_guestbook_page(2, null)
  union all
  select n + 1, public.get_guestbook_page(2, (body->>'nextCursor')::uuid)
    from pages
   where body->>'nextCursor' is not null
)
select n, position, e->>'awardId' as award_id
  from pages, jsonb_array_elements(body->'entries') with ordinality as t (e, position);

select is((select count(*) from walk), 6::bigint, 'walking pages of 2 visits every award');
select is((select count(distinct award_id) from walk), 6::bigint, 'no award appears twice');
select is((select max(n) from walk), 3, 'six awards take exactly three pages of two');
select is(
  (select array_agg(award_id order by n, position) from walk),
  (select array_agg(e->>'awardId' order by ordinality) from page_one, jsonb_array_elements(body->'entries') with ordinality as t (e, ordinality)),
  'paged order matches the single-page order');
select is(
  public.get_guestbook_page(2, null)->>'nextCursor',
  '00000000-0000-4000-8000-00000000000d',
  'the cursor is the id of the last entry on the page');

-- Validation ---------------------------------------------------------------------------------
select is(
  public.get_guestbook_page(20, 'bbbbbbbb-0000-4000-8000-000000000000'),
  '{"status": "invalid_cursor"}'::jsonb,
  'an unknown cursor is reported, not silently treated as the first page');
select throws_ok($$ select public.get_guestbook_page(0, null) $$, '22023', null, 'limit must be at least 1');
select throws_ok($$ select public.get_guestbook_page(51, null) $$, '22023', null, 'limit is capped at 50');
select is(
  jsonb_array_length(public.get_guestbook_page(1, null)->'entries'),
  1,
  'the limit is respected');
select is(
  jsonb_array_length(public.get_guestbook_page(20, '00000000-0000-4000-8000-00000000000f')->'entries'),
  0,
  'a cursor at the oldest award returns an empty page');

delete from public.site_stats;
select throws_ok(
  $$ select public.get_guestbook_page(20, null) $$,
  'P0002', null, 'a missing stats row is an error, never silently reported as zeros');

select * from finish();
rollback;
