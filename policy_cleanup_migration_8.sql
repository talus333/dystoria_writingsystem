-- ============================================================================
-- Dystoria — migration 8: retire the duplicated first-generation policies
--
-- Idempotent. Safe to re-run. Order-independent with respect to migration 7,
-- though 7 first is tidier.
--
-- WHY. `stories` and `story_impressions` each carry TWO generations of policy:
-- an older set granted to the `{public}` role, and a newer set granted to
-- `{authenticated}`. Postgres ORs permissive policies together, so the effective
-- rule today is the union — which is the newer one, because in every pair the
-- newer is equal or broader. Nothing is being enforced by the older set.
--
-- It is not a hole. It is a trap: **the old policies do not know about
-- collaborators**, so a future tightening of `stories_select` would be silently
-- undone by the twin nobody remembers editing. A rule enforced in two places is
-- a rule that will one day be enforced in one.
--
-- WHY EACH DROP IS SAFE — checked pair by pair, not assumed:
--
--   "owner reads"   SELECT {public} (auth.uid() = owner)
--     → stories_select SELECT {authenticated} (owner = auth.uid() OR is_collaborator(id))
--       Strictly broader. And `{public}` includes `anon`, where auth.uid() is
--       NULL, so `NULL = owner` is NULL and the old policy grants anon nothing.
--
--   "owner updates" UPDATE {public} (auth.uid() = owner), with_check NULL
--     → stories_update UPDATE {authenticated} (… OR is_collaborator(id)) + with_check
--       Note the subtlety: an UPDATE policy with no WITH CHECK reuses its USING
--       expression as the check, so the old effective check was `auth.uid() =
--       owner`. The survivor's WITH CHECK is broader, and permissive WITH CHECKs
--       OR, so the combined behaviour is unchanged by the drop.
--
--   "owner inserts" INSERT {public} with_check (auth.uid() = owner)
--     → stories_insert INSERT {authenticated} with_check (owner = auth.uid())
--       Identical for authenticated; grants anon nothing (uid is NULL).
--
--   "owner deletes" DELETE {public} (auth.uid() = owner)
--     → stories_delete DELETE {authenticated} (owner = auth.uid())
--       Identical for authenticated; grants anon nothing.
--
--   imp_owner_read  SELECT {public} (story_id IN (select id from stories
--                                                  where owner = auth.uid()))
--     → impressions_select_owner SELECT {authenticated}
--         (is_story_owner(story_id) OR is_collaborator(story_id))
--       Strictly broader — same owner test, plus collaborators.
--
-- `service_role` and `postgres` bypass RLS entirely, so no privileged path
-- depends on the `{public}` grants either.
--
-- TO PUT ANY OF THEM BACK, the originals were:
--   create policy "owner reads"   on public.stories for select using (auth.uid() = owner);
--   create policy "owner updates" on public.stories for update using (auth.uid() = owner);
--   create policy "owner inserts" on public.stories for insert with check (auth.uid() = owner);
--   create policy "owner deletes" on public.stories for delete using (auth.uid() = owner);
--   create policy imp_owner_read  on public.story_impressions for select
--     using (story_id in (select stories.id from stories where stories.owner = auth.uid()));
-- ============================================================================

drop policy if exists "owner reads"   on public.stories;
drop policy if exists "owner updates" on public.stories;
drop policy if exists "owner inserts" on public.stories;
drop policy if exists "owner deletes" on public.stories;

drop policy if exists imp_owner_read on public.story_impressions;

-- ---------------------------------------------------------------- verify
-- What is left. Expect: stories 4 (select/insert/update/delete, all
-- {authenticated}); story_impressions 2 before migration 7, 3 after.
select tablename, policyname, cmd, roles
from   pg_policies
where  schemaname = 'public'
  and  tablename in ('stories','story_impressions')
order  by tablename, cmd, policyname;
