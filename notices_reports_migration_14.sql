-- ============================================================
--  DYSTORIA — REPORTING A MESSAGE · EMAIL NOTICES FOR WAITING MESSAGES  (migration 14, v.823)
--  Supabase dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run. Builds on migration 13 (messages, partners, blocks).
--
--  What it adds:
--    • message_reports + report_message(mid, reason, and_block) — the recipient of a message can
--      report it (the text is kept as it was, even if the message goes), and block the sender in one step.
--    • profiles.email_notices (default ON) + set_email_notices(on) — "Email me when messages wait".
--    • messages.notified_at, profiles.last_notice_at — so each waiting message is emailed about at most
--      once, and nobody gets more than one such email every six hours.
--    • notice_batch_messages() / notice_mark_messages() — for the `notices` Edge Function only
--      (service role); nothing a signed-in writer can call.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. REPORTS
-- ----------------------------------------------------------------
create table if not exists public.message_reports (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid references public.messages(id) on delete set null,
  reporter    uuid not null references auth.users(id) on delete cascade,
  reported    uuid references auth.users(id) on delete set null,
  body        text,
  reason      text,
  status      text not null default 'open',
  created_at  timestamptz not null default now(),
  constraint message_reports_reason_chk check (reason is null or length(reason) <= 500),
  constraint message_reports_status_chk check (status in ('open', 'reviewed', 'dismissed'))
);
create index if not exists message_reports_open on public.message_reports (status, created_at) where status = 'open';
alter table public.message_reports enable row level security;
revoke all on public.message_reports from anon, authenticated;
grant select on public.message_reports to authenticated;
drop policy if exists message_reports_select_own on public.message_reports;
create policy message_reports_select_own on public.message_reports
  for select to authenticated using (reporter = auth.uid());

create or replace function public.report_message(mid uuid, a_reason text default null, and_block boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); m public.messages%rowtype; n int;
begin
  if v_me is null then raise exception 'sign-in required'; end if;
  select * into m from public.messages where id = mid;
  if not found or m.recipient <> v_me then return 'not_found'; end if;   -- only what was sent TO you
  select count(*) into n from public.message_reports where reporter = v_me and created_at > now() - interval '1 day';
  if n >= 20 then return 'rate'; end if;
  if not exists (select 1 from public.message_reports where message_id = mid and reporter = v_me) then
    insert into public.message_reports (message_id, reporter, reported, body, reason)
      values (mid, v_me, m.sender, m.body, nullif(left(trim(coalesce(a_reason, '')), 500), ''));
  end if;
  if and_block then
    insert into public.blocks (blocker, blocked) values (v_me, m.sender) on conflict do nothing;
    delete from public.partnerships where a = least(v_me, m.sender) and b = greatest(v_me, m.sender);
  end if;
  return 'ok';
end; $$;
revoke all on function public.report_message(uuid, text, boolean) from public, anon;
grant execute on function public.report_message(uuid, text, boolean) to authenticated;

-- ----------------------------------------------------------------
-- 2. EMAIL NOTICES — the preference and the bookkeeping
-- ----------------------------------------------------------------
alter table public.profiles add column if not exists email_notices  boolean not null default true;
alter table public.profiles add column if not exists last_notice_at timestamptz;
alter table public.messages add column if not exists notified_at    timestamptz;
create index if not exists messages_to_notify on public.messages (recipient) where read_at is null and notified_at is null;

create or replace function public.set_email_notices(a_on boolean)
returns void language sql security definer set search_path = public as $$
  update public.profiles set email_notices = coalesce(a_on, email_notices) where id = auth.uid();
$$;
revoke all on function public.set_email_notices(boolean) from public, anon;
grant execute on function public.set_email_notices(boolean) to authenticated;

-- Who should hear about messages waiting for them: unread and never emailed about, older than
-- min_age (they may still see it live), the recipient not in the app in the last ten minutes, their
-- address confirmed, notices on, and no such email in the last `gap`. One row per recipient.
create or replace function public.notice_batch_messages(min_age interval default interval '15 minutes', gap interval default interval '6 hours')
returns table(recipient uuid, email text, username text, n int, senders text, snippets jsonb, ids uuid[])
language sql security definer stable set search_path = public, auth as $$
  with w as (
    select m.*, row_number() over (partition by m.recipient order by m.created_at desc) as rk,
           coalesce(nullif(trim(sp.username), ''), split_part(sp.email, '@', 1), 'A writer') as sender_name
      from public.messages m
      join public.profiles rp on rp.id = m.recipient
      left join public.profiles sp on sp.id = m.sender
     where m.read_at is null and m.notified_at is null
       and m.created_at < now() - min_age
       and rp.email_notices
       and (rp.last_notice_at is null or rp.last_notice_at < now() - gap)
       and (rp.last_seen_at is null or rp.last_seen_at < now() - interval '10 minutes')
       and not public._blocked_either(m.sender, m.recipient)
  )
  select w.recipient, u.email,
         coalesce(nullif(trim(p.username), ''), split_part(u.email, '@', 1)),
         count(*)::int,
         string_agg(distinct w.sender_name, ', '),
         coalesce(jsonb_agg(jsonb_build_object('from', w.sender_name, 'body', left(w.body, 280), 'at', w.created_at) order by w.created_at) filter (where w.rk <= 3), '[]'::jsonb),
         array_agg(w.id)
    from w
    join auth.users u on u.id = w.recipient and u.email is not null and u.email_confirmed_at is not null
    left join public.profiles p on p.id = w.recipient
   group by w.recipient, u.email, p.username
   limit 500;
$$;
revoke all on function public.notice_batch_messages(interval, interval) from public, anon, authenticated;
do $$ begin grant execute on function public.notice_batch_messages(interval, interval) to service_role; exception when undefined_object then null; end $$;

create or replace function public.notice_mark_messages(ids uuid[], recips uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.messages set notified_at = now() where id = any(ids) and notified_at is null;
  get diagnostics n = row_count;
  update public.profiles set last_notice_at = now() where id = any(recips);
  return n;
end; $$;
revoke all on function public.notice_mark_messages(uuid[], uuid[]) from public, anon, authenticated;
do $$ begin grant execute on function public.notice_mark_messages(uuid[], uuid[]) to service_role; exception when undefined_object then null; end $$;

-- Schedule (see NOTICES_EMAIL_SETUP.md): the `notices` Edge Function every 15 minutes.
-- Done.
