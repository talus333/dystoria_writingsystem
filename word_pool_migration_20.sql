-- ============================================================================
--  Dystoria · migration 20 — My Dystoria pool follows the account (app v.878)
--  Written 2026-09-28. Run once in the Supabase SQL editor. Re-runnable.
--
--  WHY
--  My Dystoria pool (the words that show up in every story) lived only in the
--  browser. Sign-out clears the browser on purpose, so the pool was wiped, and a
--  second device never had it.
--
--  WHAT
--   · profiles.word_pool     jsonb        — the pool: {v, words:{cat:[{word,sub,desc,g,at}]},
--                                           gone:{"cat|word": when it was removed}}
--   · profiles.word_pool_at  timestamptz  — when it was last written
--   · a 256 KB ceiling on it (about a thousand described words), so the pool can
--     never become a storage problem
--   · UPDATE on those two columns for the signed-in user. Grants are additive:
--     this adds the two columns to what migrations 4 and 11 already allow and
--     changes nothing else. The row-level policies (profiles_select_self,
--     profiles_update_self) still decide WHICH row — only your own.
--
--  Until this runs, the app keeps a small pool (≤ 8 KB) in the account's own
--  metadata and a larger one on the device; once it has run, the app moves it
--  here on the next sync and empties the metadata copy.
-- ============================================================================
alter table public.profiles add column if not exists word_pool    jsonb;
alter table public.profiles add column if not exists word_pool_at timestamptz;

do $$ begin
  alter table public.profiles add constraint word_pool_size
    check (word_pool is null or octet_length(word_pool::text) <= 262144);
exception when duplicate_object then null; end $$;

grant update (word_pool, word_pool_at) on public.profiles to authenticated;

-- ============================================================================
--  Verify (read-only):
--    select column_name from information_schema.columns
--      where table_schema = 'public' and table_name = 'profiles'
--        and column_name in ('word_pool', 'word_pool_at');                           -- 2 rows
--    select privilege_type, column_name from information_schema.column_privileges
--      where table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE';
--                        -- username, writer_profile, writer_profile_at, word_pool, word_pool_at
-- ============================================================================
