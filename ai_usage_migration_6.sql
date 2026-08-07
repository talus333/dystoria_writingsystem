-- ============================================================
--  DYSTORIA — AI USAGE METERING MIGRATION (v6)
--  Run ONCE in Supabase: Project → SQL Editor → New query → paste → Run.
--  Idempotent / safe to re-run. Builds on subscriptions_migration_5.sql.
--
--  WHY THIS EXISTS
--  The Worker already caps AI use, but it caps the wrong unit: a flat CALL COUNT
--  (1200/day free, 6000 pro). One `import` sends up to 300,000 characters and takes
--  an 8,192-token reply; one `icon_pick` sends a sentence and takes 24 tokens. Those
--  differ by ~1000x and currently cost exactly the same quota. Nothing is recorded
--  per call, so there is no data from which to write an honest policy.
--
--  This table is the measurement. It changes NO limits — today's count caps stay in
--  place as the backstop. The plan is: meter for a few weeks, then set per-feature
--  policy from what a real writing week actually costs.
--
--  WHO WRITES THIS TABLE: only the Cloudflare Worker, using the SERVICE ROLE key
--  (which bypasses RLS). The browser can READ its own rows (for the account-card
--  usage read-out) and can never write.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. THE TABLE
--    One row per AI call. `feature` is the registry name from
--    Dystoria_AI_Access_Gating_Design.md §3 (e.g. 'import', 'refract', 'wiki_build').
--    `estimated` marks rows whose token counts came from a character estimate
--    because the provider returned no usage block — keep them separable so an
--    analysis can weight or exclude them.
-- ----------------------------------------------------------------
create table if not exists public.ai_usage (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  at          timestamptz not null default now(),
  feature     text,                                  -- registry name, e.g. 'import'
  kind        text,                                  -- worker route: icon|brief|import|research|image|text
  model       text,                                  -- which provider actually served it (chain `via`)
  plan        text,                                  -- 'free' | 'pro' at the time of the call
  in_tokens   integer     not null default 0,
  out_tokens  integer     not null default 0,
  estimated   boolean     not null default false,    -- true = counts are a char-based estimate
  ok          boolean     not null default true,     -- false = the call failed or was refused
  outcome     text,                                  -- null when ok; else 'limit' | 'error'
  ms          integer,                               -- wall-clock for the provider call
  constraint ai_usage_plan_chk check (plan is null or plan in ('free','pro'))
);

-- Reads are "this user, recently" and "this feature, recently". Index both.
create index if not exists ai_usage_user_at_idx    on public.ai_usage (user_id, at desc);
create index if not exists ai_usage_at_idx         on public.ai_usage (at desc);
create index if not exists ai_usage_feature_at_idx on public.ai_usage (feature, at desc);

-- ----------------------------------------------------------------
-- 2. ROW-LEVEL SECURITY
--    A user may READ only their own rows (so the account card can show their usage).
--    There is intentionally NO insert/update/delete policy → with RLS on, every
--    client write is denied. Only the service-role Worker ever writes here.
-- ----------------------------------------------------------------
alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_select_self on public.ai_usage;
create policy ai_usage_select_self on public.ai_usage
  for select to authenticated
  using (user_id = auth.uid());

-- Defense in depth: no direct write privilege regardless of RLS.
revoke insert, update, delete on public.ai_usage from anon, authenticated;

-- ----------------------------------------------------------------
-- 3. THE CALLER'S OWN SUMMARY
--    PostgREST can't aggregate well through RLS, and the account card wants one
--    round trip, so expose a function. SECURITY DEFINER but hard-scoped to
--    auth.uid() — it can only ever return the caller's own totals.
-- ----------------------------------------------------------------
create or replace function public.my_ai_usage(days integer default 30)
returns table (feature text, calls bigint, in_tokens bigint, out_tokens bigint, estimated_calls bigint)
language sql
security definer
set search_path = public
stable
as $$
  select u.feature,
         count(*)                                        as calls,
         coalesce(sum(u.in_tokens), 0)                   as in_tokens,
         coalesce(sum(u.out_tokens), 0)                  as out_tokens,
         coalesce(sum(case when u.estimated then 1 else 0 end), 0) as estimated_calls
  from public.ai_usage u
  where u.user_id = auth.uid()
    and u.at >= now() - (greatest(least(days, 365), 1) || ' days')::interval
  group by u.feature
  order by out_tokens desc;
$$;

revoke all on function public.my_ai_usage(integer) from public, anon;
grant execute on function public.my_ai_usage(integer) to authenticated;

-- ----------------------------------------------------------------
-- 4. RETENTION
--    This table grows with every AI call, and nothing here needs to live forever —
--    the point is a rolling picture of what features cost. Prune anything older
--    than 180 days. Call it from a scheduled job (Supabase → Database → Cron), or
--    run it by hand now and then; it is safe either way.
-- ----------------------------------------------------------------
create or replace function public.prune_ai_usage()
returns void language sql security definer set search_path = public as $$
  delete from public.ai_usage where at < now() - interval '180 days';
$$;
revoke all on function public.prune_ai_usage() from public, anon, authenticated;

-- Done. Verify:
--   select count(*) from public.ai_usage;                       -- 0 until the Worker deploys
--   select * from public.my_ai_usage(30);                       -- as a signed-in user: your own totals
-- Then, once a couple of weeks of data exist, the question this was built to answer:
--   select feature,
--          count(*) as calls,
--          sum(in_tokens + out_tokens) as tokens,
--          round(avg(in_tokens + out_tokens)) as avg_tokens
--   from public.ai_usage
--   where at >= now() - interval '14 days'
--   group by feature
--   order by tokens desc;
