-- ============================================================
--  DYSTORIA — SUBSCRIPTIONS MIGRATION (v5)
--  Run ONCE in Supabase: Project → SQL Editor → New query → paste → Run.
--  Idempotent / safe to re-run. Builds on sharing_migration*.sql + security_hardening_migration_4.sql.
--
--  Adds the entitlement source of truth for the paid plan:
--    • subscriptions — one row per user, the AUTHORITATIVE record of who is 'free' vs 'pro'
--    • RLS so a user can READ their own row (for the client's plan badge) but never WRITE it
--    • a row is auto-seeded ('free') for every existing + future user
--
--  WHO WRITES THIS TABLE: nobody via the web client. Only the Stripe webhook in the
--  Cloudflare Worker writes here, using the Supabase SERVICE ROLE key (which bypasses RLS).
--  The Worker also READS this table (service role) to decide allowPaid/quota per request —
--  it never trusts a `tier` field sent by the browser. (Worker wiring is migration step 2.)
--
--  Plan model: Free + one Pro tier; Pro billed monthly OR annually (billing_interval).
-- ============================================================

-- ----------------------------------------------------------------
-- 1. SUBSCRIPTIONS TABLE
--    `plan` is the EFFECTIVE entitlement the webhook keeps current ('free' | 'pro').
--    `status` mirrors the raw Stripe subscription status for debugging / lifecycle logic.
-- ----------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  plan                   text        not null default 'free',      -- 'free' | 'pro'  (what the Worker gates on)
  status                 text        not null default 'inactive',  -- 'active'|'trialing'|'past_due'|'canceled'|'incomplete'|'inactive'
  billing_interval       text,                                     -- 'month' | 'year' | null
  stripe_customer_id     text unique,                              -- cus_… (one per user; created at first checkout)
  stripe_subscription_id text,                                     -- sub_… (current subscription)
  current_period_end     timestamptz,                              -- when the paid access currently runs out
  cancel_at_period_end   boolean     not null default false,       -- user canceled but keeps access until period end
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint subscriptions_plan_chk     check (plan in ('free','pro')),
  constraint subscriptions_interval_chk check (billing_interval is null or billing_interval in ('month','year'))
);

-- Webhook looks subscriptions up by Stripe ids; index the non-unique one.
create index if not exists subscriptions_stripe_sub_idx on public.subscriptions (stripe_subscription_id);

-- ----------------------------------------------------------------
-- 2. ROW-LEVEL SECURITY
--    A user may READ only their own row (so the client can show "Free"/"Pro" + period end).
--    There is intentionally NO insert/update/delete policy → with RLS on, all client writes
--    are denied. Only the service-role webhook (which bypasses RLS) ever mutates this table.
-- ----------------------------------------------------------------
alter table public.subscriptions enable row level security;

drop policy if exists subscriptions_select_self on public.subscriptions;
create policy subscriptions_select_self on public.subscriptions
  for select to authenticated
  using (user_id = auth.uid());

-- Defense in depth: make sure clients hold no direct write privilege regardless of RLS.
revoke insert, update, delete on public.subscriptions from anon, authenticated;

-- ----------------------------------------------------------------
-- 3. KEEP updated_at FRESH on every write
-- ----------------------------------------------------------------
create or replace function public.subscriptions_touch_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists subscriptions_set_updated on public.subscriptions;
create trigger subscriptions_set_updated
  before update on public.subscriptions
  for each row execute function public.subscriptions_touch_updated();

-- ----------------------------------------------------------------
-- 4. AUTO-SEED a 'free' row for every user (existing + future)
--    Means the client always has a row to read and the webhook can plain UPDATE on upgrade.
--    (The Worker still treats a MISSING row as 'free', so this is convenience, not a hard dep.)
-- ----------------------------------------------------------------
insert into public.subscriptions (user_id)
  select id from auth.users
  on conflict (user_id) do nothing;

create or replace function public.handle_new_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created_sub on auth.users;
create trigger on_auth_user_created_sub
  after insert on auth.users
  for each row execute function public.handle_new_subscription();

-- Done. Verify:
--   select user_id, plan, status from public.subscriptions limit 5;   -- everyone should be 'free' / 'inactive'
-- Next (step 2): add SUPABASE_SERVICE_ROLE_KEY as a Cloudflare secret and wire the Worker's planOf().
