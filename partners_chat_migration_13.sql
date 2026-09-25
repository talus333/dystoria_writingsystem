-- ============================================================
--  DYSTORIA — WRITING PARTNERS, ONLINE DOTS, ONE-TO-ONE CHAT  (migration 13, v.822)
--  Supabase dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run. Builds on migrations 1, 2 and 12.
--
--  Jeremy's decisions (2026-09-25): partners are automatic from co-writing ·
--  online status is visible to partners by default · chat is one-to-one.
--
--  What it adds:
--    • partnerships  — two writers, one row (a < b). Made automatically when someone
--        joins a story as a co-author (and backfilled for every existing co-author),
--        or by a request one accepts.
--    • blocks        — a writer you never hear from again (removes the partnership too).
--    • profiles.last_seen_at / show_online (default ON) / show_activity (default OFF) / activity
--    • messages      — one-to-one, between partners only; readable only by its two people.
--    • touch_presence, set_presence_prefs, my_partners, request_partner, respond_partner,
--      remove_partner, block_user, send_message, my_thread, mark_read, shared_stories
--    • messages joins the realtime publication, so a new message arrives live
--      (Realtime applies the table's row-level security to every listener).
-- ============================================================

-- ----------------------------------------------------------------
-- 1. PARTNERSHIPS + BLOCKS
-- ----------------------------------------------------------------
create table if not exists public.partnerships (
  a            uuid not null references auth.users(id) on delete cascade,
  b            uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'accepted',
  requested_by uuid references auth.users(id) on delete set null,
  source       text not null default 'coauthor',
  created_at   timestamptz not null default now(),
  primary key (a, b),
  constraint partnerships_order_chk  check (a < b),
  constraint partnerships_status_chk check (status in ('pending', 'accepted')),
  constraint partnerships_source_chk check (source in ('coauthor', 'request'))
);
create index if not exists partnerships_b on public.partnerships (b);
alter table public.partnerships enable row level security;
revoke all on public.partnerships from anon, authenticated;
grant select on public.partnerships to authenticated;
drop policy if exists partnerships_select_own on public.partnerships;
create policy partnerships_select_own on public.partnerships
  for select to authenticated using (a = auth.uid() or b = auth.uid());

create table if not exists public.blocks (
  blocker    uuid not null references auth.users(id) on delete cascade,
  blocked    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;
grant select on public.blocks to authenticated;
drop policy if exists blocks_select_own on public.blocks;
create policy blocks_select_own on public.blocks for select to authenticated using (blocker = auth.uid());

create or replace function public._blocked_either(x uuid, y uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.blocks where (blocker = x and blocked = y) or (blocker = y and blocked = x));
$$;
revoke all on function public._blocked_either(uuid, uuid) from public, anon, authenticated;

create or replace function public._are_partners(x uuid, y uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.partnerships
                  where a = least(x, y) and b = greatest(x, y) and status = 'accepted');
$$;
revoke all on function public._are_partners(uuid, uuid) from public, anon, authenticated;

-- co-writing makes partners: whenever someone joins a story, they and its owner are partners
create or replace function public._partner_on_collab()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner into v_owner from public.stories where id = new.story_id;
  if v_owner is null or v_owner = new.user_id or public._blocked_either(v_owner, new.user_id) then return new; end if;
  insert into public.partnerships (a, b, status, source)
    values (least(v_owner, new.user_id), greatest(v_owner, new.user_id), 'accepted', 'coauthor')
    on conflict (a, b) do update set status = 'accepted';
  return new;
end; $$;
drop trigger if exists on_collab_partner on public.story_collaborators;
create trigger on_collab_partner after insert on public.story_collaborators
  for each row execute function public._partner_on_collab();

-- everyone already co-writing is a partner already
insert into public.partnerships (a, b, status, source)
  select distinct least(s.owner, c.user_id), greatest(s.owner, c.user_id), 'accepted', 'coauthor'
    from public.story_collaborators c join public.stories s on s.id = c.story_id
   where s.owner is not null and s.owner <> c.user_id
  on conflict (a, b) do nothing;

-- ----------------------------------------------------------------
-- 2. PRESENCE on profiles (a heartbeat, not a realtime channel)
-- ----------------------------------------------------------------
alter table public.profiles add column if not exists last_seen_at  timestamptz;
alter table public.profiles add column if not exists show_online   boolean not null default true;
alter table public.profiles add column if not exists show_activity boolean not null default false;
alter table public.profiles add column if not exists activity      text;

create or replace function public.touch_presence(a_activity text default null)
returns void language sql security definer set search_path = public as $$
  update public.profiles
     set last_seen_at = now(),
         activity = case when show_activity then nullif(left(trim(coalesce(a_activity, '')), 80), '') else null end
   where id = auth.uid() and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false;
$$;
revoke all on function public.touch_presence(text) from public, anon;
grant execute on function public.touch_presence(text) to authenticated;

create or replace function public.set_presence_prefs(a_show_online boolean, a_show_activity boolean)
returns void language sql security definer set search_path = public as $$
  update public.profiles
     set show_online = coalesce(a_show_online, show_online),
         show_activity = coalesce(a_show_activity, show_activity),
         activity = case when coalesce(a_show_activity, show_activity) then activity else null end
   where id = auth.uid();
$$;
revoke all on function public.set_presence_prefs(boolean, boolean) from public, anon;
grant execute on function public.set_presence_prefs(boolean, boolean) to authenticated;

-- ----------------------------------------------------------------
-- 3. MESSAGES
-- ----------------------------------------------------------------
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  sender     uuid not null references auth.users(id) on delete cascade,
  recipient  uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  constraint messages_body_chk check (length(body) between 1 and 2000),
  constraint messages_two_people_chk check (sender <> recipient)
);
create index if not exists messages_pair on public.messages (least(sender, recipient), greatest(sender, recipient), created_at desc);
create index if not exists messages_unread on public.messages (recipient, sender) where read_at is null;
create index if not exists messages_sender_time on public.messages (sender, created_at);
alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
  for select to authenticated using (sender = auth.uid() or recipient = auth.uid());
-- no insert / update / delete policies: send_message and mark_read do it

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ----------------------------------------------------------------
-- 4. THE FUNCTIONS
-- ----------------------------------------------------------------
-- My partners, with a green dot only where they allow it, and my unread count from each.
create or replace function public.my_partners()
returns table(user_id uuid, username text, status text, requested_by_me boolean, online boolean,
              last_seen_at timestamptz, activity text, unread int, source text)
language sql security definer stable set search_path = public as $$
  select o.id,
         coalesce(nullif(trim(p.username), ''), split_part(p.email, '@', 1), 'A writer'),
         t.status,
         (t.requested_by = auth.uid()),
         coalesce(t.status = 'accepted' and p.show_online and p.last_seen_at > now() - interval '150 seconds', false),
         case when t.status = 'accepted' and p.show_online then p.last_seen_at end,
         case when t.status = 'accepted' and p.show_online and p.show_activity
               and p.last_seen_at > now() - interval '150 seconds' then p.activity end,
         (select count(*)::int from public.messages m where m.recipient = auth.uid() and m.sender = o.id and m.read_at is null),
         t.source
    from public.partnerships t
    cross join lateral (select case when t.a = auth.uid() then t.b else t.a end as id) o
    left join public.profiles p on p.id = o.id
   where (t.a = auth.uid() or t.b = auth.uid())
     and not public._blocked_either(t.a, t.b)
   order by 5 desc, 2;
$$;
revoke all on function public.my_partners() from public, anon;
grant execute on function public.my_partners() to authenticated;

-- Ask someone to be a partner, by email or username. The answer is always 'ok', whether or not
-- the person exists (so it can't be used to find out who uses Dystoria); 'self' and 'rate' are the exceptions.
create or replace function public.request_partner(who text)
returns text language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_to uuid; v_w text := lower(trim(coalesce(who, ''))); n int;
begin
  if v_me is null then raise exception 'sign-in required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then return 'ok'; end if;
  select count(*) into n from public.partnerships where requested_by = v_me and created_at > now() - interval '1 day';
  if n >= 20 then return 'rate'; end if;
  select id into v_to from public.profiles where lower(email) = v_w or lower(username) = v_w limit 1;
  if v_to = v_me then return 'self'; end if;
  if v_to is null or public._blocked_either(v_me, v_to) then return 'ok'; end if;
  insert into public.partnerships (a, b, status, requested_by, source)
    values (least(v_me, v_to), greatest(v_me, v_to), 'pending', v_me, 'request')
    on conflict (a, b) do update
      set status = case when public.partnerships.status = 'pending' and public.partnerships.requested_by <> v_me then 'accepted' else public.partnerships.status end;
  return 'ok';
end; $$;
revoke all on function public.request_partner(text) from public, anon;
grant execute on function public.request_partner(text) to authenticated;

create or replace function public.respond_partner(other uuid, accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'sign-in required'; end if;
  if accept then
    update public.partnerships set status = 'accepted'
     where a = least(v_me, other) and b = greatest(v_me, other) and status = 'pending' and requested_by = other;
  else
    delete from public.partnerships
     where a = least(v_me, other) and b = greatest(v_me, other) and status = 'pending' and requested_by = other;
  end if;
  if not found then return 'not_found'; end if;
  return 'ok';
end; $$;
revoke all on function public.respond_partner(uuid, boolean) from public, anon;
grant execute on function public.respond_partner(uuid, boolean) to authenticated;

create or replace function public.remove_partner(other uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  delete from public.partnerships where a = least(auth.uid(), other) and b = greatest(auth.uid(), other);
  return 'ok';
end; $$;
revoke all on function public.remove_partner(uuid) from public, anon;
grant execute on function public.remove_partner(uuid) to authenticated;

create or replace function public.block_user(other uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if other = auth.uid() then return 'self'; end if;
  insert into public.blocks (blocker, blocked) values (auth.uid(), other) on conflict do nothing;
  delete from public.partnerships where a = least(auth.uid(), other) and b = greatest(auth.uid(), other);
  return 'ok';
end; $$;
revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

-- Send a message: partners only, 2,000 characters, 30 a minute and 1,000 a day.
create or replace function public.send_message(recipient_id uuid, a_body text)
returns public.messages language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_body text := trim(coalesce(a_body, '')); n int; r public.messages;
begin
  if v_me is null then raise exception 'sign-in required'; end if;
  if length(v_body) = 0 then raise exception 'empty message'; end if;
  if length(v_body) > 2000 then v_body := left(v_body, 2000); end if;
  if not public._are_partners(v_me, recipient_id) or public._blocked_either(v_me, recipient_id) then raise exception 'not partners'; end if;
  select count(*) into n from public.messages where sender = v_me and created_at > now() - interval '1 minute';
  if n >= 30 then raise exception 'slow down'; end if;
  select count(*) into n from public.messages where sender = v_me and created_at > now() - interval '1 day';
  if n >= 1000 then raise exception 'slow down'; end if;
  insert into public.messages (sender, recipient, body) values (v_me, recipient_id, v_body) returning * into r;
  return r;
end; $$;
revoke all on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

create or replace function public.my_thread(with_id uuid, before timestamptz default null, lim int default 50)
returns setof public.messages language sql security definer stable set search_path = public as $$
  select * from (
    select * from public.messages m
     where ((m.sender = auth.uid() and m.recipient = with_id) or (m.sender = with_id and m.recipient = auth.uid()))
       and (before is null or m.created_at < before)
     order by m.created_at desc
     limit least(greatest(coalesce(lim, 50), 1), 200)
  ) x order by created_at;
$$;
revoke all on function public.my_thread(uuid, timestamptz, int) from public, anon;
grant execute on function public.my_thread(uuid, timestamptz, int) to authenticated;

create or replace function public.mark_read(from_id uuid)
returns int language sql security definer set search_path = public as $$
  with u as (update public.messages set read_at = now()
              where recipient = auth.uid() and sender = from_id and read_at is null returning 1)
  select count(*)::int from u;
$$;
revoke all on function public.mark_read(uuid) from public, anon;
grant execute on function public.mark_read(uuid) to authenticated;

-- The stories two partners write together (for "Write together").
create or replace function public.shared_stories(with_id uuid)
returns table(story_id uuid, title text, updated_at timestamptz)
language sql security definer stable set search_path = public as $$
  select s.id, coalesce(nullif(trim(s.title), ''), 'Untitled story'), s.updated_at
    from public.stories s
   where (s.owner = auth.uid() and exists (select 1 from public.story_collaborators c where c.story_id = s.id and c.user_id = with_id))
      or (s.owner = with_id and exists (select 1 from public.story_collaborators c where c.story_id = s.id and c.user_id = auth.uid()))
      or (exists (select 1 from public.story_collaborators c where c.story_id = s.id and c.user_id = auth.uid())
          and exists (select 1 from public.story_collaborators c where c.story_id = s.id and c.user_id = with_id))
   order by s.updated_at desc nulls last
   limit 20;
$$;
revoke all on function public.shared_stories(uuid) from public, anon;
grant execute on function public.shared_stories(uuid) to authenticated;

-- Check (optional):
--   select count(*) from public.partnerships;   -- one per owner/co-author pair already
--   select proname from pg_proc where proname in ('touch_presence','my_partners','send_message','my_thread');
-- Done.
