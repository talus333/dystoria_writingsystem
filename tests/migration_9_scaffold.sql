-- ============================================================================
--  Migration 9 test harness — run it against a SCRATCH Postgres, never production.
--
--    initdb -D /tmp/pgdata -U postgres --auth=trust
--    pg_ctl -D /tmp/pgdata -o '-k /tmp/pgrun -p 5433' start
--    psql -h /tmp/pgrun -p 5433 -U postgres -f migration_9_scaffold.sql
--    psql ... -f migration_9_probe.sql          # BEFORE: most checks say ACCEPTED
--    psql ... -f overload_shims_migration_9.sql
--    psql ... -f migration_9_probe.sql          # AFTER:  every check says refused
--
--  Why a real cluster and not just a parser: libpg-query validates the SQL
--  grammar but a plpgsql body is only a string literal to it, so a body that
--  cannot compile parses clean. This harness compiles and RUNS the thing.
-- ============================================================================

-- A faithful-enough stand-in for the production schema, so migration 9 can be
-- COMPILED AND RUN rather than only parsed. Only the pieces the three RPCs touch.
create schema if not exists auth;
-- auth.uid() in Supabase reads the request JWT; here it reads a GUC we can set.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  owner uuid,
  is_public boolean default false,
  public_token uuid,
  allow_comments boolean default true,
  allow_impressions boolean default true
);
create table public.story_impressions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null,
  version_id text,
  anchor_key text not null,
  kind text not null,
  reader_id uuid,
  created_at timestamptz not null default now()
);
create unique index on public.story_impressions (story_id, coalesce(version_id,''), anchor_key, kind, reader_id);

-- ===== the CURRENT uuid form, copied verbatim from production =====
CREATE OR REPLACE FUNCTION public.add_public_impression(tok uuid, a_anchor text, a_kind text, a_version text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare sid uuid; allowed boolean; nid uuid; recent int;
begin
  if auth.uid() is null then
    raise exception 'sign-in required — enable Anonymous sign-ins in Supabase → Authentication → Providers';
  end if;
  select id, allow_impressions into sid, allowed
    from public.stories where public_token = tok and is_public = true limit 1;
  if sid is null then raise exception 'story not found or not public'; end if;
  if allowed is not true then raise exception 'impressions are turned off for this link'; end if;
  if a_kind not in ('like', 'dislike', 'confused') then raise exception 'unknown impression kind'; end if;
  if a_anchor is null or length(trim(a_anchor)) = 0 then raise exception 'empty selection'; end if;

  select count(*) into recent from public.story_impressions
    where reader_id = auth.uid() and created_at > now() - interval '60 seconds';
  if recent >= 60 then raise exception 'slow down'; end if;

  insert into public.story_impressions (story_id, version_id, anchor_key, kind, reader_id)
    values (sid, nullif(a_version, ''), left(trim(a_anchor), 2000), a_kind, auth.uid())
    on conflict do nothing
    returning id into nid;
  return nid;
end; $function$;

-- ===== stand-ins for the two uuid forms whose source was not read =====
-- Behaviour matched to the introspection profile; they exist so the shims can
-- compile and so delegation is observable. Not claimed to be verbatim.
create or replace function public.remove_public_impression(tok uuid, a_anchor text, a_kind text, a_version text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  select id into sid from public.stories where public_token = tok and is_public = true limit 1;
  if sid is null then raise exception 'story not found or not public'; end if;
  delete from public.story_impressions
   where story_id = sid and reader_id = auth.uid()
     and anchor_key = left(trim(a_anchor), 2000) and kind = a_kind
     and coalesce(version_id,'') = coalesce(nullif(a_version,''),'');
end; $function$;

create or replace function public.get_public_link_settings(tok uuid)
returns table(allow_comments boolean, allow_impressions boolean)
language plpgsql security definer set search_path to 'public' as $function$
begin
  return query select s.allow_comments, s.allow_impressions
    from public.stories s where s.public_token = tok and s.is_public = true limit 1;
end; $function$;

-- ===== the OLD text forms, RECONSTRUCTED from the production introspection =====
-- (no sign-in check · no allow_impressions check · no kind validation ·
--  no empty-anchor check · no clamp · no rate limit — exactly the profile the
--  catalog reported). Reconstruction, not verbatim source: it exists so the
--  counter-test can show what the shim removes.
create or replace function public.add_public_impression(tok text, a_anchor text, a_kind text)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare sid uuid; nid uuid;
begin
  select id into sid from public.stories where public_token = tok::uuid and is_public = true limit 1;
  if sid is null then raise exception 'story not found or not public'; end if;
  insert into public.story_impressions (story_id, anchor_key, kind, reader_id)
    values (sid, a_anchor, a_kind, auth.uid())
    on conflict do nothing returning id into nid;
  return nid;
end; $function$;

create or replace function public.remove_public_impression(tok text, a_anchor text, a_kind text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare sid uuid;
begin
  select id into sid from public.stories where public_token = tok::uuid and is_public = true limit 1;
  if sid is null then raise exception 'story not found or not public'; end if;
  delete from public.story_impressions where story_id = sid and reader_id = auth.uid()
    and anchor_key = a_anchor and kind = a_kind;
end; $function$;

create or replace function public.get_public_link_settings(tok text)
returns table(allow_comments boolean, allow_impressions boolean)
language plpgsql security definer set search_path to 'public' as $function$
begin
  return query select s.allow_comments, s.allow_impressions
    from public.stories s where s.public_token = tok::uuid and s.is_public = true limit 1;
end; $function$;
