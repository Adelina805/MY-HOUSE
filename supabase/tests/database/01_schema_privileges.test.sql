-- Schema shape, RLS, and the full privilege matrix for API roles.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(54);

-- Tables and key constraints ---------------------------------------------------------
select has_table('public', 'visitor_sessions', 'visitor_sessions exists');
select has_table('public', 'prize_awards', 'prize_awards exists');
select has_table('public', 'site_stats', 'site_stats exists');
select has_table('private', 'session_credentials', 'session_credentials lives in the private schema');
select has_table('private', 'rate_limit_buckets', 'rate_limit_buckets lives in the private schema');

select is(
  (select attidentity::text from pg_attribute
    where attrelid = 'public.visitor_sessions'::regclass and attname = 'visitor_number'),
  'a',
  'visitor_number is GENERATED ALWAYS AS IDENTITY (sequence-backed, not MAX+1)');
select col_is_unique('public', 'visitor_sessions', 'visitor_number', 'visitor_number is unique');
select fk_ok('public', 'prize_awards', 'session_id', 'public', 'visitor_sessions', 'id');
select has_index('public', 'prize_awards', 'prize_awards_recent_idx', 'keyset pagination index exists');
select is((select count(*) from public.site_stats), 1::bigint, 'site_stats has exactly one row');

-- RLS enabled everywhere, with no policies --------------------------------------------
select is_empty(
  $$ select c.oid::regclass::text
       from pg_class c
      where c.oid in ('public.visitor_sessions'::regclass, 'public.prize_awards'::regclass,
                      'public.site_stats'::regclass, 'private.session_credentials'::regclass,
                      'private.rate_limit_buckets'::regclass)
        and not c.relrowsecurity $$,
  'RLS is enabled on every guestbook table');
select is_empty(
  $$ select policyname from pg_policies where schemaname in ('public', 'private') $$,
  'no RLS policies exist (deny by default)');

-- No table, sequence, or private-schema privileges for API roles --------------------
select is_empty(
  $$ select r.rolname || ' on ' || t.tbl
       from unnest(array['public.visitor_sessions', 'public.prize_awards', 'public.site_stats',
                         'private.session_credentials', 'private.rate_limit_buckets']) as t (tbl)
      cross join (select rolname from pg_roles
                   where rolname in ('anon', 'authenticated', 'service_role')) as r
      where has_table_privilege(r.rolname, t.tbl,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') $$,
  'anon, authenticated, and service_role have no privileges on any guestbook table');
select is_empty(
  $$ select grantee || ' ' || privilege_type || ' on ' || table_schema || '.' || table_name
       from information_schema.role_table_grants
      where grantee = 'PUBLIC'
        and table_schema in ('public', 'private') $$,
  'PUBLIC has no table privileges in public or private');
select sequence_privs_are('public', 'visitor_sessions_visitor_number_seq', 'anon', '{}'::text[]);
select sequence_privs_are('public', 'visitor_sessions_visitor_number_seq', 'authenticated', '{}'::text[]);
select sequence_privs_are('public', 'visitor_sessions_visitor_number_seq', 'service_role', '{}'::text[]);
select schema_privs_are('private', 'anon', '{}'::text[]);
select schema_privs_are('private', 'authenticated', '{}'::text[]);
select schema_privs_are('private', 'service_role', '{}'::text[]);

-- Function privileges ------------------------------------------------------------------
select function_privs_are('public', 'register_visitor_session', array['text', 'text', 'text', 'text'], 'anon', '{}'::text[]);
select function_privs_are('public', 'register_visitor_session', array['text', 'text', 'text', 'text'], 'authenticated', '{}'::text[]);
select function_privs_are('public', 'register_visitor_session', array['text', 'text', 'text', 'text'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'resume_visitor_session', array['text'], 'anon', '{}'::text[]);
select function_privs_are('public', 'resume_visitor_session', array['text'], 'authenticated', '{}'::text[]);
select function_privs_are('public', 'resume_visitor_session', array['text'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'record_prize_award', array['text', 'uuid', 'text', 'text', 'text', 'text', 'text'], 'anon', '{}'::text[]);
select function_privs_are('public', 'record_prize_award', array['text', 'uuid', 'text', 'text', 'text', 'text', 'text'], 'authenticated', '{}'::text[]);
select function_privs_are('public', 'record_prize_award', array['text', 'uuid', 'text', 'text', 'text', 'text', 'text'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'record_knocks', array['text', 'integer'], 'anon', '{}'::text[]);
select function_privs_are('public', 'record_knocks', array['text', 'integer'], 'authenticated', '{}'::text[]);
select function_privs_are('public', 'record_knocks', array['text', 'integer'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'get_guestbook_page', array['integer', 'uuid'], 'anon', '{}'::text[]);
select function_privs_are('public', 'get_guestbook_page', array['integer', 'uuid'], 'authenticated', '{}'::text[]);
select function_privs_are('public', 'get_guestbook_page', array['integer', 'uuid'], 'service_role', array['EXECUTE']);

select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p
      where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
        and has_function_privilege('public', p.oid, 'EXECUTE') $$,
  'PUBLIC cannot execute any function in public or private');
select is_empty(
  $$ select r.rolname || ' -> ' || p.oid::regprocedure::text
       from pg_proc p
      cross join (select rolname from pg_roles
                   where rolname in ('anon', 'authenticated', 'service_role')) as r
      where p.pronamespace = 'private'::regnamespace
        and has_function_privilege(r.rolname, p.oid, 'EXECUTE') $$,
  'no API role can execute any private function (rebuild, cleanup, helpers)');
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p
      where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
        and not coalesce('search_path=""' = any (p.proconfig), false) $$,
  'every function in public and private pins search_path to an empty value');
select is_empty(
  $$ select p.proname::text
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('register_visitor_session', 'resume_visitor_session',
                          'record_prize_award', 'record_knocks', 'get_guestbook_page')
        and (not p.prosecdef or pg_get_userbyid(p.proowner) <> 'postgres') $$,
  'the five API functions are SECURITY DEFINER and owned by postgres');
select is(
  (select rolsuper from pg_roles where rolname = 'postgres'),
  false,
  'the definer role (postgres) is not a superuser');

-- service_role: every API function works, direct table access does not ---------------
set local role service_role;
select lives_ok(
  $$ select public.get_guestbook_page(20, null) $$,
  'service_role can read a guestbook page');
select lives_ok(
  $$ select public.register_visitor_session(
       encode(sha256('privs-registration'::bytea), 'hex'),
       encode(sha256('privs-token'::bytea), 'hex'),
       encode(sha256('privs-salt'::bytea), 'hex'),
       null) $$,
  'service_role can register a visitor (identity sequence, triggers, private schema)');
select lives_ok(
  $$ select public.resume_visitor_session(encode(sha256('privs-token'::bytea), 'hex')) $$,
  'service_role can resume a session');
select lives_ok(
  $$ select public.record_knocks(encode(sha256('privs-token'::bytea), 'hex'), 3) $$,
  'service_role can record knocks');
select lives_ok(
  $$ select public.record_prize_award(
       encode(sha256('privs-token'::bytea), 'hex'),
       'aaaaaaaa-0000-4000-8000-000000000001', 'trophy', 'trophy', 'champion', 'Balboa Park', null) $$,
  'service_role can record an award');
select throws_ok(
  $$ select count(*) from public.visitor_sessions $$,
  '42501', null, 'service_role cannot read visitor_sessions directly');
select throws_ok(
  $$ insert into public.prize_awards (id, session_id, prize_id, object_name, adjective, location)
     values (gen_random_uuid(), gen_random_uuid(), 'trophy', 'trophy', 'champion', 'Balboa Park') $$,
  '42501', null, 'service_role cannot insert awards directly');
select throws_ok(
  $$ update public.site_stats set visitor_count = 0 $$,
  '42501', null, 'service_role cannot modify site_stats directly');
select throws_ok(
  $$ select count(*) from private.session_credentials $$,
  '42501', null, 'service_role cannot read credentials');
select throws_ok(
  $$ select private.rebuild_site_stats() $$,
  '42501', null, 'service_role cannot run the stats rebuild');
reset role;

-- anon and authenticated: nothing ---------------------------------------------------
set local role anon;
select throws_ok(
  $$ select public.get_guestbook_page(20, null) $$,
  '42501', null, 'anon cannot execute API functions');
select throws_ok(
  $$ select count(*) from public.site_stats $$,
  '42501', null, 'anon cannot read site_stats');
reset role;

set local role authenticated;
select throws_ok(
  $$ select public.record_knocks(encode(sha256('privs-token'::bytea), 'hex'), 4) $$,
  '42501', null, 'authenticated cannot execute API functions');
select throws_ok(
  $$ select count(*) from public.prize_awards $$,
  '42501', null, 'authenticated cannot read prize_awards');
reset role;

select * from finish();
rollback;
