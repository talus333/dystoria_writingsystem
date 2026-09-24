-- ============================================================================
--  Dystoria · migration 11 — the writer's profile follows the account (app v.815)
--  Written 2026-09-24. Run once in the Supabase SQL editor. Re-runnable.
--
--  WHY
--  The account page's profile (About you, interests, favourite books and authors,
--  voice, aims) and the reading list — including the books ticked off in the wiki's
--  suggested reading — lived only in the browser. Sign-out clears the browser on
--  purpose, so all of it was wiped, and a second device never had it.
--
--  WHAT
--   · profiles.writer_profile     jsonb        — the profile object, as the app keeps it
--   · profiles.writer_profile_at  timestamptz  — when it was last saved (newer wins)
--   · a 64 KB ceiling on it, so a profile can never become a storage problem
--   · UPDATE on those two columns for the signed-in user. Migration 4 limited
--     profile updates to `username` by column grant; this extends that grant to the
--     two new columns and nothing else. The row-level policy (profiles_update_self)
--     still decides WHICH row — only your own.
--
--  Until this runs, the app keeps the profile in the account's own metadata instead
--  (capped at 8 KB); once it has run, the app writes here.
-- ============================================================================
alter table public.profiles add column if not exists writer_profile    jsonb;
alter table public.profiles add column if not exists writer_profile_at timestamptz;

do $$ begin
  alter table public.profiles add constraint writer_profile_size
    check (writer_profile is null or octet_length(writer_profile::text) <= 65536);
exception when duplicate_object then null; end $$;

grant update (username, writer_profile, writer_profile_at) on public.profiles to authenticated;

-- ============================================================================
--  Verify (read-only):
--    select column_name from information_schema.columns
--      where table_schema = 'public' and table_name = 'profiles'
--        and column_name in ('writer_profile', 'writer_profile_at');                 -- 2 rows
--    select privilege_type, column_name from information_schema.column_privileges
--      where table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE';
--                                                     -- username, writer_profile, writer_profile_at
-- ============================================================================
