-- ============================================================
--  DYSTORIA — SECURITY HARDENING MIGRATION (v4)
--  Run ONCE in Supabase: Project → SQL Editor → New query → paste → Run.
--  Idempotent / safe to re-run. Builds on sharing_migration*.sql + public_sharing_migration_3.sql.
--
--  Closes three issues found in the 2026-06-19 security review. None is a live breach;
--  all are defense-in-depth. The Dystoria web client keeps working unchanged after this
--  (it only ever updates profiles.username, and toggles publishing via set_story_public()).
-- ============================================================

-- ----------------------------------------------------------------
-- FIX 1 (moderate) — stop a user from rewriting their profiles.email.
--   profiles_update_self lets a user UPDATE their own row; with no column limit they could set
--   email to someone else's, which would misdirect a share_story(invitee_email) invite to them.
--   profiles.email is meant to mirror auth.users.email (kept in sync by the on_auth_user_upserted
--   trigger), so clients should only ever change `username`. Enforce that with column privileges.
-- ----------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant  update (username) on public.profiles to authenticated;
-- (RLS policy profiles_update_self still restricts WHICH row; this restricts WHICH column.)

-- ----------------------------------------------------------------
-- FIX 2 (moderate) — stop a collaborator from seizing ownership or changing publish state.
--   stories_update allows owner OR collaborator to UPDATE the row, and the WITH CHECK passes as
--   long as the new owner = auth.uid() — so a collaborator could set owner=themselves, or flip
--   is_public / rotate public_token by writing the columns directly (bypassing set_story_public).
--   A BEFORE UPDATE trigger pins those protected columns for anyone who isn't the current owner.
--   (Server-side jobs run with no auth.uid() and are left untouched.)
-- ----------------------------------------------------------------
create or replace function public.stories_guard_protected_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- owner (or a server-side / service-role caller with no JWT) keeps full control
  if auth.uid() is null or OLD.owner = auth.uid() then
    return NEW;
  end if;
  -- a collaborator may edit title/doc/planning_baton, but never these:
  NEW.owner        := OLD.owner;
  NEW.is_public    := OLD.is_public;
  NEW.public_token := OLD.public_token;
  return NEW;
end; $$;

drop trigger if exists stories_guard_protected on public.stories;
create trigger stories_guard_protected
  before update on public.stories
  for each row execute function public.stories_guard_protected_fields();

-- ----------------------------------------------------------------
-- FIX 3 (low / privacy) — don't leak an author's email local-part publicly.
--   get_public_story fell back to split_part(email,'@',1) as the public "author" name when the
--   user had no username, exposing e.g. "johnsmith1985" on a shared link. Fall back to a neutral
--   label instead. (Authors who set a username still show it. Consider prompting for a username
--   at publish time so public stories carry a real byline.)
-- ----------------------------------------------------------------
create or replace function public.get_public_story(tok uuid)
returns table (id uuid, title text, doc jsonb, author text)
language sql security definer stable set search_path = public as $$
  select s.id, s.title, s.doc,
         coalesce(nullif(p.username, ''), 'The author') as author
  from public.stories s
  left join public.profiles p on p.id = s.owner
  where s.public_token = tok and s.is_public = true
  limit 1;
$$;
grant execute on function public.get_public_story(uuid) to anon, authenticated;

-- Done. After running: re-test sign-in, saving a story, sharing with a collaborator, and a public
-- read link, to confirm everything still behaves.
