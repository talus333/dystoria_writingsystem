-- ============================================================
--  DYSTORIA — READER IMPRESSION MIGRATION  (#33)
--  Run ONCE in Supabase: Project → SQL Editor → New query → paste → Run.
--  Idempotent / safe to re-run. Builds on public_sharing_migration_3.sql
--  (story_comments, story_is_public, get_public_story) and sharing_migration.sql
--  (is_story_owner, is_collaborator).
--
--  RUN THIS ONE FIRST, then dystoria_version_sharing_migration.sql.
--
--  WHAT IT IS
--  The wordless feedback layer on a shared link: a reader highlights a passage and
--  taps Liked it / Didn't like it / Confused. The author sees those feelings painted
--  on the exact passages. Principle: "highlighting a feeling is helpful; notes are a
--  hazard." Written comments (story_comments) are the complementary layer and are
--  untouched here.
--
--  ⚠ PREREQUISITE — enable anonymous sign-ins.
--  Supabase → Authentication → Providers → Anonymous sign-ins → ON.
--  Every mark is attributed to auth.uid() so a reader can toggle their own mark off
--  and can't stack the same feeling twice. Without it the RPCs below raise a clear
--  error rather than silently miscounting.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. PER-LINK TOGGLES on stories
--    The share panel lets the author allow/disallow each feedback kind per story.
--    Default ON so existing shared links keep behaving as they do today.
-- ----------------------------------------------------------------
alter table public.stories add column if not exists allow_comments    boolean not null default true;
alter table public.stories add column if not exists allow_impressions boolean not null default true;

-- ----------------------------------------------------------------
-- 2. STORY_IMPRESSIONS
--    One row per (reader, passage, feeling). Mirrors story_comments' shape.
--      anchor_key = the exact quoted selection the reader highlighted (may span paragraphs)
--      kind       = 'like' | 'dislike' | 'confused'  (IMP_KINDS in the client)
--      version_id = the shared version this was left on — TEXT, not uuid: the client
--                   generates ids like 'vm3k1a9f2' in captureVersion(). Nullable, so
--                   this migration stands alone before the version-sharing one.
--      reader_id  = auth.uid() (usually an anonymous user) — lets a reader un-mark.
-- ----------------------------------------------------------------
create table if not exists public.story_impressions (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null references public.stories(id) on delete cascade,
  version_id text,
  anchor_key text,
  kind       text,
  reader_id  uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Bring an EXISTING table up to shape. The statement above is a no-op if some earlier
-- attempt already created story_impressions, which would leave the indexes below pointing
-- at columns that aren't there — the "column version_id does not exist" failure. These
-- adds are no-ops on a fresh install and repairs on a partial one.
alter table public.story_impressions add column if not exists version_id text;
alter table public.story_impressions add column if not exists anchor_key text;
alter table public.story_impressions add column if not exists kind       text;
alter table public.story_impressions add column if not exists reader_id  uuid references auth.users(id) on delete cascade;
alter table public.story_impressions add column if not exists created_at timestamptz not null default now();

-- Add the kind check only if it isn't already there (ALTER ... ADD CONSTRAINT has no
-- IF NOT EXISTS form, so catch the duplicate).
do $imp$ begin
  alter table public.story_impressions
    add constraint story_impressions_kind_chk check (kind in ('like', 'dislike', 'confused'));
exception when duplicate_object then null; end $imp$;

-- The author paints all impressions for a story; the version preview filters by version.
create index if not exists story_impressions_story_idx   on public.story_impressions (story_id);
create index if not exists story_impressions_version_idx on public.story_impressions (story_id, version_id);

-- One mark per reader per passage per feeling. A reader may leave two DIFFERENT feelings on
-- the same passage (the client blends them), so kind is part of the key. version_id is
-- coalesced because NULL never equals NULL in a unique index; the extra parens make it a
-- valid index expression.
create unique index if not exists story_impressions_unique_idx
  on public.story_impressions (story_id, (coalesce(version_id, '')), anchor_key, kind, reader_id);

alter table public.story_impressions enable row level security;

-- ----------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY
--    The author (and any collaborator, who is a co-author of the same story) reads the
--    feedback. Readers never read the table directly — they write through the RPCs
--    below, which are SECURITY DEFINER. There is deliberately no client insert/update/
--    delete policy, so with RLS on, every direct write is denied.
-- ----------------------------------------------------------------
drop policy if exists impressions_select_owner on public.story_impressions;
create policy impressions_select_owner on public.story_impressions
  for select to authenticated
  using (public.is_story_owner(story_id) or public.is_collaborator(story_id));

revoke insert, update, delete on public.story_impressions from anon, authenticated;

-- ----------------------------------------------------------------
-- 4. RPC — a reader marks a passage
--    Validates the token → public story, checks the author still allows impressions,
--    light rate-limit, idempotent (re-marking the same thing is a no-op).
-- ----------------------------------------------------------------
create or replace function public.add_public_impression(
  tok uuid, a_anchor text, a_kind text, a_version text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; allowed boolean; nid uuid; recent int;
begin
  if auth.uid() is null then
    raise exception 'sign-in required — enable Anonymous sign-ins in Supabase → Authentication → Providers';
  end if;
  select id, allow_impressions into sid, allowed
    from public.stories where public_token = tok and is_public = true limit 1;
  if sid is null then raise exception 'story not found or not public'; end if;
  if allowed is not true then raise exception 'impressions are turned off for this link'; end if;
  if a_kind not in ('like', 'dislike', 'confused') then raise exception 'unknown impression kind'; end if;
  if a_anchor is null or length(trim(a_anchor)) = 0 then raise exception 'empty selection'; end if;

  -- light rate-limit: max 60 marks / 60s from this reader (marking is a fast, low-cost gesture,
  -- so this is far looser than the comment limit — it exists only to stop a script).
  select count(*) into recent from public.story_impressions
    where reader_id = auth.uid() and created_at > now() - interval '60 seconds';
  if recent >= 60 then raise exception 'slow down'; end if;

  insert into public.story_impressions (story_id, version_id, anchor_key, kind, reader_id)
    values (sid, nullif(a_version, ''), left(trim(a_anchor), 2000), a_kind, auth.uid())
    on conflict do nothing
    returning id into nid;
  return nid;   -- null when the mark already existed; the client treats that as success
end; $$;
grant execute on function public.add_public_impression(uuid, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------
-- 5. RPC — a reader takes their mark back
--    Scoped to auth.uid(), so a reader can only ever remove their own.
-- ----------------------------------------------------------------
create or replace function public.remove_public_impression(
  tok uuid, a_anchor text, a_kind text, a_version text default null)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  select id into sid from public.stories where public_token = tok and is_public = true limit 1;
  if sid is null then raise exception 'story not found or not public'; end if;

  delete from public.story_impressions
   where story_id  = sid
     and reader_id = auth.uid()
     and anchor_key = left(trim(a_anchor), 2000)
     and kind = a_kind
     and coalesce(version_id, '') = coalesce(nullif(a_version, ''), '');
end; $$;
grant execute on function public.remove_public_impression(uuid, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------
-- 6. RPC — what this link allows
--    The reader page asks before showing the feedback controls, so a disallowed
--    kind never renders a button that would be refused.
-- ----------------------------------------------------------------
create or replace function public.get_public_link_settings(tok uuid)
returns table (allow_comments boolean, allow_impressions boolean)
language sql security definer stable set search_path = public as $$
  select s.allow_comments, s.allow_impressions
  from public.stories s
  where s.public_token = tok and s.is_public = true
  limit 1;
$$;
grant execute on function public.get_public_link_settings(uuid) to anon, authenticated;

-- ============================================================
--  Verify:
--    select allow_comments, allow_impressions from public.stories limit 5;   -- both true
--    select count(*) from public.story_impressions;                          -- 0
--  Then, on a real shared link (in a private window, signed out):
--    highlight a passage → tap a feeling → a row appears here:
--    select anchor_key, kind, version_id, created_at
--      from public.story_impressions order by created_at desc limit 5;
--  And in the app: Revise → Notes ▾ → Reader Impressions should paint that passage.
--
--  NEXT: run dystoria_version_sharing_migration.sql.
-- ============================================================
