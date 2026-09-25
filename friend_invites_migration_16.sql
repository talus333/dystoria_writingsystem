-- ============================================================
--  DYSTORIA — INVITE A FRIEND TO DYSTORIA  (migration 16, v.825)
--  Supabase dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run. Builds on migrations 13 (partnerships) and 15 (the notices).
--
--  What it adds:
--    • friend_invites — "come and write on Dystoria", by email, with an optional note.
--      The `notices` function emails it (v.825); its button opens #/join/<token>.
--    • invite_friend(email, note) — never says whether the address already has an account.
--    • friend_invite_peek(tok) — who invited you, for the welcome card (anyone with the link).
--    • accept_friend_invite(tok) — opened the link and signed in (or signed up): you and the
--      inviter are writing partners.
--    • claim_friend_invites() — on sign-in: an invitation to your address that you did not
--      open becomes an ordinary partner request, to accept or decline in the partners panel.
--    • notice_batch_friends() / notice_mark_friends() — for the `notices` function only.
--  Guards: 10 invitations a day per writer; the same writer can't invite the same address twice
--  in 7 days; an address gets at most 3 of these emails a week, from anyone; blocks are honoured.
-- ============================================================

-- a partnership can now come from a friend invitation
do $$ begin
  alter table public.partnerships drop constraint if exists partnerships_source_chk;
  alter table public.partnerships add constraint partnerships_source_chk check (source in ('coauthor', 'request', 'invite'));
end $$;

create table if not exists public.friend_invites (
  id          uuid primary key default gen_random_uuid(),
  inviter     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  note        text,
  token       uuid not null unique default gen_random_uuid(),
  status      text not null default 'pending',
  invitee     uuid references auth.users(id) on delete set null,
  send        boolean not null default true,
  emailed_at  timestamptz,
  created_at  timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_invites_status_chk check (status in ('pending', 'accepted', 'claimed')),
  constraint friend_invites_email_chk  check (email = lower(email) and length(email) between 3 and 254 and position('@' in email) > 1),
  constraint friend_invites_note_chk   check (note is null or length(note) <= 300)
);
create index if not exists friend_invites_email on public.friend_invites (email, created_at);
create index if not exists friend_invites_inviter on public.friend_invites (inviter, created_at);
create index if not exists friend_invites_to_send on public.friend_invites (created_at) where send and emailed_at is null;
alter table public.friend_invites enable row level security;
revoke all on public.friend_invites from anon, authenticated;
grant select on public.friend_invites to authenticated;
drop policy if exists friend_invites_select_own on public.friend_invites;
create policy friend_invites_select_own on public.friend_invites
  for select to authenticated using (inviter = auth.uid());

-- Returns { status: ok | self | bad_email | rate | already, id? }. 'ok' whether or not the address has
-- an account; 'already' only when you are ALREADY partners (you know that), or you invited it this week.
create or replace function public.invite_friend(a_email text, a_note text default null)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_me uuid := auth.uid();
  v_email text := lower(trim(coalesce(a_email, '')));
  v_note text := nullif(left(trim(coalesce(a_note, '')), 300), '');
  v_to uuid; n int; v_send boolean := true; v_id uuid;
begin
  if v_me is null then raise exception 'sign-in required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then return jsonb_build_object('status', 'rate'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then return jsonb_build_object('status', 'bad_email'); end if;
  if v_email = (select lower(email) from auth.users where id = v_me) then return jsonb_build_object('status', 'self'); end if;
  select count(*) into n from public.friend_invites where inviter = v_me and created_at > now() - interval '1 day';
  if n >= 10 then return jsonb_build_object('status', 'rate'); end if;
  if exists (select 1 from public.friend_invites where inviter = v_me and email = v_email and created_at > now() - interval '7 days') then
    return jsonb_build_object('status', 'already');
  end if;
  select id into v_to from public.profiles where lower(email) = v_email limit 1;
  if v_to is not null and public._are_partners(v_me, v_to) then return jsonb_build_object('status', 'already'); end if;
  -- quietly don't email: a block either way, or this address already had 3 of these emails this week
  if v_to is not null and public._blocked_either(v_me, v_to) then v_send := false; end if;
  select count(*) into n from public.friend_invites where email = v_email and send and created_at > now() - interval '7 days';
  if n >= 3 then v_send := false; end if;
  insert into public.friend_invites (inviter, email, note, send) values (v_me, v_email, v_note, v_send) returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end; $$;
revoke all on function public.invite_friend(text, text) from public, anon;
grant execute on function public.invite_friend(text, text) to authenticated;

create or replace function public.friend_invite_peek(tok uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v public.friend_invites%rowtype;
begin
  select * into v from public.friend_invites where token = tok;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', v.status,
    'inviter_name', coalesce((select coalesce(nullif(trim(p.username), ''), split_part(p.email, '@', 1)) from public.profiles p where p.id = v.inviter), 'A writer'),
    'note', v.note,
    'mine', (v.inviter = auth.uid()),
    'accepted_by_me', (v.invitee is not null and v.invitee = auth.uid()));
end; $$;
revoke all on function public.friend_invite_peek(uuid) from public;
grant execute on function public.friend_invite_peek(uuid) to anon, authenticated;

-- Opening the link is the yes: the two become writing partners (whatever address the new account uses).
-- Returns 'ok' | 'not_found' | 'self' | 'used' | 'blocked'
create or replace function public.accept_friend_invite(tok uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.friend_invites%rowtype; v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'sign-in required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then return 'not_found'; end if;
  select * into v from public.friend_invites where token = tok for update;
  if not found then return 'not_found'; end if;
  if v.inviter = v_me then return 'self'; end if;
  if v.status = 'accepted' then return case when v.invitee = v_me then 'ok' else 'used' end; end if;
  if public._blocked_either(v.inviter, v_me) then return 'blocked'; end if;
  insert into public.partnerships (a, b, status, requested_by, source)
    values (least(v.inviter, v_me), greatest(v.inviter, v_me), 'accepted', v.inviter, 'invite')
    on conflict (a, b) do update set status = 'accepted';
  update public.friend_invites set status = 'accepted', invitee = v_me, responded_at = now() where id = v.id;
  return 'ok';
end; $$;
revoke all on function public.accept_friend_invite(uuid) from public, anon;
grant execute on function public.accept_friend_invite(uuid) to authenticated;

-- On sign-in: invitations to my (confirmed) address I didn't open become partner requests I can answer.
create or replace function public.claim_friend_invites()
returns int language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := auth.uid(); v_mail text; r record; n int := 0;
begin
  if v_me is null then return 0; end if;
  select lower(u.email) into v_mail from auth.users u where u.id = v_me and u.email_confirmed_at is not null;
  if v_mail is null then return 0; end if;
  for r in select * from public.friend_invites where email = v_mail and status = 'pending' and inviter <> v_me for update loop
    if not public._blocked_either(r.inviter, v_me) then
      insert into public.partnerships (a, b, status, requested_by, source)
        values (least(r.inviter, v_me), greatest(r.inviter, v_me), 'pending', r.inviter, 'invite')
        on conflict (a, b) do nothing;
      n := n + 1;
    end if;
    update public.friend_invites set status = 'claimed', invitee = v_me, responded_at = now() where id = r.id;
  end loop;
  return n;
end; $$;
revoke all on function public.claim_friend_invites() from public, anon;
grant execute on function public.claim_friend_invites() to authenticated;

-- for the notices function
create or replace function public.notice_batch_friends()
returns table(id uuid, email text, token uuid, note text, inviter_name text, inviter_email text)
language sql security definer stable set search_path = public, auth as $$
  select f.id, f.email, f.token, f.note,
         coalesce(nullif(trim(p.username), ''), split_part(u.email, '@', 1), 'A writer'), u.email
    from public.friend_invites f
    left join public.profiles p on p.id = f.inviter
    left join auth.users u on u.id = f.inviter
   where f.send and f.emailed_at is null and f.status = 'pending' and f.created_at > now() - interval '3 days'
   order by f.created_at
   limit 200;
$$;
revoke all on function public.notice_batch_friends() from public, anon, authenticated;
do $$ begin grant execute on function public.notice_batch_friends() to service_role; exception when undefined_object then null; end $$;

create or replace function public.notice_mark_friends(ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.friend_invites set emailed_at = now() where id = any(ids) and emailed_at is null;
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.notice_mark_friends(uuid[]) from public, anon, authenticated;
do $$ begin grant execute on function public.notice_mark_friends(uuid[]) to service_role; exception when undefined_object then null; end $$;

notify pgrst, 'reload schema';
-- Done.
