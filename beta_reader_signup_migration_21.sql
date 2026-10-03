-- ============================================================
--  DYSTORIA — BETA READER SIGN-UP QUESTIONS  (migration 21, v.934)
--  Supabase dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run. Builds on migration 17 (the beta-reader exchange).
--
--  [Jeremy] "what is the current path for someone who may want to be just a beta tester? ... do they have a landing page
--  with questions they can answer that will put them in the database for people searching? ... willing to beta test for
--  others. interested in specific genres? interested in reviewing sections or full stories?"
--
--  What it adds:
--    • beta_profiles.portions — how much a reader takes on at a time: 'section' (a chapter or section), 'short' (a short
--      story), 'full' (a whole novel).
--    • beta_profiles.feedback — the kind of notes they give: 'reader' (gut reactions), 'story' (big-picture), 'line'
--      (line-level).
--    • beta_profile_get / beta_profile_set / beta_directory carry the two new fields. An older app that does not send them
--      leaves them as they are (null = keep).
--  The app works before this is run (it saves everything else and skips the two new answers); run it to keep them.
-- ============================================================

alter table public.beta_profiles add column if not exists portions text[] not null default '{}';
alter table public.beta_profiles add column if not exists feedback text[] not null default '{}';

-- ---------------------------------------------------------------- your profile
create or replace function public.beta_profile_get()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); p public.beta_profiles%rowtype;
begin
  select * into p from public.beta_profiles where user_id = v_me;
  if not found then return null; end if;
  return jsonb_build_object('open', p.open, 'adult', p.adult, 'reads', to_jsonb(p.reads), 'lengths', to_jsonb(p.lengths),
    'capacity', p.capacity, 'wont', p.wont, 'about', p.about, 'turnaround', p.turnaround, 'active', public._beta_active(v_me),
    'swap', p.swap, 'volunteer', p.volunteer, 'portions', to_jsonb(p.portions), 'feedback', to_jsonb(p.feedback));
end; $$;

-- Returns 'ok' | 'adult' (the 18+ box is required)
drop function if exists public.beta_profile_set(text[], text[], int, text, text, text, boolean, boolean, boolean, boolean);
create or replace function public.beta_profile_set(a_reads text[], a_lengths text[], a_capacity int, a_wont text, a_about text,
                                                   a_turnaround text, a_open boolean, a_adult boolean,
                                                   a_swap boolean default true, a_volunteer boolean default false,
                                                   a_portions text[] default null, a_feedback text[] default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); v_reads text[]; v_len text[]; v_por text[]; v_fb text[];
begin
  if a_adult is not true then return 'adult'; end if;
  select coalesce(array_agg(distinct left(trim(x), 40)) filter (where trim(x) <> ''), '{}') into v_reads
    from unnest(coalesce(a_reads, '{}')) as x limit 1;
  v_reads := v_reads[1:20];
  select coalesce(array_agg(distinct x) filter (where x in ('short', 'novella', 'novel', 'essay', 'poetry')), '{}') into v_len
    from unnest(coalesce(a_lengths, '{}')) as x;
  -- null = an app that does not ask yet: keep what is there
  if a_portions is not null then
    select coalesce(array_agg(distinct x) filter (where x in ('section', 'short', 'full')), '{}') into v_por from unnest(a_portions) as x;
  end if;
  if a_feedback is not null then
    select coalesce(array_agg(distinct x) filter (where x in ('reader', 'story', 'line')), '{}') into v_fb from unnest(a_feedback) as x;
  end if;
  insert into public.beta_profiles (user_id, open, adult, reads, lengths, capacity, wont, about, turnaround, swap, volunteer, portions, feedback, updated_at)
    values (v_me, coalesce(a_open, true), true, v_reads, v_len, greatest(1, least(5, coalesce(a_capacity, 2))),
            nullif(left(trim(coalesce(a_wont, '')), 300), ''), nullif(left(trim(coalesce(a_about, '')), 300), ''),
            nullif(left(trim(coalesce(a_turnaround, '')), 60), ''), coalesce(a_swap, true), coalesce(a_volunteer, false),
            coalesce(v_por, '{}'), coalesce(v_fb, '{}'), now())
    on conflict (user_id) do update set open = excluded.open, adult = true, reads = excluded.reads, lengths = excluded.lengths,
      capacity = excluded.capacity, wont = excluded.wont, about = excluded.about, turnaround = excluded.turnaround,
      swap = excluded.swap, volunteer = excluded.volunteer,
      portions = case when a_portions is null then public.beta_profiles.portions else excluded.portions end,
      feedback = case when a_feedback is null then public.beta_profiles.feedback else excluded.feedback end,
      updated_at = now();
  return 'ok';
end; $$;

-- ---------------------------------------------------------------- the directory (two more columns)
drop function if exists public.beta_directory(text);
create or replace function public.beta_directory(a_read text default null)
returns table(user_id uuid, name text, reads text[], lengths text[], capacity int, active int, open boolean,
              about text, wont text, turnaround text, link text, swap boolean, volunteer boolean,
              portions text[], feedback text[])
language plpgsql stable security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me();
begin
  if not public._beta_opted(v_me) then raise exception 'opt_in'; end if;
  -- link: none | sent | received (an ask either way, 21 days) | swap | reads_for_me | i_read_for
  return query
    select p.user_id, public._beta_name(p.user_id), p.reads, p.lengths, p.capacity, public._beta_active(p.user_id), p.open,
           p.about, p.wont, p.turnaround,
           coalesce((select case when l.status = 'accepted' then (case when l.kind = 'swap' then 'swap' when l.reader = p.user_id then 'reads_for_me' else 'i_read_for' end)
                                 when l.requested_by = v_me then 'sent' else 'received' end
                       from public.beta_links l
                      where l.a = least(v_me, p.user_id) and l.b = greatest(v_me, p.user_id)
                        and (l.status = 'accepted' or l.created_at > now() - interval '21 days')), 'none'),
           p.swap, p.volunteer, p.portions, p.feedback
      from public.beta_profiles p
     where p.user_id <> v_me and p.adult and (p.swap or p.volunteer)
       and not public._blocked_either(v_me, p.user_id)
       and (a_read is null or trim(a_read) = '' or exists (select 1 from unnest(p.reads) r where lower(r) = lower(trim(a_read))))
     order by (p.open and public._beta_active(p.user_id) < p.capacity) desc, public._beta_name(p.user_id)
     limit 100;
end; $$;

-- ---------------------------------------------------------------- who may call what
do $$ declare f text; begin
  foreach f in array array[
    'beta_profile_get()',
    'beta_profile_set(text[], text[], int, text, text, text, boolean, boolean, boolean, boolean, text[], text[])',
    'beta_directory(text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

notify pgrst, 'reload schema';
-- Done.
