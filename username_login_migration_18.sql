-- username_login_migration_18.sql — Dystoria v.866
-- [Jeremy: "allow for username as well as email when signing in"]
--
-- Sign-in with a username. Supabase signs people in by email, so the app asks this function to turn a
-- username into its account's email — and it answers ONLY when the password is right. Someone who
-- doesn't know the password learns nothing (not even whether the username exists): the answer is the
-- same empty result either way. The app then signs in with that email in the usual way.
--
-- Guard against guessing: ten wrong tries for one username within fifteen minutes and it stops answering
-- for that username until the window passes (Supabase's own sign-in limits still apply on top).
--
-- Safe to run more than once. Run it in the Supabase SQL editor (it needs the postgres role, which can
-- read auth.users; the function is SECURITY DEFINER with its search_path pinned).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.login_attempts (
  login  text primary key,
  n      int not null default 0,
  since  timestamptz not null default now()
);
alter table public.login_attempts enable row level security;   -- no policies: only the function below touches it
revoke all on public.login_attempts from anon, authenticated;

create or replace function public.login_email(p_login text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  k  text := lower(btrim(coalesce(p_login, '')));
  la record;
  u  record;
begin
  if k = '' or coalesce(p_password, '') = '' or position('@' in k) > 0 or length(k) > 64 then
    return null;
  end if;

  select * into la from public.login_attempts where login = k;
  if found and la.since > now() - interval '15 minutes' and la.n >= 10 then
    raise exception 'rate' using errcode = 'P0001';
  end if;

  for u in
    select au.email, au.encrypted_password
      from auth.users au
      left join public.profiles p on p.id = au.id
     where au.email is not null
       and au.encrypted_password is not null
       and au.encrypted_password <> ''
       and (lower(p.username) = k or lower(au.raw_user_meta_data->>'username') = k)
  loop
    if extensions.crypt(p_password, u.encrypted_password) = u.encrypted_password then
      delete from public.login_attempts where login = k;
      return u.email;
    end if;
  end loop;

  insert into public.login_attempts as a (login, n, since) values (k, 1, now())
  on conflict (login) do update set
    n     = case when a.since > now() - interval '15 minutes' then a.n + 1 else 1 end,
    since = case when a.since > now() - interval '15 minutes' then a.since else now() end;
  return null;
end
$$;

revoke all on function public.login_email(text, text) from public;
grant execute on function public.login_email(text, text) to anon, authenticated;

-- Check (should return one row, security_definer = true, with the search_path set):
-- select proname, prosecdef as security_definer, proconfig from pg_proc where proname = 'login_email';
