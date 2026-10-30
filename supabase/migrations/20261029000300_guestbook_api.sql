-- Guestbook API (Stage A).
--
-- The Edge Functions are the only callers. They use the secret API key, which maps to
-- service_role, and service_role may EXECUTE the five public functions below and nothing
-- else: no table, sequence, or private-schema access. Each function runs in one
-- transaction and returns a jsonb object whose "status" tells the Edge Function which
-- HTTP response to send.
--
-- Lock order shared by every function (prevents deadlocks, including with
-- private.rebuild_site_stats()):
--   1. registration advisory lock (register_visitor_session only)
--   2. rate-limit buckets: session, then network, then global
--   3. the caller's visitor_sessions row
--   4. domain writes (the credential row, prize_awards)
--   5. site_stats, always last, via AFTER ROW triggers

-- ---------------------------------------------------------------------------
-- Policy constants
-- ---------------------------------------------------------------------------

create function private.session_idle_timeout()
returns interval language sql immutable set search_path = ''
as $$ select interval '24 hours' $$;

create function private.session_max_age()
returns interval language sql immutable set search_path = ''
as $$ select interval '7 days' $$;

create function private.registration_replay_window()
returns interval language sql immutable set search_path = ''
as $$ select interval '10 minutes' $$;

create function private.max_session_knocks()
returns integer language sql immutable set search_path = ''
as $$ select 5000 $$;

-- Counted knocks happen only in the interactive door-knocking phase (three per round),
-- so legitimate sessions stay far below 30 plus one knock per second.
create function private.knock_cap(p_started_at timestamptz)
returns integer language sql stable set search_path = ''
as $$
  select least(
    private.max_session_knocks()::numeric,
    30 + floor(greatest(0::numeric, extract(epoch from now() - p_started_at)))
  )::integer
$$;

create function private.knock_cap_retry_after(p_started_at timestamptz, p_total_knocks integer)
returns integer language sql stable set search_path = ''
as $$
  select greatest(
    1::numeric,
    ceil(p_total_knocks - 30 - extract(epoch from now() - p_started_at))
  )::integer
$$;

create function private.rate_limit_policy(
  p_policy text,
  out max_units integer,
  out window_seconds integer
)
language sql immutable set search_path = ''
as $$
  select v.max_units, v.window_seconds
    from (values
      ('session_requests',        120,  60),  -- every authenticated call, per session
      ('session_awards',           30, 600),  -- new awards, per session
      ('network_registrations',    30, 600),  -- new visitors, per network (CLIENT_IP_HEADER only)
      ('network_awards',           60, 600),  -- new awards, per network (CLIENT_IP_HEADER only)
      ('global_registrations',    300,  60),  -- new visitors, site-wide
      ('global_awards',           300,  60),  -- new awards, site-wide
      ('global_knocks',         30000,  60)   -- accepted knock increments, site-wide
    ) as v (policy, max_units, window_seconds)
   where v.policy = p_policy
$$;

create function private.alias_pool()
returns text[] language sql immutable set search_path = ''
as $$
  select array[
    'mysterious visitor', 'friendly neighbor', 'secret admirer', 'happy camper',
    'super cool dude', 'unknown entity', 'suspicious individual', 'salacious snail',
    'local cryptid', 'wandering stranger', 'awesome visitor', 'casual trespasser',
    'doorstep philosopher', 'midnight knocker', 'beach archaeologist', 'snack enthusiast',
    'lost tourist', 'friendly ghost', 'pocket collector', 'wave watcher',
    'curious raccoon', 'reluctant guest'
  ]::text[]
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create function private.random_alias()
returns text language sql volatile set search_path = ''
as $$
  select pool[1 + floor(random() * cardinality(pool))::integer]
    from (select private.alias_pool() as pool) as aliases
$$;

create function private.decode_sha256_hex(p_value text)
returns bytea
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^[0-9a-f]{64}$' then
    raise exception 'expected a 64-character lowercase hex digest' using errcode = '22023';
  end if;
  return decode(p_value, 'hex');
end;
$$;

create function private.assert_network_key(p_network_key text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_network_key is not null and p_network_key !~ '^([0-9a-f]{64}|unknown)$' then
    raise exception 'invalid network key' using errcode = '22023';
  end if;
end;
$$;

create function private.iso_utc(p_value timestamptz)
returns text language sql stable set search_path = ''
as $$ select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

create function private.visitor_json(p_session public.visitor_sessions)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'visitorNumber', p_session.visitor_number,
    'alias', p_session.alias,
    'knockCount', p_session.knock_count,
    'startedAt', private.iso_utc(p_session.started_at))
$$;

create function private.award_json(
  p_award public.prize_awards,
  p_visitor_number bigint,
  p_alias text
)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'awardId', p_award.id,
    'visitorNumber', p_visitor_number,
    'alias', p_alias,
    'prizeId', p_award.prize_id,
    'objectName', p_award.object_name,
    'adjective', p_award.adjective,
    'location', p_award.location,
    'awardedAt', private.iso_utc(p_award.awarded_at))
$$;

create function private.award_replay_result(
  p_award public.prize_awards,
  p_session public.visitor_sessions,
  p_prize_id text,
  p_adjective text,
  p_location text
)
returns jsonb language sql stable set search_path = ''
as $$
  select case
    when p_award.session_id = p_session.id
     and p_award.prize_id = p_prize_id
     and p_award.adjective = p_adjective
     and p_award.location = p_location
    then jsonb_build_object(
      'status', 'duplicate',
      'award', private.award_json(p_award, p_session.visitor_number, p_session.alias))
    -- Never reveal anything about an award that belongs to a different request.
    else jsonb_build_object('status', 'conflict')
  end
$$;

create function private.rate_limited(p_retry_after_seconds integer)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('status', 'rate_limited', 'retryAfterSeconds', p_retry_after_seconds)
$$;

-- Returns the session for a token hash if the credential is valid and not expired.
create function private.find_active_session(p_token_hash bytea)
returns public.visitor_sessions
language sql
stable
set search_path = ''
as $$
  select s.*
    from private.session_credentials c
    join public.visitor_sessions s on s.id = c.session_id
   where c.token_hash = p_token_hash
     and c.created_at > now() - private.session_max_age()
     and s.last_active_at > now() - private.session_idle_timeout()
$$;

-- After the token's first authenticated use, it can no longer be re-derived from the
-- registration key, and the key stops working.
create function private.consume_registration(p_session_id uuid)
returns void language sql set search_path = ''
as $$
  update private.session_credentials
     set registration_hash = null,
         token_salt = null
   where session_id = p_session_id
     and registration_hash is not null
$$;

-- Fixed-window limiter. Returns 0 when the units were taken, otherwise the number of
-- seconds until the window resets. A denied request takes nothing.
create function private.take_rate_limit(p_policy text, p_subject text, p_cost integer default 1)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_max_units integer;
  v_window interval;
  v_key text := p_policy || ':' || p_subject;
  v_started_at timestamptz;
  v_used integer;
begin
  select policy.max_units, make_interval(secs => policy.window_seconds)
    into v_max_units, v_window
    from private.rate_limit_policy(p_policy) as policy;

  if v_max_units is null then
    raise exception 'unknown rate limit policy %', p_policy using errcode = '22023';
  end if;
  if p_cost is null or p_cost < 1 or p_cost > v_max_units then
    raise exception 'rate limit cost out of range for %', p_policy using errcode = '22023';
  end if;

  insert into private.rate_limit_buckets (bucket_key, window_started_at, used)
  values (v_key, now(), 0)
  on conflict (bucket_key) do nothing;

  select b.window_started_at, b.used
    into v_started_at, v_used
    from private.rate_limit_buckets b
   where b.bucket_key = v_key
     for update;

  if v_started_at + v_window <= now() then
    v_started_at := now();
    v_used := 0;
  end if;

  if v_used + p_cost > v_max_units then
    update private.rate_limit_buckets
       set window_started_at = v_started_at, used = v_used
     where bucket_key = v_key;
    return greatest(1::numeric, ceil(extract(epoch from (v_started_at + v_window) - now())))::integer;
  end if;

  update private.rate_limit_buckets
     set window_started_at = v_started_at, used = v_used + p_cost
   where bucket_key = v_key;
  return 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- API functions (EXECUTE granted to service_role only)
-- ---------------------------------------------------------------------------

-- Idempotent registration. The Edge Function sends SHA-256(registration key),
-- SHA-256(token), and the server-random salt the token was derived from. Replaying the
-- same registration key within the replay window, before the token is first used,
-- returns the stored salt so the Edge Function can re-derive the same token.
create function public.register_visitor_session(
  p_registration_hash text,
  p_token_hash text,
  p_token_salt text,
  p_network_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration_hash bytea := private.decode_sha256_hex(p_registration_hash);
  v_token_hash bytea := private.decode_sha256_hex(p_token_hash);
  v_token_salt bytea := private.decode_sha256_hex(p_token_salt);
  v_credential private.session_credentials;
  v_session public.visitor_sessions;
  v_retry_after integer;
begin
  perform private.assert_network_key(p_network_key);

  -- Serialize attempts that share a registration key (the unique index is the backstop).
  perform pg_advisory_xact_lock(hashtextextended('my-house:registration:' || p_registration_hash, 0));

  select c.*
    into v_credential
    from private.session_credentials c
   where c.registration_hash = v_registration_hash
     and c.created_at > now() - private.registration_replay_window();

  if found then
    select s.* into v_session from public.visitor_sessions s where s.id = v_credential.session_id;

    v_retry_after := private.take_rate_limit('session_requests', v_session.id::text);
    if v_retry_after > 0 then
      return private.rate_limited(v_retry_after);
    end if;

    return jsonb_build_object(
      'status', 'replayed',
      'tokenSalt', encode(v_credential.token_salt, 'hex'),
      'tokenHash', encode(v_credential.token_hash, 'hex'),
      'visitor', private.visitor_json(v_session));
  end if;

  -- Registration material past its window is detached, so a late replay of the same key
  -- creates a separate visitor and never reaches the original session.
  update private.session_credentials
     set registration_hash = null,
         token_salt = null
   where registration_hash = v_registration_hash;

  if p_network_key is not null then
    v_retry_after := private.take_rate_limit('network_registrations', p_network_key);
    if v_retry_after > 0 then
      return private.rate_limited(v_retry_after);
    end if;
  end if;

  v_retry_after := private.take_rate_limit('global_registrations', 'all');
  if v_retry_after > 0 then
    return private.rate_limited(v_retry_after);
  end if;

  insert into public.visitor_sessions (alias)
  values (private.random_alias())
  returning * into v_session;

  insert into private.session_credentials (session_id, token_hash, registration_hash, token_salt)
  values (v_session.id, v_token_hash, v_registration_hash, v_token_salt);

  return jsonb_build_object('status', 'created', 'visitor', private.visitor_json(v_session));
end;
$$;

create function public.resume_visitor_session(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.visitor_sessions :=
    private.find_active_session(private.decode_sha256_hex(p_token_hash));
  v_retry_after integer;
begin
  if v_session.id is null then
    return jsonb_build_object('status', 'invalid_session');
  end if;

  v_retry_after := private.take_rate_limit('session_requests', v_session.id::text);
  if v_retry_after > 0 then
    return private.rate_limited(v_retry_after);
  end if;

  update public.visitor_sessions s
     set last_active_at = now()
   where s.id = v_session.id
  returning s.* into v_session;

  if not found then
    return jsonb_build_object('status', 'invalid_session');
  end if;

  perform private.consume_registration(v_session.id);

  return jsonb_build_object('status', 'resumed', 'visitor', private.visitor_json(v_session));
end;
$$;

-- p_object_name is derived by the Edge Function from its server-side prize catalog.
create function public.record_prize_award(
  p_token_hash text,
  p_award_id uuid,
  p_prize_id text,
  p_object_name text,
  p_adjective text,
  p_location text,
  p_network_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.visitor_sessions :=
    private.find_active_session(private.decode_sha256_hex(p_token_hash));
  v_award public.prize_awards;
  v_retry_after integer;
begin
  perform private.assert_network_key(p_network_key);
  if p_award_id is null then
    raise exception 'award id is required' using errcode = '22023';
  end if;

  if v_session.id is null then
    return jsonb_build_object('status', 'invalid_session');
  end if;

  v_retry_after := private.take_rate_limit('session_requests', v_session.id::text);
  if v_retry_after > 0 then
    return private.rate_limited(v_retry_after);
  end if;

  -- Retries of an already-recorded award skip the creation limits.
  select a.* into v_award from public.prize_awards a where a.id = p_award_id;
  if found then
    return private.award_replay_result(v_award, v_session, p_prize_id, p_adjective, p_location);
  end if;

  v_retry_after := private.take_rate_limit('session_awards', v_session.id::text);
  if v_retry_after > 0 then
    return private.rate_limited(v_retry_after);
  end if;

  if p_network_key is not null then
    v_retry_after := private.take_rate_limit('network_awards', p_network_key);
    if v_retry_after > 0 then
      return private.rate_limited(v_retry_after);
    end if;
  end if;

  v_retry_after := private.take_rate_limit('global_awards', 'all');
  if v_retry_after > 0 then
    return private.rate_limited(v_retry_after);
  end if;

  -- Lock the session row before the insert, whose trigger touches site_stats last.
  update public.visitor_sessions s
     set last_active_at = now()
   where s.id = v_session.id
  returning s.* into v_session;

  if not found then
    return jsonb_build_object('status', 'invalid_session');
  end if;

  perform private.consume_registration(v_session.id);

  insert into public.prize_awards (id, session_id, prize_id, object_name, adjective, location)
  values (p_award_id, v_session.id, p_prize_id, p_object_name, p_adjective, p_location)
  on conflict (id) do nothing
  returning * into v_award;

  if not found then
    -- A concurrent request committed the same award id first.
    select a.* into v_award from public.prize_awards a where a.id = p_award_id;
    return private.award_replay_result(v_award, v_session, p_prize_id, p_adjective, p_location);
  end if;

  return jsonb_build_object(
    'status', 'created',
    'award', private.award_json(v_award, v_session.visitor_number, v_session.alias));
end;
$$;

-- The client reports its cumulative knock total for the session. Lower or repeated totals
-- change nothing, so retries are safe. Limits are all-or-nothing: a rate_limited result
-- records nothing from that request.
create function public.record_knocks(p_token_hash text, p_total_knocks integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.visitor_sessions :=
    private.find_active_session(private.decode_sha256_hex(p_token_hash));
  v_retry_after integer;
  v_previous integer;
  v_knock_count integer;
begin
  if p_total_knocks is null or p_total_knocks < 0 or p_total_knocks > private.max_session_knocks() then
    raise exception 'total knocks out of range' using errcode = '22023';
  end if;

  if v_session.id is null then
    return jsonb_build_object('status', 'invalid_session');
  end if;

  v_retry_after := private.take_rate_limit('session_requests', v_session.id::text);
  if v_retry_after > 0 then
    return private.rate_limited(v_retry_after);
  end if;

  if p_total_knocks > v_session.knock_count then
    if p_total_knocks > private.knock_cap(v_session.started_at) then
      return private.rate_limited(private.knock_cap_retry_after(v_session.started_at, p_total_knocks));
    end if;

    -- Reserved from the unlocked count. The locked count can only be higher, so the
    -- increment applied below never exceeds the reservation.
    v_retry_after := private.take_rate_limit(
      'global_knocks', 'all', p_total_knocks - v_session.knock_count);
    if v_retry_after > 0 then
      return private.rate_limited(v_retry_after);
    end if;
  end if;

  select s.knock_count
    into v_previous
    from public.visitor_sessions s
   where s.id = v_session.id
     for update;

  if not found then
    return jsonb_build_object('status', 'invalid_session');
  end if;

  v_knock_count := greatest(v_previous, p_total_knocks);

  update public.visitor_sessions s
     set knock_count = v_knock_count,
         last_active_at = now()
   where s.id = v_session.id;

  perform private.consume_registration(v_session.id);

  return jsonb_build_object(
    'status', 'ok',
    'knockCount', v_knock_count,
    'accepted', v_knock_count - v_previous);
end;
$$;

-- Newest-first page of public guestbook fields plus the site totals, read from a single
-- snapshot. The cursor is the award id of the last entry on the previous page.
create function public.get_guestbook_page(p_limit integer default 20, p_cursor uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stats jsonb;
  v_after_awarded_at timestamptz := 'infinity'::timestamptz;
  v_after_id uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid;
  v_entries jsonb;
  v_row_count integer;
  v_last_id uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'limit must be between 1 and 50' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'visitorCount', s.visitor_count,
           'giftsGiven', s.gifts_given,
           'doorKnocks', s.door_knocks)
    into v_stats
    from public.site_stats s
   where s.id = 1;

  if v_stats is null then
    raise exception 'site_stats row is missing' using errcode = 'P0002';
  end if;

  if p_cursor is not null then
    select a.awarded_at, a.id
      into v_after_awarded_at, v_after_id
      from public.prize_awards a
     where a.id = p_cursor;

    if not found then
      return jsonb_build_object('status', 'invalid_cursor');
    end if;
  end if;

  with page as (
    select a.id, a.prize_id, a.object_name, a.adjective, a.location, a.awarded_at,
           s.visitor_number, s.alias,
           row_number() over (order by a.awarded_at desc, a.id desc) as position
      from (
        select *
          from public.prize_awards
         where (awarded_at, id) < (v_after_awarded_at, v_after_id)
         order by awarded_at desc, id desc
         limit p_limit + 1
      ) as a
      join public.visitor_sessions s on s.id = a.session_id
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'awardId', page.id,
               'visitorNumber', page.visitor_number,
               'alias', page.alias,
               'prizeId', page.prize_id,
               'objectName', page.object_name,
               'adjective', page.adjective,
               'location', page.location,
               'awardedAt', private.iso_utc(page.awarded_at))
             order by page.position)
             filter (where page.position <= p_limit),
           '[]'::jsonb),
         count(*)::integer,
         (array_agg(page.id order by page.position) filter (where page.position = p_limit))[1]
    into v_entries, v_row_count, v_last_id
    from page;

  return jsonb_build_object(
    'status', 'ok',
    'stats', v_stats,
    'entries', v_entries,
    'nextCursor', case when v_row_count > p_limit then v_last_id end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Maintenance (run as postgres, e.g. from pg_cron or the SQL editor)
-- ---------------------------------------------------------------------------

create function private.cleanup_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired_credentials integer;
  v_cleared_registrations integer;
  v_stale_buckets integer;
begin
  delete from private.session_credentials c
   using public.visitor_sessions s
   where s.id = c.session_id
     and (c.created_at <= now() - private.session_max_age()
          or s.last_active_at <= now() - private.session_idle_timeout());
  get diagnostics v_expired_credentials = row_count;

  update private.session_credentials
     set registration_hash = null,
         token_salt = null
   where registration_hash is not null
     and created_at <= now() - private.registration_replay_window();
  get diagnostics v_cleared_registrations = row_count;

  -- The longest rate-limit window is 10 minutes.
  delete from private.rate_limit_buckets
   where window_started_at <= now() - interval '1 day';
  get diagnostics v_stale_buckets = row_count;

  return jsonb_build_object(
    'expiredCredentials', v_expired_credentials,
    'clearedRegistrations', v_cleared_registrations,
    'staleRateLimitBuckets', v_stale_buckets);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.session_idle_timeout(),
  private.session_max_age(),
  private.registration_replay_window(),
  private.max_session_knocks(),
  private.knock_cap(timestamptz),
  private.knock_cap_retry_after(timestamptz, integer),
  private.rate_limit_policy(text),
  private.alias_pool(),
  private.random_alias(),
  private.decode_sha256_hex(text),
  private.assert_network_key(text),
  private.iso_utc(timestamptz),
  private.visitor_json(public.visitor_sessions),
  private.award_json(public.prize_awards, bigint, text),
  private.award_replay_result(public.prize_awards, public.visitor_sessions, text, text, text),
  private.rate_limited(integer),
  private.find_active_session(bytea),
  private.consume_registration(uuid),
  private.take_rate_limit(text, text, integer),
  private.cleanup_expired_data()
from public, anon, authenticated, service_role;

revoke all on function
  public.register_visitor_session(text, text, text, text),
  public.resume_visitor_session(text),
  public.record_prize_award(text, uuid, text, text, text, text, text),
  public.record_knocks(text, integer),
  public.get_guestbook_page(integer, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.register_visitor_session(text, text, text, text),
  public.resume_visitor_session(text),
  public.record_prize_award(text, uuid, text, text, text, text, text),
  public.record_knocks(text, integer),
  public.get_guestbook_page(integer, uuid)
to service_role;
