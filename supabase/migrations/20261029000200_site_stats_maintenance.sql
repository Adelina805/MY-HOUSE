-- Keeps public.site_stats equal to
--   (count(visitor_sessions), count(prize_awards), sum(visitor_sessions.knock_count))
-- inside the same transaction as every write, and provides a race-safe rebuild.
--
-- Locking contract (see supabase/README.md):
--   * Every write that changes a total updates the site_stats row from an AFTER ROW
--     trigger, which is always the last lock a writer takes.
--   * private.rebuild_site_stats() takes only an EXCLUSIVE lock on site_stats. That waits
--     for in-flight writers to commit and holds new writers at their stats update, while
--     plain reads continue.

create function private.site_stats_on_visitor_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_visitor_delta bigint := 0;
  v_knock_delta bigint := 0;
begin
  if tg_op = 'INSERT' then
    v_visitor_delta := 1;
    v_knock_delta := new.knock_count;
  elsif tg_op = 'DELETE' then
    v_visitor_delta := -1;
    v_knock_delta := -old.knock_count;
  else
    v_knock_delta := new.knock_count - old.knock_count;
  end if;

  if v_visitor_delta = 0 and v_knock_delta = 0 then
    return null;
  end if;

  update public.site_stats
     set visitor_count = visitor_count + v_visitor_delta,
         door_knocks = door_knocks + v_knock_delta,
         updated_at = now()
   where id = 1;

  if not found then
    raise exception 'site_stats row is missing; run private.rebuild_site_stats()'
      using errcode = 'P0002';
  end if;

  return null;
end;
$$;

create trigger visitor_sessions_site_stats
after insert or delete or update of knock_count on public.visitor_sessions
for each row execute function private.site_stats_on_visitor_change();

create function private.site_stats_on_award_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.site_stats
     set gifts_given = gifts_given + case tg_op when 'INSERT' then 1 else -1 end,
         updated_at = now()
   where id = 1;

  if not found then
    raise exception 'site_stats row is missing; run private.rebuild_site_stats()'
      using errcode = 'P0002';
  end if;

  return null;
end;
$$;

create trigger prize_awards_site_stats
after insert or delete on public.prize_awards
for each row execute function private.site_stats_on_award_change();

create function private.rebuild_site_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_before jsonb;
  v_visitor_count bigint;
  v_gifts_given bigint;
  v_door_knocks bigint;
begin
  -- Under REPEATABLE READ or SERIALIZABLE the snapshot is fixed before the lock below is
  -- granted, so the recount could miss writers that committed while this call waited.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'rebuild_site_stats() must run in a READ COMMITTED transaction (current: %)',
      current_setting('transaction_isolation')
      using errcode = '25000';
  end if;

  lock table public.site_stats in exclusive mode;

  select jsonb_build_object(
           'visitorCount', s.visitor_count,
           'giftsGiven', s.gifts_given,
           'doorKnocks', s.door_knocks)
    into v_before
    from public.site_stats s
   where s.id = 1;

  -- One statement, one snapshot, taken after the lock was granted.
  select (select count(*) from public.visitor_sessions),
         (select count(*) from public.prize_awards),
         (select coalesce(sum(knock_count), 0) from public.visitor_sessions)
    into v_visitor_count, v_gifts_given, v_door_knocks;

  insert into public.site_stats as s (id, visitor_count, gifts_given, door_knocks, updated_at)
  values (1, v_visitor_count, v_gifts_given, v_door_knocks, now())
  on conflict (id) do update
    set visitor_count = excluded.visitor_count,
        gifts_given = excluded.gifts_given,
        door_knocks = excluded.door_knocks,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'before', v_before,
    'after', jsonb_build_object(
      'visitorCount', v_visitor_count,
      'giftsGiven', v_gifts_given,
      'doorKnocks', v_door_knocks));
end;
$$;

comment on function private.rebuild_site_stats() is
  'Recomputes site_stats from the domain tables. Safe to run during live traffic.';

-- TRUNCATE skips row triggers, so recompute the totals in the same transaction.
create function private.site_stats_after_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.rebuild_site_stats();
  return null;
end;
$$;

create trigger visitor_sessions_truncate_site_stats
after truncate on public.visitor_sessions
for each statement execute function private.site_stats_after_truncate();

create trigger prize_awards_truncate_site_stats
after truncate on public.prize_awards
for each statement execute function private.site_stats_after_truncate();

revoke all on function
  private.site_stats_on_visitor_change(),
  private.site_stats_on_award_change(),
  private.rebuild_site_stats(),
  private.site_stats_after_truncate()
from public, anon, authenticated, service_role;
