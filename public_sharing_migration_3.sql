-- ============================================================
--  DYSTORIA — PUBLIC READ + ANONYMOUS COMMENTS MIGRATION (v3)
--  Run ONCE in Supabase:  Project → SQL Editor → New query → paste → Run
--  Safe to re-run (idempotent / guarded).
--
--  REQUIRES one dashboard setting (no SQL):
--    Authentication → Sign In / Providers → "Anonymous sign-ins" → ENABLE
--    (lets a reader leave a comment under a name without making an account)
--
--  What this adds:
--    • stories.is_public      — owner opt-in: anyone with the link can read+comment
--    • stories.public_token   — the random token that goes in the share link
--    • story_comments         — reader comments (separate from the prose doc, so
--                               guests can NEVER edit your story, only comment)
--    • RPCs (security definer):
--        set_story_public(sid, on)  → returns the link token (owner only)
--        get_public_story(tok)      → returns one public story for anyone
--        add_public_comment(...)    → a reader posts a comment (anon or signed-in)
--    • RLS so anon readers can SELECT comments on a PUBLIC story (drives realtime),
--      the owner can delete any comment, and an author can delete their own.
--    • Realtime enabled on story_comments (live margin conversation)
-- ============================================================

-- ----------------------------------------------------------------
-- 1. STORIES — public opt-in + link token
-- ----------------------------------------------------------------
alter table public.stories
  add column if not exists is_public    boolean not null default false,
  add column if not exists public_token uuid;

create unique index if not exists stories_public_token_idx
  on public.stories(public_token) where public_token is not null;

-- ----------------------------------------------------------------
-- 2. STORY_COMMENTS  (reader feedback; never touches the prose doc)
--    anchor_key  = first ~60 chars of the paragraph the comment is on
--    section_idx = which section/frame (0-based) it belongs to
-- ----------------------------------------------------------------
create table if not exists public.story_comments (
  id          uuid primary key default gen_random_uuid(),
  story_id    uuid not null references public.stories(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,  -- anon OR real user
  author_name text not null default 'Guest',
  anchor_key  text,
  section_idx int  not null default 0,
  body        text not null,
  hidden      boolean not null default false,   -- owner can hide individual comments
  created_at  timestamptz not null default now()
);

create index if not exists story_comments_story_idx
  on public.story_comments(story_id, created_at);

alter table public.story_comments enable row level security;

-- ----------------------------------------------------------------
-- 3. HELPERS  (security definer → avoids recursive-RLS issues)
-- ----------------------------------------------------------------
create or replace function public.story_is_public(sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.stories s where s.id = sid and s.is_public);
$$;

-- (is_story_owner already exists from sharing_migration.sql)

-- ----------------------------------------------------------------
-- 4. RLS for story_comments
--    SELECT: anyone (anon included) may read comments on a PUBLIC story.
--            This is what lets the live realtime feed reach guests.
--    INSERT: only through add_public_comment() below (no direct policy).
--    DELETE: the story owner (moderation) OR the comment's own author.
--    UPDATE: the story owner (used to hide/unhide).
-- ----------------------------------------------------------------
drop policy if exists comments_select_public on public.story_comments;
create policy comments_select_public on public.story_comments
  for select to anon, authenticated
  using (public.story_is_public(story_id));

drop policy if exists comments_delete on public.story_comments;
create policy comments_delete on public.story_comments
  for delete to anon, authenticated
  using (public.is_story_owner(story_id) or author_id = auth.uid());

drop policy if exists comments_update_owner on public.story_comments;
create policy comments_update_owner on public.story_comments
  for update to authenticated
  using (public.is_story_owner(story_id))
  with check (public.is_story_owner(story_id));

-- ----------------------------------------------------------------
-- 5. RPC — owner toggles public sharing, gets the link token
--    Returns the token as text, or '' when turned off / not owner.
-- ----------------------------------------------------------------
create or replace function public.set_story_public(sid uuid, on_flag boolean)
returns text language plpgsql security definer set search_path = public as $$
declare tok uuid;
begin
  if not public.is_story_owner(sid) then return ''; end if;
  if on_flag then
    select public_token into tok from public.stories where id = sid;
    if tok is null then tok := gen_random_uuid(); end if;
    update public.stories set is_public = true, public_token = tok where id = sid;
    return tok::text;
  else
    update public.stories set is_public = false where id = sid;
    return '';
  end if;
end; $$;
grant execute on function public.set_story_public(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------
-- 6. RPC — anyone with a valid token loads the public story
--    Returns minimal fields only (never exposes the owner's other rows).
--    `author` powers the "© Year Author — All rights reserved" notice
--    shown on the public reader, asserting the writer's ownership.
-- ----------------------------------------------------------------
create or replace function public.get_public_story(tok uuid)
returns table (id uuid, title text, doc jsonb, author text)
language sql security definer stable set search_path = public as $$
  select s.id, s.title, s.doc,
         coalesce(nullif(p.username, ''), split_part(p.email, '@', 1), 'The author') as author
  from public.stories s
  left join public.profiles p on p.id = s.owner   -- username + email (added in sharing migrations)
  where s.public_token = tok and s.is_public = true
  limit 1;
$$;
grant execute on function public.get_public_story(uuid) to anon, authenticated;

-- ----------------------------------------------------------------
-- 7. RPC — a reader posts a comment (anon or signed-in)
--    Validates the token → public story, light rate-limit, returns the new id.
-- ----------------------------------------------------------------
create or replace function public.add_public_comment(
  tok uuid, a_name text, a_anchor text, a_section int, a_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; nid uuid; recent int;
begin
  select id into sid from public.stories where public_token = tok and is_public = true limit 1;
  if sid is null then raise exception 'story not found or not public'; end if;
  if a_body is null or length(trim(a_body)) = 0 then raise exception 'empty comment'; end if;
  -- light rate-limit: max 10 comments / 60s from this author (or anon session)
  select count(*) into recent from public.story_comments
    where author_id = auth.uid() and created_at > now() - interval '60 seconds';
  if recent >= 10 then raise exception 'slow down'; end if;
  insert into public.story_comments (story_id, author_id, author_name, anchor_key, section_idx, body)
    values (sid, auth.uid(), coalesce(nullif(trim(a_name), ''), 'Guest'),
            a_anchor, coalesce(a_section, 0), left(trim(a_body), 4000))
    returning id into nid;
  return nid;
end; $$;
grant execute on function public.add_public_comment(uuid, text, text, int, text) to anon, authenticated;

-- ----------------------------------------------------------------
-- 8. REALTIME — live margin conversation
-- ----------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.story_comments;
exception when duplicate_object then null;
end $$;

-- Done.  After running: enable Anonymous sign-ins (see header), then hard-reload the app.
