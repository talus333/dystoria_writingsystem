-- ============================================================
--  DYSTORIA — THE BETA-READER EXCHANGE  (migration 17, v.835)
--  Supabase dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run. Builds on migrations 3/7/10 (story_comments), 13 (blocks) and 14–16 (the notices).
--
--  [Jeremy] "a tab in the writing partners of people who opt in to be Beta readers so that you can send them a
--  request to join your list of beta readers (it has to be an exchange of favors, so you can only ask if you opt in
--  and are willing to beta read as well)... then you could send a manuscript through your beta reader group which is
--  different than your writing partners/friends."
--
--  What it adds:
--    • beta_profiles — opting in: what you like to read, lengths, how many at once, what you won't read, a line
--      about you, and "I'm 18 or older" (required). Only people who have opted in can see the directory or ask.
--    • beta_links    — beta partners (asked → accepted), kept apart from writing partners.
--    • beta_sends    — a manuscript sent to readers: a FROZEN copy of the draft, questions, content notes, a due date.
--    • beta_reads    — one per reader: a private link token, progress, finished / stopped, the reader's report.
--    • story_comments.beta_read — a reader's comments on a send land in the story's ordinary comment stream, so the
--      author reads them in Revise with every tool that already has; only the story's writers (you and any co-author)
--      and that reader can read them.
--  The exchange rule is a soft pairwise ledger: you can't send a new manuscript to someone who has finished two or
--  more reads for you more than you have for them. Readers marked full (at capacity) or closed receive nothing new.
--  Guards: 15 requests a day; 5 sends a day; comments 10 a minute and 300 a day per read; blocks honoured.
--
--  v.836 [Jeremy] "people should be allowed to be a beta reader without the need for reciprocity from the other person, and it
--  would be great to invite people to be beta readers through email or social posts even if they aren't authors. they could get
--  notifications when there is something to read."
--    • beta_profiles.swap / .volunteer — how you take part: swap reads (reciprocal), read for others with nothing back, both,
--      or neither (you only want readers — ask volunteers, invite your own).
--    • beta_links.kind — 'swap' (both read, the ledger applies) or 'read' (one reads for the other; `reader` says who).
--    • beta_invites — invite a reader by email or with a shareable link (for a post); opening it and signing up makes them
--      your reader. Readers who joined from an invitation aren't listed in the directory unless they choose to be.
--  Re-running this file over the v.835 version is safe: new columns are added, changed functions are replaced.
-- ============================================================

-- ---------------------------------------------------------------- tables
create table if not exists public.beta_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  open       boolean not null default true,
  adult      boolean not null default false,
  reads      text[]  not null default '{}',
  lengths    text[]  not null default '{}',
  capacity   int     not null default 2,
  wont       text,
  about      text,
  turnaround text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_profiles_cap_chk check (capacity between 1 and 5)
);

alter table public.beta_profiles add column if not exists swap      boolean not null default true;
alter table public.beta_profiles add column if not exists volunteer boolean not null default false;

create table if not exists public.beta_links (
  id           uuid not null default gen_random_uuid() unique,
  a            uuid not null references auth.users(id) on delete cascade,
  b            uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending',
  requested_by uuid not null references auth.users(id) on delete cascade,
  note         text,
  emailed_at   timestamptz,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (a, b),
  constraint beta_links_order_chk check (a < b),
  constraint beta_links_status_chk check (status in ('pending', 'accepted')),
  constraint beta_links_note_chk check (note is null or length(note) <= 300)
);

alter table public.beta_links add column if not exists kind   text not null default 'swap';
alter table public.beta_links add column if not exists reader uuid references auth.users(id) on delete cascade;
do $$ begin
  alter table public.beta_links add constraint beta_links_kind_chk check (kind in ('swap', 'read') and ((kind = 'read') = (reader is not null)) and (reader is null or reader in (a, b)));
exception when duplicate_object then null; end $$;

create table if not exists public.beta_invites (
  id         uuid primary key default gen_random_uuid(),
  author     uuid not null references auth.users(id) on delete cascade,
  kind       text not null default 'email',
  email      text,
  note       text,
  token      uuid not null unique default gen_random_uuid(),
  uses       int  not null default 0,
  max_uses   int  not null default 1,
  status     text not null default 'open',
  send       boolean not null default true,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint beta_invites_kind_chk   check (kind in ('email', 'link')),
  constraint beta_invites_status_chk check (status in ('open', 'used', 'revoked')),
  constraint beta_invites_email_chk  check ((kind = 'email') = (email is not null) and (email is null or (email = lower(email) and length(email) between 3 and 254))),
  constraint beta_invites_note_chk   check (note is null or length(note) <= 300)
);
create index if not exists beta_invites_author on public.beta_invites (author, created_at);
create index if not exists beta_invites_email on public.beta_invites (email, created_at) where email is not null;

create table if not exists public.beta_sends (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid references public.stories(id) on delete set null,
  author     uuid not null references auth.users(id) on delete cascade,
  title      text not null default 'Untitled',
  html       text not null,
  questions  jsonb not null default '[]'::jsonb,
  notes      text,
  due        date,
  version_id text,
  created_at timestamptz not null default now()
);
create index if not exists beta_sends_author on public.beta_sends (author, created_at);

create table if not exists public.beta_reads (
  id          uuid primary key default gen_random_uuid(),
  send_id     uuid not null references public.beta_sends(id) on delete cascade,
  reader      uuid not null references auth.users(id) on delete cascade,
  token       uuid not null unique default gen_random_uuid(),
  status      text not null default 'reading',
  progress    int  not null default 0,
  opened_at   timestamptz,
  finished_at timestamptz,
  stopped_at  timestamptz,
  stop_reason text,
  report      jsonb,
  emailed_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (send_id, reader),
  constraint beta_reads_status_chk check (status in ('reading', 'finished', 'stopped')),
  constraint beta_reads_progress_chk check (progress between 0 and 100)
);
create index if not exists beta_reads_reader on public.beta_reads (reader, status);

alter table public.story_comments add column if not exists beta_read uuid references public.beta_reads(id) on delete cascade;
create index if not exists story_comments_beta on public.story_comments (beta_read) where beta_read is not null;

-- every table is reached through the functions below, never directly
alter table public.beta_profiles enable row level security;
alter table public.beta_links    enable row level security;
alter table public.beta_sends    enable row level security;
alter table public.beta_reads    enable row level security;
alter table public.beta_invites  enable row level security;
revoke all on public.beta_profiles, public.beta_links, public.beta_sends, public.beta_reads, public.beta_invites from anon, authenticated;

-- a reader can read back their own comments on a read (the public link's own-comments policy needs a public story)
drop policy if exists comments_select_beta_own on public.story_comments;
create policy comments_select_beta_own on public.story_comments
  for select to authenticated
  using (beta_read is not null and author_id = auth.uid());

-- ---------------------------------------------------------------- helpers (not callable from the app)
create or replace function public._beta_me()
returns uuid language plpgsql stable security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'sign-in required'; end if;
  return auth.uid();
end; $$;

create or replace function public._beta_name(u uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(trim(p.username), ''), split_part(p.email, '@', 1)) from public.profiles p where p.id = u), 'A writer');
$$;

create or replace function public._beta_opted(u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.beta_profiles where user_id = u and adult);
$$;

create or replace function public._beta_partners(x uuid, y uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.beta_links where a = least(x, y) and b = greatest(x, y) and status = 'accepted');
$$;

-- the link between two people, if accepted: 'swap' | 'reads_for' (y reads for x) | 'read_by' (x reads for y) | null
create or replace function public._beta_rel(x uuid, y uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when l.kind = 'swap' then 'swap' when l.reader = y then 'reads_for' else 'read_by' end
    from public.beta_links l where l.a = least(x, y) and l.b = greatest(x, y) and l.status = 'accepted';
$$;

-- reads `reader` has FINISHED for `author`
create or replace function public._beta_done(reader_id uuid, author_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.beta_reads r join public.beta_sends s on s.id = r.send_id
   where r.reader = reader_id and s.author = author_id and r.status = 'finished';
$$;

-- reads `u` is in the middle of (a read quietly lapses 90 days after it was sent)
create or replace function public._beta_active(u uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.beta_reads r where r.reader = u and r.status = 'reading' and r.created_at > now() - interval '90 days';
$$;

do $$ begin
  revoke all on function public._beta_me() from public, anon, authenticated;
  revoke all on function public._beta_name(uuid) from public, anon, authenticated;
  revoke all on function public._beta_opted(uuid) from public, anon, authenticated;
  revoke all on function public._beta_partners(uuid, uuid) from public, anon, authenticated;
  revoke all on function public._beta_done(uuid, uuid) from public, anon, authenticated;
  revoke all on function public._beta_active(uuid) from public, anon, authenticated;
  revoke all on function public._beta_rel(uuid, uuid) from public, anon, authenticated;
end $$;

-- ---------------------------------------------------------------- your profile
create or replace function public.beta_profile_get()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); p public.beta_profiles%rowtype;
begin
  select * into p from public.beta_profiles where user_id = v_me;
  if not found then return null; end if;
  return jsonb_build_object('open', p.open, 'adult', p.adult, 'reads', to_jsonb(p.reads), 'lengths', to_jsonb(p.lengths),
    'capacity', p.capacity, 'wont', p.wont, 'about', p.about, 'turnaround', p.turnaround, 'active', public._beta_active(v_me),
    'swap', p.swap, 'volunteer', p.volunteer);
end; $$;

-- Returns 'ok' | 'adult' (the 18+ box is required)
drop function if exists public.beta_profile_set(text[], text[], int, text, text, text, boolean, boolean);
create or replace function public.beta_profile_set(a_reads text[], a_lengths text[], a_capacity int, a_wont text, a_about text,
                                                   a_turnaround text, a_open boolean, a_adult boolean,
                                                   a_swap boolean default true, a_volunteer boolean default false)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); v_reads text[]; v_len text[];
begin
  if a_adult is not true then return 'adult'; end if;
  select coalesce(array_agg(distinct left(trim(x), 40)) filter (where trim(x) <> ''), '{}') into v_reads
    from unnest(coalesce(a_reads, '{}')) as x limit 1;
  v_reads := v_reads[1:20];
  select coalesce(array_agg(distinct x) filter (where x in ('short', 'novella', 'novel', 'essay', 'poetry')), '{}') into v_len
    from unnest(coalesce(a_lengths, '{}')) as x;
  insert into public.beta_profiles (user_id, open, adult, reads, lengths, capacity, wont, about, turnaround, swap, volunteer, updated_at)
    values (v_me, coalesce(a_open, true), true, v_reads, v_len, greatest(1, least(5, coalesce(a_capacity, 2))),
            nullif(left(trim(coalesce(a_wont, '')), 300), ''), nullif(left(trim(coalesce(a_about, '')), 300), ''),
            nullif(left(trim(coalesce(a_turnaround, '')), 60), ''), coalesce(a_swap, true), coalesce(a_volunteer, false), now())
    on conflict (user_id) do update set open = excluded.open, adult = true, reads = excluded.reads, lengths = excluded.lengths,
      capacity = excluded.capacity, wont = excluded.wont, about = excluded.about, turnaround = excluded.turnaround,
      swap = excluded.swap, volunteer = excluded.volunteer, updated_at = now();
  return 'ok';
end; $$;

-- Leaving: you drop out of the directory and your unanswered requests go; reads already under way carry on.
create or replace function public.beta_profile_leave()
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me();
begin
  delete from public.beta_profiles where user_id = v_me;
  delete from public.beta_links where (a = v_me or b = v_me) and status = 'pending';
  return 'ok';
end; $$;

-- ---------------------------------------------------------------- the directory
drop function if exists public.beta_directory(text);
create or replace function public.beta_directory(a_read text default null)
returns table(user_id uuid, name text, reads text[], lengths text[], capacity int, active int, open boolean,
              about text, wont text, turnaround text, link text, swap boolean, volunteer boolean)
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
           p.swap, p.volunteer
      from public.beta_profiles p
     where p.user_id <> v_me and p.adult and (p.swap or p.volunteer)
       and not public._blocked_either(v_me, p.user_id)
       and (a_read is null or trim(a_read) = '' or exists (select 1 from unnest(p.reads) r where lower(r) = lower(trim(a_read))))
     order by (p.open and public._beta_active(p.user_id) < p.capacity) desc, public._beta_name(p.user_id)
     limit 100;
end; $$;

-- ---------------------------------------------------------------- asking, answering, leaving each other
-- a_kind: 'swap' (read each other's) | 'read' (please read for me — they must read for others without needing reads back)
--         | 'offer' (I'll read for you, nothing needed back)
-- Returns 'ok' | 'accepted' (they had already asked the same of you) | 'opt_in' | 'no_swap' (you don't swap) | 'not_available'
--         | 'self' | 'already' | 'rate' | 'blocked'
drop function if exists public.beta_request(uuid, text);
create or replace function public.beta_request(a_to uuid, a_note text default null, a_kind text default 'swap')
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); l public.beta_links%rowtype; n int; mp public.beta_profiles%rowtype; tp public.beta_profiles%rowtype;
        v_kind text; v_reader uuid;
begin
  if a_to is null or a_to = v_me then return 'self'; end if;
  select * into mp from public.beta_profiles where user_id = v_me and adult;
  if not found then return 'opt_in'; end if;
  select * into tp from public.beta_profiles where user_id = a_to and adult;
  if not found then return 'not_available'; end if;
  if public._blocked_either(v_me, a_to) then return 'blocked'; end if;
  if a_kind = 'read' then
    if not tp.volunteer then return 'not_available'; end if;
    v_kind := 'read'; v_reader := a_to;
  elsif a_kind = 'offer' then
    v_kind := 'read'; v_reader := v_me;
  else
    if not mp.swap then return 'no_swap'; end if;
    if not tp.swap then return 'not_available'; end if;
    v_kind := 'swap'; v_reader := null;
  end if;
  select * into l from public.beta_links where a = least(v_me, a_to) and b = greatest(v_me, a_to) for update;
  if found then
    if l.status = 'accepted' then
      if l.kind = 'swap' or (l.kind = v_kind and l.reader = v_reader) then return 'already'; end if;
      delete from public.beta_links where a = l.a and b = l.b;   -- a one-way link asked to become the other way, or a swap
    elsif l.requested_by = a_to and l.kind = v_kind and l.reader is not distinct from v_reader then
      update public.beta_links set status = 'accepted', responded_at = now() where a = l.a and b = l.b;
      return 'accepted';
    elsif l.requested_by = v_me and l.created_at > now() - interval '21 days' and l.kind = v_kind and l.reader is not distinct from v_reader then
      return 'already';
    else
      delete from public.beta_links where a = l.a and b = l.b;   -- an old or different ask is replaced by this one
    end if;
  end if;
  select count(*) into n from public.beta_links where requested_by = v_me and created_at > now() - interval '1 day';
  if n >= 15 then return 'rate'; end if;
  insert into public.beta_links (a, b, status, requested_by, note, kind, reader)
    values (least(v_me, a_to), greatest(v_me, a_to), 'pending', v_me, nullif(left(trim(coalesce(a_note, '')), 300), ''), v_kind, v_reader);
  return 'ok';
end; $$;

-- Returns 'ok' | 'not_found'
create or replace function public.beta_respond(a_other uuid, a_accept boolean)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); l public.beta_links%rowtype;
begin
  select * into l from public.beta_links where a = least(v_me, a_other) and b = greatest(v_me, a_other) and status = 'pending' and requested_by = a_other for update;
  if not found then return 'not_found'; end if;
  if a_accept then
    if not public._beta_opted(v_me) then return 'not_found'; end if;
    if l.kind = 'swap' and not exists (select 1 from public.beta_profiles where user_id = v_me and swap) then return 'no_swap'; end if;
    update public.beta_links set status = 'accepted', responded_at = now() where a = l.a and b = l.b;
  else
    delete from public.beta_links where a = l.a and b = l.b;
  end if;
  return 'ok';
end; $$;

-- Ends the partnership (or withdraws your own ask). Reads already under way carry on.
create or replace function public.beta_remove(a_other uuid)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me();
begin
  delete from public.beta_links where a = least(v_me, a_other) and b = greatest(v_me, a_other);
  return 'ok';
end; $$;

-- Your beta group: partners, asks both ways, and the ledger between you.
-- rel: 'swap' | 'reads_for_me' | 'i_read_for' (for a pending ask, what it would become)
drop function if exists public.beta_group();
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
       and not public._blocked_either(v_me, o.uid)
     order by (l.status = 'pending' and l.requested_by <> v_me) desc, (l.status = 'accepted') desc, public._beta_name(o.uid);
end; $$;

-- ---------------------------------------------------------------- sending a manuscript
drop function if exists public.beta_send(uuid, text, text, uuid[], text[], text, date);
-- Returns { status: 'ok' | 'not_owner' | 'empty' | 'no_readers' | 'rate', send_id?, sent: [uuid], refused: [{ id, why }] }
-- why: 'not_partner' | 'closed' | 'full' | 'owes' | 'blocked'
create or replace function public.beta_send(a_story uuid, a_title text, a_html text, a_readers uuid[], a_questions text[],
                                            a_notes text default null, a_due date default null, a_version text default null)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); n int; v_sid uuid; r uuid; why text; p public.beta_profiles%rowtype;
        sent jsonb := '[]'::jsonb; refused jsonb := '[]'::jsonb; q jsonb;
begin
  if a_story is not null and not exists (select 1 from public.stories where id = a_story and owner = v_me) then
    return jsonb_build_object('status', 'not_owner');
  end if;
  if a_html is null or length(trim(a_html)) = 0 then return jsonb_build_object('status', 'empty'); end if;
  if length(a_html) > 3000000 then return jsonb_build_object('status', 'empty'); end if;
  if a_readers is null or cardinality(a_readers) = 0 then return jsonb_build_object('status', 'no_readers'); end if;
  select count(*) into n from public.beta_sends where author = v_me and created_at > now() - interval '1 day';
  if n >= 5 then return jsonb_build_object('status', 'rate'); end if;
  select coalesce(jsonb_agg(left(trim(x), 300)) filter (where trim(x) <> ''), '[]'::jsonb) into q
    from (select x from unnest(coalesce(a_questions, '{}')) as x limit 5) t;
  insert into public.beta_sends (story_id, author, title, html, questions, notes, due, version_id)
    values (a_story, v_me, left(coalesce(nullif(trim(a_title), ''), 'Untitled'), 200), a_html, q,
            nullif(left(trim(coalesce(a_notes, '')), 600), ''), a_due, left(a_version, 80))
    returning id into v_sid;
  foreach r in array (select array(select distinct x from unnest(a_readers) as x where x is not null)) loop
    why := null;
    select * into p from public.beta_profiles where user_id = r;
    if r = v_me or coalesce(public._beta_rel(v_me, r), 'read_by') = 'read_by' then why := 'not_partner';   -- they must swap with you, or read for you
    elsif public._blocked_either(v_me, r) then why := 'blocked';
    elsif p.user_id is null or not p.adult or not p.open then why := 'closed';
    elsif public._beta_active(r) >= p.capacity then why := 'full';
    elsif public._beta_rel(v_me, r) = 'swap' and public._beta_done(r, v_me) - public._beta_done(v_me, r) >= 2 then why := 'owes';   -- the ledger is for swaps only
    end if;
    if why is null then
      insert into public.beta_reads (send_id, reader) values (v_sid, r);
      sent := sent || to_jsonb(r);
    else
      refused := refused || jsonb_build_object('id', r, 'why', why);
    end if;
  end loop;
  if jsonb_array_length(sent) = 0 then
    delete from public.beta_sends where id = v_sid;
    return jsonb_build_object('status', 'no_readers', 'sent', sent, 'refused', refused);
  end if;
  return jsonb_build_object('status', 'ok', 'send_id', v_sid, 'sent', sent, 'refused', refused);
end; $$;

-- What you have sent, and where each reader is with it (newest first).
create or replace function public.beta_my_sends()
returns table(send_id uuid, story_id uuid, title text, sent_at timestamptz, due date, read_id uuid, reader uuid, reader_name text,
              status text, progress int, opened_at timestamptz, finished_at timestamptz, stopped_at timestamptz,
              has_report boolean, comments int)
language plpgsql stable security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me();
begin
  return query
    select s.id, s.story_id, s.title, s.created_at, s.due, r.id, r.reader, public._beta_name(r.reader), r.status, r.progress,
           r.opened_at, r.finished_at, r.stopped_at, (r.report is not null),
           (select count(*)::int from public.story_comments c where c.beta_read = r.id)
      from public.beta_sends s join public.beta_reads r on r.send_id = s.id
     where s.author = v_me
     order by s.created_at desc, public._beta_name(r.reader)
     limit 300;
end; $$;

-- What you have been sent to read (newest first).
create or replace function public.beta_my_reads()
returns table(read_id uuid, token uuid, title text, author uuid, author_name text, sent_at timestamptz, due date, status text,
              progress int, questions jsonb, notes text)
language plpgsql stable security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me();
begin
  return query
    select r.id, r.token, s.title, s.author, public._beta_name(s.author), r.created_at, s.due, r.status, r.progress, s.questions, s.notes
      from public.beta_reads r join public.beta_sends s on s.id = r.send_id
     where r.reader = v_me
     order by (r.status = 'reading') desc, r.created_at desc
     limit 200;
end; $$;

-- The reader's report, for the author who sent it.
create or replace function public.beta_report_get(a_read uuid)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); v jsonb;
begin
  select jsonb_build_object('report', r.report, 'status', r.status, 'reader', public._beta_name(r.reader), 'questions', s.questions,
                            'finished_at', r.finished_at, 'stop_reason', r.stop_reason)
    into v from public.beta_reads r join public.beta_sends s on s.id = r.send_id
   where r.id = a_read and s.author = v_me;
  return v;
end; $$;

-- ---------------------------------------------------------------- reading
-- The manuscript, for its reader only. Returns null for anyone else (or a stranger's link).
create or replace function public.beta_open(tok uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); r public.beta_reads%rowtype; s public.beta_sends%rowtype;
begin
  select * into r from public.beta_reads where token = tok;
  if not found or r.reader <> v_me then return null; end if;
  select * into s from public.beta_sends where id = r.send_id;
  if r.opened_at is null then update public.beta_reads set opened_at = now() where id = r.id; end if;
  return jsonb_build_object('read_id', r.id, 'story_id', s.story_id, 'title', s.title, 'author', public._beta_name(s.author),
    'html', s.html, 'questions', s.questions, 'notes', s.notes, 'due', s.due, 'sent_at', s.created_at,
    'status', r.status, 'progress', r.progress, 'report', r.report);
end; $$;

-- How far through the reader is (only ever goes up). Returns the recorded progress.
create or replace function public.beta_progress(tok uuid, a_pct int)
returns int language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); v int;
begin
  update public.beta_reads set progress = greatest(progress, greatest(0, least(100, coalesce(a_pct, 0))))
   where token = tok and reader = v_me and status = 'reading'
   returning progress into v;
  return coalesce(v, -1);
end; $$;

-- Finishing, with the report: { worked, lost, answers: [..], keep: 1–5, note }
create or replace function public.beta_finish(tok uuid, a_report jsonb)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); rep jsonb; k int; ans jsonb;
begin
  begin k := (a_report->>'keep')::int; exception when others then k := null; end;
  if k is not null and (k < 1 or k > 5) then k := null; end if;
  select coalesce(jsonb_agg(left(coalesce(x #>> '{}', ''), 2000)), '[]'::jsonb) into ans
    from (select x from jsonb_array_elements(case when jsonb_typeof(a_report->'answers') = 'array' then a_report->'answers' else '[]'::jsonb end) x limit 5) t;
  rep := jsonb_build_object('worked', left(coalesce(a_report->>'worked', ''), 2000), 'lost', left(coalesce(a_report->>'lost', ''), 2000),
                            'note', left(coalesce(a_report->>'note', ''), 2000), 'answers', ans, 'keep', k);
  update public.beta_reads set status = 'finished', finished_at = now(), progress = 100, report = rep
   where token = tok and reader = v_me and status in ('reading', 'finished');
  if not found then return 'not_found'; end if;
  return 'ok';
end; $$;

-- Stopping partway: no mark against you; the author sees where you got to.
create or replace function public.beta_stop(tok uuid, a_reason text default null)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me();
begin
  update public.beta_reads set status = 'stopped', stopped_at = now(), stop_reason = nullif(left(trim(coalesce(a_reason, '')), 600), '')
   where token = tok and reader = v_me and status = 'reading';
  if not found then return 'not_found'; end if;
  return 'ok';
end; $$;

-- A reader's comment, into the story's comment stream (private to the author and this reader).
create or replace function public.add_beta_comment(tok uuid, a_anchor text, a_section int, a_body text)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); r public.beta_reads%rowtype; s public.beta_sends%rowtype; nid uuid; n int;
begin
  select * into r from public.beta_reads where token = tok;
  if not found or r.reader <> v_me or r.status = 'stopped' then raise exception 'not allowed'; end if;
  select * into s from public.beta_sends where id = r.send_id;
  if s.story_id is null then raise exception 'the story is gone'; end if;
  if a_body is null or length(trim(a_body)) = 0 then raise exception 'empty comment'; end if;
  select count(*) into n from public.story_comments where author_id = v_me and created_at > now() - interval '60 seconds';
  if n >= 10 then raise exception 'slow down'; end if;
  select count(*) into n from public.story_comments where beta_read = r.id and created_at > now() - interval '1 day';
  if n >= 300 then raise exception 'that is a lot of comments for one day — the rest can wait for tomorrow'; end if;
  insert into public.story_comments (story_id, author_id, author_name, anchor_key, section_idx, body, author_account, beta_read, version_id)
    values (s.story_id, v_me, left(public._beta_name(v_me), 40), left(a_anchor, 2000), coalesce(a_section, 0), left(trim(a_body), 4000), true, r.id, s.version_id)
    returning id into nid;
  return nid;
end; $$;

-- Replies: migration 10's, with a beta reader able to answer the author under their own comment.
create or replace function public.add_comment_reply(cid uuid, a_body text, a_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_who text; v_name text; v_body text; n int; lastby text; lastat timestamptz; outv jsonb;
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  select id, story_id, author_id, beta_read, coalesce(replies, '[]'::jsonb) as replies into r
    from public.story_comments where id = cid;
  if r.id is null then raise exception 'comment not found'; end if;

  if public.is_story_owner(r.story_id) or public.is_collaborator(r.story_id) then
    v_who := 'author';
  elsif r.author_id is not null and r.author_id = auth.uid() and public.story_is_public(r.story_id) then
    v_who := 'reader';
  elsif r.author_id is not null and r.author_id = auth.uid() and r.beta_read is not null
        and exists (select 1 from public.beta_reads b where b.id = r.beta_read and b.reader = auth.uid() and b.status <> 'stopped') then
    v_who := 'reader';   -- v.835 — a beta reader, on their own read
  else
    raise exception 'not allowed';
  end if;

  v_body := left(trim(coalesce(a_body, '')), 2000);
  if length(v_body) = 0 then raise exception 'empty reply'; end if;
  n := jsonb_array_length(r.replies);
  if n >= 50 then raise exception 'this thread is full'; end if;
  if n > 0 then
    lastby := r.replies -> (n - 1) ->> 'by';
    begin lastat := (r.replies -> (n - 1) ->> 'at')::timestamptz; exception when others then lastat := null; end;
    if lastby = v_who and lastat is not null and lastat > now() - interval '3 seconds' then raise exception 'slow down'; end if;
  end if;

  v_name := left(coalesce(nullif(trim(regexp_replace(coalesce(a_name, ''), '[[:cntrl:]]', '', 'g')), ''),
                      case when v_who = 'author' then 'Author' else 'Reader' end), 40);

  update public.story_comments
     set replies = r.replies || jsonb_build_array(jsonb_build_object(
           'by', v_who, 'name', v_name, 'body', v_body,
           'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
   where id = cid
   returning replies into outv;
  return outv;
end; $$;
revoke all on function public.add_comment_reply(uuid, text, text) from public;
grant execute on function public.add_comment_reply(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- inviting readers (v.836) — by email, or a link for a post
-- Returns { status: 'ok' | 'opt_in' | 'bad_email' | 'self' | 'already' | 'rate' }. Never says whether the address has an account.
create or replace function public.beta_invite_email(a_email text, a_note text default null)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); v_email text := lower(trim(coalesce(a_email, ''))); v_to uuid; n int; v_send boolean := true; v_id uuid;
begin
  if not public._beta_opted(v_me) then return jsonb_build_object('status', 'opt_in'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then return jsonb_build_object('status', 'bad_email'); end if;
  if v_email = (select lower(email) from auth.users where id = v_me) then return jsonb_build_object('status', 'self'); end if;
  select count(*) into n from public.beta_invites where author = v_me and created_at > now() - interval '1 day';
  if n >= 15 then return jsonb_build_object('status', 'rate'); end if;
  if exists (select 1 from public.beta_invites where author = v_me and email = v_email and status <> 'revoked' and created_at > now() - interval '7 days') then
    return jsonb_build_object('status', 'already');
  end if;
  select id into v_to from public.profiles where lower(email) = v_email limit 1;
  if v_to is not null and public._beta_rel(v_me, v_to) in ('swap', 'reads_for') then return jsonb_build_object('status', 'already'); end if;
  if v_to is not null and public._blocked_either(v_me, v_to) then v_send := false; end if;
  select count(*) into n from public.beta_invites where email = v_email and send and created_at > now() - interval '7 days';
  if n >= 3 then v_send := false; end if;
  insert into public.beta_invites (author, kind, email, note, max_uses, send)
    values (v_me, 'email', v_email, nullif(left(trim(coalesce(a_note, '')), 300), ''), 1, v_send) returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end; $$;

-- Your shareable link (one open at a time, up to 100 readers). a_new = true retires the old one and makes another.
create or replace function public.beta_invite_link(a_note text default null, a_new boolean default false)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); v public.beta_invites%rowtype;
begin
  if not public._beta_opted(v_me) then return jsonb_build_object('status', 'opt_in'); end if;
  if a_new then update public.beta_invites set status = 'revoked' where author = v_me and kind = 'link' and status = 'open'; end if;
  select * into v from public.beta_invites where author = v_me and kind = 'link' and status = 'open' order by created_at desc limit 1;
  if not found then
    insert into public.beta_invites (author, kind, note, max_uses, send) values (v_me, 'link', nullif(left(trim(coalesce(a_note, '')), 300), ''), 100, false)
      returning * into v;
  elsif a_note is not null then
    update public.beta_invites set note = nullif(left(trim(a_note), 300), '') where id = v.id returning * into v;
  end if;
  return jsonb_build_object('status', 'ok', 'id', v.id, 'token', v.token, 'uses', v.uses, 'max_uses', v.max_uses, 'note', v.note);
end; $$;

create or replace function public.beta_invite_revoke(a_id uuid)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me();
begin
  update public.beta_invites set status = 'revoked' where id = a_id and author = v_me and status = 'open';
  return case when found then 'ok' else 'not_found' end;
end; $$;

create or replace function public.beta_invites_mine()
returns table(id uuid, kind text, email text, note text, token uuid, uses int, max_uses int, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me();
begin
  return query select i.id, i.kind, i.email, i.note, i.token, i.uses, i.max_uses, i.status, i.created_at
    from public.beta_invites i where i.author = v_me and (i.status = 'open' or i.created_at > now() - interval '30 days')
    order by i.created_at desc limit 50;
end; $$;

-- Anyone holding the link (signed out too) sees who is asking and their note.
create or replace function public.beta_invite_peek(tok uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.beta_invites%rowtype;
begin
  select * into v from public.beta_invites where token = tok;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', case when v.status = 'open' and v.uses >= v.max_uses then 'used' else v.status end,
    'author_name', public._beta_name(v.author), 'note', v.note, 'kind', v.kind, 'mine', (v.author = auth.uid()),
    'reader', (auth.uid() is not null and public._beta_rel(v.author, auth.uid()) in ('swap', 'reads_for')));
end; $$;

-- Opening the link (signed in) and saying yes makes you the author's reader. Joining this way needs the 18+ box, and makes a
-- private reader profile (not in the directory) if you don't have one.
-- Returns 'ok' | 'already' | 'adult' | 'not_found' | 'revoked' | 'used' | 'self' | 'blocked'
create or replace function public.beta_invite_accept(tok uuid, a_adult boolean default false)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_me uuid := public._beta_me(); v public.beta_invites%rowtype; l public.beta_links%rowtype;
begin
  select * into v from public.beta_invites where token = tok for update;
  if not found then return 'not_found'; end if;
  if v.author = v_me then return 'self'; end if;
  if v.status = 'revoked' then return 'revoked'; end if;
  if public._blocked_either(v.author, v_me) then return 'blocked'; end if;
  if public._beta_rel(v.author, v_me) in ('swap', 'reads_for') then return 'already'; end if;
  if v.status = 'used' or v.uses >= v.max_uses then return 'used'; end if;
  if not public._beta_opted(v_me) then
    if a_adult is not true then return 'adult'; end if;
    insert into public.beta_profiles (user_id, open, adult, swap, volunteer) values (v_me, true, true, false, false)
      on conflict (user_id) do update set adult = true, updated_at = now();
  end if;
  delete from public.beta_links where a = least(v.author, v_me) and b = greatest(v.author, v_me);
  insert into public.beta_links (a, b, status, requested_by, note, kind, reader, responded_at)
    values (least(v.author, v_me), greatest(v.author, v_me), 'accepted', v.author, v.note, 'read', v_me, now());
  update public.beta_invites set uses = uses + 1, status = case when kind = 'email' then 'used' else status end where id = v.id;
  return 'ok';
end; $$;

-- ---------------------------------------------------------------- the emails (for the notices function only)
-- New manuscripts waiting for a reader, and new asks — once each, within 3 days of being made.
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
   where l.emailed_at is null and l.status = 'pending' and l.created_at > now() - interval '3 days' and u.email is not null
  union all
  select 'invite'::text, i.id, i.email, public._beta_name(i.author), null::text, i.token, i.note, null::date
    from public.beta_invites i
   where i.kind = 'email' and i.send and i.emailed_at is null and i.status = 'open' and i.created_at > now() - interval '3 days'
  limit 300;
$$;
revoke all on function public.notice_batch_beta() from public, anon, authenticated;
do $$ begin grant execute on function public.notice_batch_beta() to service_role; exception when undefined_object then null; end $$;

create or replace function public.notice_mark_beta(ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int; m int; k int;
begin
  update public.beta_reads set emailed_at = now() where id = any(ids) and emailed_at is null; get diagnostics n = row_count;
  update public.beta_links set emailed_at = now() where id = any(ids) and emailed_at is null; get diagnostics m = row_count;
  update public.beta_invites set emailed_at = now() where id = any(ids) and emailed_at is null; get diagnostics k = row_count;
  return n + m + k;
end; $$;
revoke all on function public.notice_mark_beta(uuid[]) from public, anon, authenticated;
do $$ begin grant execute on function public.notice_mark_beta(uuid[]) to service_role; exception when undefined_object then null; end $$;

-- ---------------------------------------------------------------- who may call what
do $$ declare f text; begin
  foreach f in array array[
    'beta_profile_get()', 'beta_profile_set(text[], text[], int, text, text, text, boolean, boolean, boolean, boolean)', 'beta_profile_leave()',
    'beta_directory(text)', 'beta_request(uuid, text, text)', 'beta_respond(uuid, boolean)', 'beta_remove(uuid)', 'beta_group()',
    'beta_invite_email(text, text)', 'beta_invite_link(text, boolean)', 'beta_invite_revoke(uuid)', 'beta_invites_mine()', 'beta_invite_accept(uuid, boolean)',
    'beta_send(uuid, text, text, uuid[], text[], text, date, text)', 'beta_my_sends()', 'beta_my_reads()', 'beta_report_get(uuid)',
    'beta_open(uuid)', 'beta_progress(uuid, int)', 'beta_finish(uuid, jsonb)', 'beta_stop(uuid, text)',
    'add_beta_comment(uuid, text, int, text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

revoke all on function public.beta_invite_peek(uuid) from public;
grant execute on function public.beta_invite_peek(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
-- Done.
