-- ============================================================================
-- Dystoria — migration 7: a revoke that revokes, and per-visitor feedback
--
-- Idempotent: safe to run more than once. Run AFTER ai_usage_migration_6.sql.
--
-- Two changes, both asked for by Jeremy on 2026-08-23:
--
--   1 · Unpublishing DESTROYS the reader link instead of parking it. Until now
--       `set_story_public(sid,false)` cleared `is_public` and left `public_token`
--       in place, so republishing handed back the SAME token and anyone who had
--       ever held the link silently regained access. An unshare that does not
--       revoke is not an unshare.
--
--   2 · A visitor to a public link sees ONLY THEIR OWN comments; the author (and
--       their collaborators) see everyone's. The app already filtered guests to
--       their own comments — but it did so IN THE BROWSER, over a payload that
--       contained everybody's. The rows were always leaving the database, so any
--       reader with the devtools open, or the publishable anon key and curl, could
--       read every comment left on a shared story. This moves the filter to where
--       it is enforceable.
--
--       Readers also gain the right to read back their OWN marks, which they have
--       never had — the impression policies were owner-only, so a reader's marks
--       could not survive a reload from the server's side.
-- ============================================================================

-- ---------------------------------------------------------------- 1 · revoke
create or replace function public.set_story_public(sid uuid, on_flag boolean)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare tok uuid;
begin
  if not public.is_story_owner(sid) then return ''; end if;
  if on_flag then
    -- republish mints a NEW token, because the previous one was destroyed below
    select public_token into tok from public.stories where id = sid;
    if tok is null then tok := gen_random_uuid(); end if;
    update public.stories set is_public = true, public_token = tok where id = sid;
    return tok::text;
  else
    -- the token is DESTROYED, not parked: every link handed out so far stops
    -- resolving, and there is no way back to it
    update public.stories set is_public = false, public_token = null where id = sid;
    return '';
  end if;
end;
$function$;

-- ------------------------------------------------- 2 · comments, per visitor
-- `comments_select_public` granted SELECT to anon and authenticated on EVERY
-- comment of a public story. It was also the policy the author read through, so
-- it cannot simply be narrowed — it becomes two policies, which OR together.
drop policy if exists comments_select_public on public.story_comments;
drop policy if exists comments_select_own    on public.story_comments;
drop policy if exists comments_select_owner  on public.story_comments;

-- a visitor: their own comments, and only while the link is live
create policy comments_select_own on public.story_comments
  for select to anon, authenticated
  using (author_id = auth.uid() and public.story_is_public(story_id));

-- the author, and anyone writing the story with them: everything
create policy comments_select_owner on public.story_comments
  for select to authenticated
  using (public.is_story_owner(story_id) or public.is_collaborator(story_id));

-- ---------------------------------------------- 3 · a reader's own marks
-- Owner-only until now, so a reader could write a mark and never read it back.
drop policy if exists imp_select_own on public.story_impressions;

create policy imp_select_own on public.story_impressions
  for select to anon, authenticated
  using (reader_id = auth.uid());

-- ------------------------------------------------------------------- notes
-- Deliberately NOT in this migration, because they are separate decisions:
--   · revoke truncate on all tables in schema public from anon, authenticated;
--     (TRUNCATE is not subject to RLS — it ignores every policy above)
--   · dropping the older {public}-role duplicates on `stories` and
--     `story_impressions` (`owner reads`, `owner updates`, `imp_owner_read`, …)
