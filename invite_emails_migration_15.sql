-- ============================================================
--  DYSTORIA — CO-AUTHOR INVITATIONS BY EMAIL  (migration 15, v.824)
--  Supabase dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run. Builds on migration 12 (story_invites) and 14 (the notices).
--
--  What it adds:
--    • story_invites.email_requested_at / emailed_at / email_count
--    • email_invite(iid) — the owner asks for the invitation to be emailed (again): at most
--      3 emails per invitation, not twice within 10 minutes, 40 a day per writer.
--    • notice_batch_invites() / notice_mark_invites() — for the `notices` Edge Function only.
--  The email itself is sent by the `notices` function (v.824 adds invitations to it); the app
--  also asks the function to run at once, so an invitation arrives in seconds, not at the next
--  15-minute tick.
-- ============================================================

alter table public.story_invites add column if not exists email_requested_at timestamptz;
alter table public.story_invites add column if not exists emailed_at         timestamptz;
alter table public.story_invites add column if not exists email_count        int not null default 0;
create index if not exists story_invites_to_email on public.story_invites (email_requested_at)
  where status = 'pending' and email_requested_at is not null;

-- Returns 'ok' | 'not_owner' | 'not_pending' | 'too_soon' | 'limit' | 'rate'
create or replace function public.email_invite(iid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.story_invites%rowtype; n int;
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  select * into v from public.story_invites where id = iid for update;
  if not found or not public.is_story_owner(v.story_id) then return 'not_owner'; end if;
  if v.status <> 'pending' or v.expires_at < now() then return 'not_pending'; end if;
  if v.email_count >= 3 then return 'limit'; end if;
  if (v.email_requested_at is not null and v.email_requested_at > now() - interval '10 minutes'
      and (v.emailed_at is null or v.emailed_at < v.email_requested_at))
     or (v.emailed_at is not null and v.emailed_at > now() - interval '10 minutes') then return 'too_soon'; end if;
  select count(*) into n from public.story_invites
   where inviter = auth.uid() and email_requested_at > now() - interval '1 day';
  if n >= 40 then return 'rate'; end if;
  update public.story_invites set email_requested_at = now() where id = iid;
  return 'ok';
end; $$;
revoke all on function public.email_invite(uuid) from public, anon;
grant execute on function public.email_invite(uuid) to authenticated;

-- Invitations waiting to be emailed: asked for, not yet sent since the ask, still open.
create or replace function public.notice_batch_invites()
returns table(id uuid, email text, token uuid, role text, title text, inviter_name text, inviter_email text, resend boolean)
language sql security definer stable set search_path = public, auth as $$
  select i.id, i.email, i.token, i.role,
         coalesce(nullif(trim(s.title), ''), 'Untitled story'),
         coalesce(nullif(trim(p.username), ''), split_part(u.email, '@', 1), 'A writer'),
         u.email,
         i.emailed_at is not null
    from public.story_invites i
    join public.stories s on s.id = i.story_id
    left join public.profiles p on p.id = i.inviter
    left join auth.users u on u.id = i.inviter
   where i.status = 'pending' and i.expires_at > now()
     and i.email_requested_at is not null
     and (i.emailed_at is null or i.emailed_at < i.email_requested_at)
     and i.email_count < 3
   order by i.email_requested_at
   limit 200;
$$;
revoke all on function public.notice_batch_invites() from public, anon, authenticated;
do $$ begin grant execute on function public.notice_batch_invites() to service_role; exception when undefined_object then null; end $$;

create or replace function public.notice_mark_invites(ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.story_invites set emailed_at = now(), email_count = email_count + 1
   where id = any(ids) and (emailed_at is null or emailed_at < email_requested_at);
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.notice_mark_invites(uuid[]) from public, anon, authenticated;
do $$ begin grant execute on function public.notice_mark_invites(uuid[]) to service_role; exception when undefined_object then null; end $$;

-- Done.
