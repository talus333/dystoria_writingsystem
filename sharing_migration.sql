-- ============================================================
--  DYSTORIA — STORY SHARING MIGRATION
--  Run this ONCE in the Supabase dashboard:
--    Project  →  SQL Editor  →  New query  →  paste  →  Run
--  Safe to re-run (every statement is idempotent / guarded).
--
--  What it adds:
--    • profiles            — private user_id ↔ email map (for invite-by-email)
--    • story_collaborators — who else may work in a story
--    • stories.planning_baton — who currently holds mindmap-edit rights
--    • RLS so owners AND collaborators can read/update a shared story
--    • share_story() / unshare_story() RPCs (resolve email server-side)
--    • Realtime enabled on stories (for the live co-editing layer)
-- ============================================================

-- ----------------------------------------------------------------
-- 1. PROFILES  (so an owner can invite by email without exposing
--    the auth.users table to clients)
-- ----------------------------------------------------------------
create table if not exists public.profiles (
  id    uuid primary key references auth.users(id) on delete cascade,
  email text unique
);

alter table public.profiles enable row level security;

-- A user may read only their OWN profile row. Email lookup for sharing
-- happens server-side inside share_story() (security definer), so emails
-- are never broadly readable.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- Backfill existing users.
insert into public.profiles (id, email)
  select id, email from auth.users
  on conflict (id) do update set email = excluded.email;

-- Keep profiles in sync on signup / email change.
create or replace function public.handle_user_profile()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
    values (new.id, new.email)
    on conflict (id) do update set email = excluded.email;
  return new;
end; $$;

drop trigger if exists on_auth_user_upserted on auth.users;
create trigger on_auth_user_upserted
  after insert or update of email on auth.users
  for each row execute function public.handle_user_profile();

-- ----------------------------------------------------------------
-- 2. STORIES  — durable "planning baton" (mindmap-edit rights)
--    Defaults to the owner.
-- ----------------------------------------------------------------
alter table public.stories
  add column if not exists planning_baton uuid references auth.users(id);

update public.stories set planning_baton = owner where planning_baton is null;

-- ----------------------------------------------------------------
-- 3. STORY_COLLABORATORS
-- ----------------------------------------------------------------
create table if not exists public.story_collaborators (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id  uuid not null references auth.users(id)     on delete cascade,
  email    text,
  role     text not null default 'writer',
  added_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

alter table public.story_collaborators enable row level security;

-- ----------------------------------------------------------------
-- 4. HELPER FUNCTIONS  (security definer → no recursive-RLS issues)
-- ----------------------------------------------------------------
create or replace function public.is_story_owner(sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.stories s
                 where s.id = sid and s.owner = auth.uid());
$$;

create or replace function public.is_collaborator(sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.story_collaborators c
                 where c.story_id = sid and c.user_id = auth.uid());
$$;

-- ----------------------------------------------------------------
-- 5. ROW-LEVEL SECURITY  — owners + collaborators
-- ----------------------------------------------------------------
alter table public.stories enable row level security;

drop policy if exists stories_select on public.stories;
create policy stories_select on public.stories
  for select to authenticated
  using (owner = auth.uid() or public.is_collaborator(id));

drop policy if exists stories_insert on public.stories;
create policy stories_insert on public.stories
  for insert to authenticated
  with check (owner = auth.uid());

drop policy if exists stories_update on public.stories;
create policy stories_update on public.stories
  for update to authenticated
  using (owner = auth.uid() or public.is_collaborator(id))
  with check (owner = auth.uid() or public.is_collaborator(id));

drop policy if exists stories_delete on public.stories;
create policy stories_delete on public.stories
  for delete to authenticated
  using (owner = auth.uid());

-- collaborators: an owner sees their story's collaborators; a collaborator
-- sees their own membership rows.
drop policy if exists collab_select on public.story_collaborators;
create policy collab_select on public.story_collaborators
  for select to authenticated
  using (user_id = auth.uid() or public.is_story_owner(story_id));

drop policy if exists collab_delete on public.story_collaborators;
create policy collab_delete on public.story_collaborators
  for delete to authenticated
  using (public.is_story_owner(story_id) or user_id = auth.uid());

-- Inserts go ONLY through share_story() below (no direct insert policy).

-- ----------------------------------------------------------------
-- 6. SHARE / UNSHARE RPCs  (resolve email → user_id server-side)
--    Return codes: 'ok' | 'not_owner' | 'no_user' | 'self'
-- ----------------------------------------------------------------
create or replace function public.share_story(sid uuid, invitee_email text)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_story_owner(sid) then return 'not_owner'; end if;
  select id into uid from public.profiles
    where lower(email) = lower(trim(invitee_email)) limit 1;
  if uid is null then return 'no_user'; end if;
  if uid = auth.uid() then return 'self'; end if;
  insert into public.story_collaborators (story_id, user_id, email)
    values (sid, uid, lower(trim(invitee_email)))
    on conflict (story_id, user_id) do nothing;
  return 'ok';
end; $$;
grant execute on function public.share_story(uuid, text) to authenticated;

create or replace function public.unshare_story(sid uuid, collaborator uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_story_owner(sid) then return 'not_owner'; end if;
  delete from public.story_collaborators
    where story_id = sid and user_id = collaborator;
  return 'ok';
end; $$;
grant execute on function public.unshare_story(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------
-- 7. REALTIME  (for the live co-editing layer that builds on this)
-- ----------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.stories;
exception when duplicate_object then null;
end $$;

-- Done.
