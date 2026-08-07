-- ============================================================
--  DYSTORIA — VERSION SHARING MIGRATION  (#12 / #33)
--  Run ONCE in Supabase: Project → SQL Editor → New query → paste → Run.
--  Idempotent / safe to re-run.
--
--  RUN dystoria_reader_impression_migration.sql FIRST — this one assumes
--  story_impressions exists and adds the version binding around it.
--
--  WHAT IT IS
--  Sharing freezes a snapshot. When the author shares a story (or presses "Publish
--  current draft to readers"), readers see that exact version and the author's later
--  edits stay private until they publish again. Feedback — impressions AND written
--  comments — binds to the version it was left on, so a version's Feedback view paints
--  the marks on the prose those readers actually read, rather than on a draft that has
--  since moved underneath them.
--
--  Version ids are TEXT, not uuid: the client mints them in captureVersion() as
--  'v' + base36 timestamp + random (e.g. 'vm3k1a9f2'). They live in the story's own
--  doc JSON, so there is no versions table to reference.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. THE PUBLISHED SNAPSHOT on stories
--    published_html is the frozen prose readers are served. It is deliberately a copy
--    rather than a pointer into doc: the whole point is that it does not move when the
--    author keeps writing.
-- ----------------------------------------------------------------
alter table public.stories add column if not exists published_version_id text;
alter table public.stories add column if not exists published_html       text;
alter table public.stories add column if not exists published_label      text;
alter table public.stories add column if not exists published_at         timestamptz;

-- ----------------------------------------------------------------
-- 2. VERSION-BIND THE WRITTEN COMMENTS
--    story_impressions already carries version_id (previous migration). Comments need
--    the same so the two feedback layers can be shown together per version.
--    Existing comments keep version_id = null and still show on the live view.
-- ----------------------------------------------------------------
alter table public.story_comments add column if not exists version_id text;

-- Defensive: if story_comments predates this and the column add above was skipped for any
-- reason, this index would fail. The add is idempotent, so re-running is safe.
create index if not exists story_comments_version_idx
  on public.story_comments (story_id, version_id, created_at);

-- ----------------------------------------------------------------
-- 3. RPC — serve the frozen snapshot to a reader
--    Returns nothing when the author has never published, and the client falls back to
--    the live doc via get_public_story — so a link shared before this migration keeps
--    working exactly as it did.
-- ----------------------------------------------------------------
create or replace function public.get_public_snapshot(tok uuid)
returns table (version_id text, html text, label text, published_at timestamptz)
language sql security definer stable set search_path = public as $$
  select s.published_version_id, s.published_html, s.published_label, s.published_at
  from public.stories s
  where s.public_token = tok
    and s.is_public = true
    and s.published_html is not null
  limit 1;
$$;
grant execute on function public.get_public_snapshot(uuid) to anon, authenticated;

-- ----------------------------------------------------------------
-- 4. RPC — a reader posts a comment, bound to the version they read
--    The versioned sibling of add_public_comment (migration 3), which stays in place
--    for older clients. Adds the allow_comments check the per-link toggle needs.
-- ----------------------------------------------------------------
create or replace function public.add_public_comment_v(
  tok uuid, a_name text, a_anchor text, a_section int, a_body text, a_version text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; allowed boolean; nid uuid; recent int;
begin
  select id, allow_comments into sid, allowed
    from public.stories where public_token = tok and is_public = true limit 1;
  if sid is null then raise exception 'story not found or not public'; end if;
  if allowed is not true then raise exception 'comments are turned off for this link'; end if;
  if a_body is null or length(trim(a_body)) = 0 then raise exception 'empty comment'; end if;

  -- same light rate-limit as add_public_comment: 10 / 60s per author (or anon session)
  select count(*) into recent from public.story_comments
    where author_id = auth.uid() and created_at > now() - interval '60 seconds';
  if recent >= 10 then raise exception 'slow down'; end if;

  insert into public.story_comments
      (story_id, author_id, author_name, anchor_key, section_idx, body, version_id)
    values (sid, auth.uid(), coalesce(nullif(trim(a_name), ''), 'Guest'),
            a_anchor, coalesce(a_section, 0), left(trim(a_body), 4000), nullif(a_version, ''))
    returning id into nid;
  return nid;
end; $$;
grant execute on function public.add_public_comment_v(uuid, text, text, int, text, text) to anon, authenticated;

-- ----------------------------------------------------------------
-- 5. PROTECT THE PUBLISH CONTROLS
--    security_hardening_migration_4 pins owner / is_public / public_token so a
--    collaborator can't seize a story or flip it public by writing columns directly.
--    Publishing to readers is the same class of decision — it decides what the outside
--    world sees — so the publish and per-link feedback columns join that list.
--    A collaborator may still edit title/doc/planning_baton as before.
--    (Redefining the migration-4 function in place; it is create-or-replace by design.)
-- ----------------------------------------------------------------
create or replace function public.stories_guard_protected_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- owner (or a server-side / service-role caller with no JWT) keeps full control
  if auth.uid() is null or OLD.owner = auth.uid() then
    return NEW;
  end if;
  -- a collaborator may edit title/doc/planning_baton, but never these:
  NEW.owner                := OLD.owner;
  NEW.is_public            := OLD.is_public;
  NEW.public_token         := OLD.public_token;
  -- …nor what readers are served, nor whether readers may respond:
  NEW.published_version_id := OLD.published_version_id;
  NEW.published_html       := OLD.published_html;
  NEW.published_label      := OLD.published_label;
  NEW.published_at         := OLD.published_at;
  NEW.allow_comments       := OLD.allow_comments;
  NEW.allow_impressions    := OLD.allow_impressions;
  return NEW;
end; $$;

drop trigger if exists stories_guard_protected on public.stories;
create trigger stories_guard_protected
  before update on public.stories
  for each row execute function public.stories_guard_protected_fields();

-- ============================================================
--  Verify:
--    select published_version_id, published_label, published_at from public.stories limit 5;  -- nulls
--    select version_id from public.story_comments limit 5;                                    -- nulls
--
--  Then end-to-end, which is what actually proves it:
--    1. Open a story → share it (or "Publish current draft to readers").
--       → published_version_id / published_html / published_at fill in.
--    2. Open the reader link in a private window. Note what it says.
--    3. Back in the app, write another paragraph and save — do NOT publish.
--       → reload the reader link: it must still show the OLD text. That is the feature.
--       → the share panel should say the draft has unpublished changes.
--    4. On the reader link, highlight a passage and leave a feeling and a comment.
--    5. In the app: Revise → version history → that version → Feedback.
--       → the marks paint on the frozen prose and the comment is listed.
--  Step 3 is the one worth doing carefully; everything else follows from it.
-- ============================================================
