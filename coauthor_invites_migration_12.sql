-- ============================================================
--  DYSTORIA — CO-AUTHOR INVITES + ROLES  (migration 12, v.819)
--  Supabase dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run. Builds on sharing_migration.sql and
--  sharing_migration_2_usernames.sql.
--
--  What it adds:
--    • story_collaborators.role  — 'editor' | 'suggester'
--        (every existing co-author becomes an Editor)
--    • story_invites             — an invitation by email, with a link token,
--        a role, a status and a 30-day expiry. Works for people who have no
--        account yet: signing up with that email finds the invitation waiting.
--    • create_invite / invite_peek / accept_invite / decline_invite /
--      revoke_invite / my_invites / set_collaborator_role
--    • story_people() also returns each person's role (column `access`)
--    • share_story() becomes a shim onto create_invite, so it no longer
--      tells the caller whether an email address has an account.
--
--  Only an account whose CONFIRMED email matches the invitation can accept it.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. ROLES on story_collaborators
-- ----------------------------------------------------------------
update public.story_collaborators set role = 'editor'
  where role is null or role not in ('editor', 'suggester');
alter table public.story_collaborators alter column role set default 'editor';
do $$ begin
  alter table public.story_collaborators
    add constraint story_collaborators_role_chk check (role in ('editor', 'suggester'));
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------
-- 2. STORY_INVITES
-- ----------------------------------------------------------------
create table if not exists public.story_invites (
  id           uuid primary key default gen_random_uuid(),
  story_id     uuid not null references public.stories(id) on delete cascade,
  inviter      uuid not null references auth.users(id) on delete cascade,
  email        text not null,
  role         text not null default 'editor',
  token        uuid not null unique default gen_random_uuid(),
  status       text not null default 'pending',
  invitee      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days',
  responded_at timestamptz,
  constraint story_invites_role_chk   check (role in ('editor', 'suggester')),
  constraint story_invites_status_chk check (status in ('pending', 'accepted', 'declined', 'revoked')),
  constraint story_invites_email_chk  check (email = lower(email) and length(email) between 3 and 254 and position('@' in email) > 1)
);
create unique index if not exists story_invites_one_pending on public.story_invites (story_id, email) where status = 'pending';
create index if not exists story_invites_email_pending on public.story_invites (email) where status = 'pending';
create index if not exists story_invites_inviter_day on public.story_invites (inviter, created_at);

alter table public.story_invites enable row level security;
revoke all on public.story_invites from anon, authenticated;
grant select on public.story_invites to authenticated;
-- The owner sees their story's invitations (to copy a link again, or revoke one).
-- Invitees never read this table directly: my_invites() / invite_peek() do it for them.
drop policy if exists invites_select_owner on public.story_invites;
create policy invites_select_owner on public.story_invites
  for select to authenticated using (public.is_story_owner(story_id));
-- No insert / update / delete policies: every change goes through the functions below.

-- ----------------------------------------------------------------
-- 3. HELPERS
-- ----------------------------------------------------------------
-- The caller's email, but only once it is confirmed (so nobody can claim an
-- invitation by signing up with an address they don't own). Null for anonymous
-- reader sessions.
create or replace function public._my_confirmed_email()
returns text language sql security definer stable set search_path = public, auth as $$
  select lower(u.email) from auth.users u
   where u.id = auth.uid() and u.email is not null and u.email_confirmed_at is not null
     and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false;
$$;
revoke all on function public._my_confirmed_email() from public, anon, authenticated;

-- j•••@gmail.com — enough for someone to recognise their own address, no more.
create or replace function public._mask_email(e text)
returns text language sql immutable as $$
  select case when e is null or position('@' in e) < 2 then '•••'
              else left(e, 1) || '•••' || substr(e, position('@' in e)) end;
$$;

create or replace function public._display_name(uid uuid)
returns text language sql security definer stable set search_path = public as $$
  select coalesce(nullif(trim(p.username), ''), split_part(p.email, '@', 1), 'A writer')
    from public.profiles p where p.id = uid;
$$;
revoke all on function public._display_name(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------
-- 4. CREATE — owner only. Never says whether the address has an account.
--    Returns { status: ok | not_owner | bad_email | self | already | rate, token?, id? }
-- ----------------------------------------------------------------
create or replace function public.create_invite(sid uuid, a_email text, a_role text default 'editor')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(coalesce(a_email, '')));
  v_role  text := case when a_role in ('editor', 'suggester') then a_role else 'editor' end;
  v_me    uuid := auth.uid();
  v_row   public.story_invites%rowtype;
  n int;
begin
  if v_me is null then raise exception 'sign-in required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then return jsonb_build_object('status', 'not_owner'); end if;
  if not public.is_story_owner(sid) then return jsonb_build_object('status', 'not_owner'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then return jsonb_build_object('status', 'bad_email'); end if;
  if v_email = (select lower(email) from auth.users where id = v_me) then return jsonb_build_object('status', 'self'); end if;
  -- already on the story (the owner knows who their co-authors are, so this reveals nothing new)
  if exists (select 1 from public.story_collaborators c
               left join public.profiles p on p.id = c.user_id
              where c.story_id = sid and (lower(c.email) = v_email or lower(p.email) = v_email)) then
    return jsonb_build_object('status', 'already');
  end if;
  -- an invitation to the same address that is still open: renew it (new role, fresh 30 days, same link)
  select * into v_row from public.story_invites where story_id = sid and email = v_email and status = 'pending' for update;
  if found then
    update public.story_invites set role = v_role, expires_at = now() + interval '30 days'
     where id = v_row.id;
    return jsonb_build_object('status', 'ok', 'token', v_row.token, 'id', v_row.id, 'renewed', true);
  end if;
  -- flood guards: 30 new invitations a day per writer, 50 open ones per story
  select count(*) into n from public.story_invites where inviter = v_me and created_at > now() - interval '1 day';
  if n >= 30 then return jsonb_build_object('status', 'rate'); end if;
  select count(*) into n from public.story_invites where story_id = sid and status = 'pending';
  if n >= 50 then return jsonb_build_object('status', 'rate'); end if;
  insert into public.story_invites (story_id, inviter, email, role)
    values (sid, v_me, v_email, v_role) returning * into v_row;
  return jsonb_build_object('status', 'ok', 'token', v_row.token, 'id', v_row.id);
end; $$;
revoke all on function public.create_invite(uuid, text, text) from public, anon;
grant execute on function public.create_invite(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------
-- 5. PEEK — what an invitation link is for, before accepting.
--    Anyone holding the link may see the story's title, who sent it and the role;
--    `for_me` says whether the signed-in account is the one it was sent to.
-- ----------------------------------------------------------------
create or replace function public.invite_peek(tok uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v public.story_invites%rowtype; v_title text; v_owner uuid; v_mine text := public._my_confirmed_email();
begin
  select * into v from public.story_invites where token = tok;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select coalesce(nullif(trim(s.title), ''), 'Untitled story'), s.owner into v_title, v_owner from public.stories s where s.id = v.story_id;
  return jsonb_build_object(
    'status', case when v.status = 'pending' and v.expires_at < now() then 'expired' else v.status end,
    'story_id', case when v.invitee = auth.uid() or v_owner = auth.uid() or (v_mine is not null and v_mine = v.email) then v.story_id end,
    'title', v_title,
    'inviter_name', public._display_name(v.inviter),
    'role', v.role,
    'for_me', (v_mine is not null and v_mine = v.email),
    'accepted_by_me', (v.invitee is not null and v.invitee = auth.uid()),
    'signed_in', (auth.uid() is not null and not coalesce((auth.jwt()->>'is_anonymous')::boolean, false)),
    'email_hint', public._mask_email(v.email));
end; $$;
revoke all on function public.invite_peek(uuid) from public;
grant execute on function public.invite_peek(uuid) to anon, authenticated;

-- ----------------------------------------------------------------
-- 6. ACCEPT / DECLINE — only the account the invitation was sent to.
--    Accept returns { status: ok | not_found | expired | revoked | declined | used |
--                     wrong_account | self, story_id?, title?, role?, email_hint? }
-- ----------------------------------------------------------------
create or replace function public.accept_invite(tok uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.story_invites%rowtype; v_me uuid := auth.uid(); v_mine text := public._my_confirmed_email(); v_title text; v_owner uuid;
begin
  if v_me is null then raise exception 'sign-in required'; end if;
  select * into v from public.story_invites where token = tok for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select coalesce(nullif(trim(s.title), ''), 'Untitled story'), s.owner into v_title, v_owner from public.stories s where s.id = v.story_id;
  if v.status = 'accepted' then
    if v.invitee = v_me then return jsonb_build_object('status', 'ok', 'story_id', v.story_id, 'title', v_title, 'role', v.role); end if;
    return jsonb_build_object('status', 'used');
  end if;
  if v.status in ('revoked', 'declined') then return jsonb_build_object('status', v.status); end if;
  if v.expires_at < now() then return jsonb_build_object('status', 'expired'); end if;
  if v_mine is null or v_mine <> v.email then
    return jsonb_build_object('status', 'wrong_account', 'email_hint', public._mask_email(v.email));
  end if;
  if v_owner = v_me then return jsonb_build_object('status', 'self'); end if;
  insert into public.story_collaborators (story_id, user_id, email, role)
    values (v.story_id, v_me, v.email, v.role)
    on conflict (story_id, user_id) do update set role = excluded.role;
  update public.story_invites set status = 'accepted', invitee = v_me, responded_at = now() where id = v.id;
  return jsonb_build_object('status', 'ok', 'story_id', v.story_id, 'title', v_title, 'role', v.role);
end; $$;
revoke all on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated;

create or replace function public.decline_invite(tok uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.story_invites%rowtype; v_mine text := public._my_confirmed_email();
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  select * into v from public.story_invites where token = tok for update;
  if not found then return 'not_found'; end if;
  if v_mine is null or v_mine <> v.email then return 'wrong_account'; end if;
  if v.status <> 'pending' then return v.status; end if;
  update public.story_invites set status = 'declined', responded_at = now() where id = v.id;
  return 'ok';
end; $$;
revoke all on function public.decline_invite(uuid) from public, anon;
grant execute on function public.decline_invite(uuid) to authenticated;

-- ----------------------------------------------------------------
-- 7. REVOKE — owner only
-- ----------------------------------------------------------------
create or replace function public.revoke_invite(iid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.story_invites%rowtype;
begin
  select * into v from public.story_invites where id = iid for update;
  if not found or not public.is_story_owner(v.story_id) then return 'not_owner'; end if;
  if v.status <> 'pending' then return v.status; end if;
  update public.story_invites set status = 'revoked', responded_at = now() where id = iid;
  return 'ok';
end; $$;
revoke all on function public.revoke_invite(uuid) from public, anon;
grant execute on function public.revoke_invite(uuid) to authenticated;

-- ----------------------------------------------------------------
-- 8. MY INVITATIONS — the cards waiting for the signed-in writer
-- ----------------------------------------------------------------
create or replace function public.my_invites()
returns table(id uuid, token uuid, story_id uuid, title text, inviter_name text, role text, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select i.id, i.token, i.story_id, coalesce(nullif(trim(s.title), ''), 'Untitled story'),
         public._display_name(i.inviter), i.role, i.created_at
    from public.story_invites i
    join public.stories s on s.id = i.story_id
   where i.status = 'pending' and i.expires_at > now()
     and i.email = public._my_confirmed_email()
     and s.owner <> auth.uid()
     and not exists (select 1 from public.story_collaborators c where c.story_id = i.story_id and c.user_id = auth.uid())
   order by i.created_at desc
   limit 20;
$$;
revoke all on function public.my_invites() from public, anon;
grant execute on function public.my_invites() to authenticated;

-- ----------------------------------------------------------------
-- 9. ROLE CHANGE — owner only
-- ----------------------------------------------------------------
create or replace function public.set_collaborator_role(sid uuid, collaborator uuid, a_role text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_story_owner(sid) then return 'not_owner'; end if;
  if a_role not in ('editor', 'suggester') then return 'bad_role'; end if;
  update public.story_collaborators set role = a_role where story_id = sid and user_id = collaborator;
  if not found then return 'not_found'; end if;
  return 'ok';
end; $$;
revoke all on function public.set_collaborator_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_collaborator_role(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------
-- 10. story_people() — the same rows as before, plus each person's role
--     (`role` stays 'owner' | 'collaborator' for older app versions;
--      `access` is 'owner' | 'editor' | 'suggester').
-- ----------------------------------------------------------------
drop function if exists public.story_people(uuid);
create function public.story_people(sid uuid)
returns table(user_id uuid, role text, username text, email text, access text)
language sql security definer stable set search_path = public as $$
  select s.owner, 'owner'::text, p.username, p.email, 'owner'::text
    from public.stories s
    left join public.profiles p on p.id = s.owner
    where s.id = sid and (s.owner = auth.uid() or public.is_collaborator(sid))
  union all
  select c.user_id, 'collaborator'::text, p.username, p.email, c.role
    from public.story_collaborators c
    left join public.profiles p on p.id = c.user_id
    where c.story_id = sid and (public.is_story_owner(sid) or public.is_collaborator(sid));
$$;
revoke all on function public.story_people(uuid) from public, anon;
grant execute on function public.story_people(uuid) to authenticated;

-- ----------------------------------------------------------------
-- 11. share_story() — older app versions still call it. It now opens an
--     invitation (as Editor) instead of adding the person outright, and it
--     no longer answers 'no_user', which told anyone whether an address
--     had a Dystoria account.
-- ----------------------------------------------------------------
create or replace function public.share_story(sid uuid, invitee_email text)
returns text language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.create_invite(sid, invitee_email, 'editor');
  return case r->>'status' when 'already' then 'ok' else coalesce(r->>'status', 'error') end;
end; $$;
revoke all on function public.share_story(uuid, text) from public, anon;
grant execute on function public.share_story(uuid, text) to authenticated;

-- Check (optional):
--   select column_name, column_default from information_schema.columns
--    where table_name = 'story_collaborators' and column_name = 'role';
--   select proname from pg_proc where proname in
--    ('create_invite','invite_peek','accept_invite','decline_invite','revoke_invite','my_invites','set_collaborator_role');
-- Done.
