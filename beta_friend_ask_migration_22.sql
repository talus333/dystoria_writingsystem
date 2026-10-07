-- ============================================================
--  DYSTORIA — ASK A FRIEND TO BE YOUR BETA READER  (migration 22, v.935)
--  Supabase dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run. Builds on migration 17 (the beta-reader exchange) and 13 (friends). Run migration 21 too; the order
--  between 21 and 22 does not matter.
--
--  [Jeremy] "a writer should also be able to be a beta reader even if they didn't get invited to the app this way. where is
--  the best place for them to opt into the beta reader path, and can they also do it from the profile and get a prompt from a
--  friend to get added?"
--
--  What it adds:
--    • beta_ask_friend(to, note) — ask a FRIEND to read for you, whether or not they are in the exchange. It is an ordinary
--      ask to read (nothing owed back), so the same email goes out and it shows in their Beta readers.
--    • beta_respond takes a third answer, the 18+ box: a friend who is not in the exchange yet can say yes, and gets a
--      PRIVATE reader profile (not in the directory) exactly as someone who joined from an invitation link does. They choose
--      afterwards, in the app, whether other writers may find them too.
--    • "Not now" to a friend's ask is quiet: the ask is put away (beta_links.dismissed_at) instead of deleted, so the friend
--      who asked still sees "waiting" and cannot ask again for 21 days.
--  The app works before this is run (asking a friend says it needs this update); everything else is unchanged.
-- ============================================================

alter table public.beta_links add column if not exists via          text;
alter table public.beta_links add column if not exists dismissed_at timestamptz;

-- ---------------------------------------------------------------- ask a friend
-- Returns 'ok' | 'accepted' (they had already offered to read for you) | 'opt_in' (join the exchange first) | 'self'
--         | 'not_friend' | 'already' (they read for you, or you asked in the last 21 days) | 'rate' | 'blocked'
create or replace function public.beta_ask_friend(a_to uuid, a_note text default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); l public.beta_links%rowtype; n int;
begin
  if a_to is null or a_to = v_me then return 'self'; end if;
  if not public._beta_opted(v_me) then return 'opt_in'; end if;
  if public._blocked_either(v_me, a_to) then return 'blocked'; end if;
  if not public._are_partners(v_me, a_to) then return 'not_friend'; end if;
  select * into l from public.beta_links where a = least(v_me, a_to) and b = greatest(v_me, a_to) for update;
  if found then
    if l.status = 'accepted' then
      return 'already';   -- they read for you already; or you read for them (ask to swap from Beta readers): a friend's ask never undoes a link
    elsif l.requested_by = a_to and l.kind = 'read' and l.reader = a_to then
      update public.beta_links set status = 'accepted', responded_at = now(), dismissed_at = null where a = l.a and b = l.b;
      return 'accepted';
    elsif l.requested_by = v_me and l.created_at > now() - interval '21 days' then
      return 'already';   -- one ask per person per 21 days, answered or not
    else
      delete from public.beta_links where a = l.a and b = l.b;
    end if;
  end if;
  select count(*) into n from public.beta_links where requested_by = v_me and created_at > now() - interval '1 day';
  if n >= 15 then return 'rate'; end if;
  insert into public.beta_links (a, b, status, requested_by, note, kind, reader, via)
    values (least(v_me, a_to), greatest(v_me, a_to), 'pending', v_me, nullif(left(trim(coalesce(a_note, '')), 300), ''), 'read', a_to, 'friend');
  return 'ok';
end; $$;

-- ---------------------------------------------------------------- answering
-- Returns 'ok' | 'not_found' | 'no_swap' | 'adult' (not in the exchange yet: the 18+ box is required to say yes)
drop function if exists public.beta_respond(uuid, boolean);
create or replace function public.beta_respond(a_other uuid, a_accept boolean, a_adult boolean default false)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); l public.beta_links%rowtype;
begin
  select * into l from public.beta_links where a = least(v_me, a_other) and b = greatest(v_me, a_other) and status = 'pending' and requested_by = a_other for update;
  if not found then return 'not_found'; end if;
  if a_accept then
    if not public._beta_opted(v_me) then
      -- only an ask to READ can bring someone in, and it makes a private reader profile (not in the directory)
      if l.kind <> 'read' or l.reader is distinct from v_me then return 'not_found'; end if;
      if a_adult is not true then return 'adult'; end if;
      insert into public.beta_profiles (user_id, open, adult, swap, volunteer) values (v_me, true, true, false, false)
        on conflict (user_id) do update set adult = true, updated_at = now();
    end if;
    if l.kind = 'swap' and not exists (select 1 from public.beta_profiles where user_id = v_me and swap) then return 'no_swap'; end if;
    update public.beta_links set status = 'accepted', responded_at = now(), dismissed_at = null where a = l.a and b = l.b;
  elsif l.via = 'friend' then
    update public.beta_links set dismissed_at = now() where a = l.a and b = l.b;   -- quiet: the friend who asked still sees "waiting"
  else
    delete from public.beta_links where a = l.a and b = l.b;
  end if;
  return 'ok';
end; $$;

-- ---------------------------------------------------------------- your group (an ask you put away no longer shows to you)
create or replace function public.beta_group()
returns table(user_id uuid, name text, status text, requested_by_me boolean, note text, i_read int, they_read int,
              reading_mine int, i_am_reading int, capacity int, active int, open boolean, opted boolean, since timestamptz, rel text)
language plpgsql stable security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me();
begin
  return query
    select o.uid, public._beta_name(o.uid), l.status, (l.requested_by = v_me), l.note,
           public._beta_done(v_me, o.uid), public._beta_done(o.uid, v_me),
           (select count(*)::int from public.beta_reads r join public.beta_sends s on s.id = r.send_id where s.author = v_me and r.reader = o.uid and r.status = 'reading'),
           (select count(*)::int from public.beta_reads r join public.beta_sends s on s.id = r.send_id where s.author = o.uid and r.reader = v_me and r.status = 'reading'),
           coalesce(p.capacity, 0), public._beta_active(o.uid), coalesce(p.open, false), (p.user_id is not null and p.adult), coalesce(l.responded_at, l.created_at),
           case when l.kind = 'swap' then 'swap' when l.reader = o.uid then 'reads_for_me' else 'i_read_for' end
      from public.beta_links l
      cross join lateral (select case when l.a = v_me then l.b else l.a end as uid) o
      left join public.beta_profiles p on p.user_id = o.uid
     where (l.a = v_me or l.b = v_me)
       and (l.status = 'accepted' or l.created_at > now() - interval '21 days')
       and not (l.status = 'pending' and l.dismissed_at is not null and l.requested_by <> v_me)
       and not public._blocked_either(v_me, o.uid)
     order by (l.status = 'pending' and l.requested_by <> v_me) desc, (l.status = 'accepted') desc, public._beta_name(o.uid);
end; $$;

-- ---------------------------------------------------------------- the emails (an ask already put away is not emailed)
create or replace function public.notice_batch_beta()
returns table(kind text, id uuid, email text, from_name text, title text, token uuid, note text, due date)
language sql security definer stable set search_path = public, auth as $$
  select 'read'::text, r.id, u.email, public._beta_name(s.author), s.title, r.token, s.notes, s.due
    from public.beta_reads r join public.beta_sends s on s.id = r.send_id join auth.users u on u.id = r.reader
   where r.emailed_at is null and r.status = 'reading' and r.created_at > now() - interval '3 days' and u.email is not null
  union all
  select 'ask'::text, l.id, u.email, public._beta_name(l.requested_by),
         (case when l.kind = 'swap' then 'swap' when l.reader = l.requested_by then 'offer' else 'read' end)::text, null::uuid, l.note, null::date
    from public.beta_links l join auth.users u on u.id = (case when l.a = l.requested_by then l.b else l.a end)
   where l.emailed_at is null and l.status = 'pending' and l.dismissed_at is null and l.created_at > now() - interval '3 days' and u.email is not null
  union all
  select 'invite'::text, i.id, i.email, public._beta_name(i.author), null::text, i.token, i.note, null::date
    from public.beta_invites i
   where i.kind = 'email' and i.send and i.emailed_at is null and i.status = 'open' and i.created_at > now() - interval '3 days'
  limit 300;
$$;
revoke all on function public.notice_batch_beta() from public, anon, authenticated;
do $$ begin grant execute on function public.notice_batch_beta() to service_role; exception when undefined_object then null; end $$;

-- ---------------------------------------------------------------- who may call what
do $$ declare f text; begin
  foreach f in array array['beta_ask_friend(uuid, text)', 'beta_respond(uuid, boolean, boolean)', 'beta_group()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

notify pgrst, 'reload schema';
-- Done.
