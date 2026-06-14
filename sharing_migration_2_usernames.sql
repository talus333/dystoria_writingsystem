-- ============================================================
--  DYSTORIA — USERNAMES + "shared with" lookup  (run once)
--  Supabase dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run. Builds on sharing_migration.sql.
-- ============================================================

-- 1. username column on profiles
alter table public.profiles add column if not exists username text;

-- A user may update their OWN profile (to set/change their username).
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- 2. Keep profiles in sync AND carry a username chosen at sign-up
--    (passed in auth metadata as { username }).
create or replace function public.handle_user_profile()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, username)
    values (new.id, new.email, nullif(new.raw_user_meta_data->>'username',''))
    on conflict (id) do update
      set email = excluded.email,
          username = coalesce(public.profiles.username, excluded.username);
  return new;
end; $$;

drop trigger if exists on_auth_user_upserted on auth.users;
create trigger on_auth_user_upserted
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_user_profile();

-- 3. Who is on a story (owner + collaborators) with display names.
--    Security definer so the owner/collaborators can read each other's
--    usernames without opening up the profiles table broadly.
create or replace function public.story_people(sid uuid)
returns table(user_id uuid, role text, username text, email text)
language sql security definer stable set search_path = public as $$
  select s.owner, 'owner'::text, p.username, p.email
    from public.stories s
    left join public.profiles p on p.id = s.owner
    where s.id = sid and (s.owner = auth.uid() or public.is_collaborator(sid))
  union all
  select c.user_id, 'collaborator'::text, p.username, p.email
    from public.story_collaborators c
    left join public.profiles p on p.id = c.user_id
    where c.story_id = sid and (public.is_story_owner(sid) or public.is_collaborator(sid));
$$;
grant execute on function public.story_people(uuid) to authenticated;

-- Done.
