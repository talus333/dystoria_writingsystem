-- ============================================================================
--  Dystoria · migration 9 — close the unwatched overloads
--  Written 2026-08-23. Run AFTER migrations 7 and 8 (both already applied).
--
--  WHY
--  Three RPCs have carried two live signatures each since the version-sharing
--  migration added `a_version`: an older `text`-token form beside the newer
--  `uuid` form. Introspection of production on 2026-08-23 shows the pair are
--  NOT equivalent — the old `add_public_impression(text,text,text)` is missing
--  every guard the new one gained:
--
--     check                                    text form   uuid form
--     ---------------------------------------  ---------   ---------
--     requires a signed-in (even anon) reader      no          yes
--     honours the author's allow_impressions       NO          yes
--     validates the impression kind                no          yes
--     rejects an empty anchor                      no          yes
--     clamps the anchor to 2000 chars              no          yes
--     rate-limits the reader                       NO          yes
--
--  Both are SECURITY DEFINER and both are EXECUTE-able by `anon`, so the old
--  form is a working write path into story_impressions that ignores the
--  author's "impressions off" switch and has no rate limit or size clamp.
--  An overload nobody remembers is a door nobody is watching.
--
--  WHAT THIS DOES — and what it deliberately does NOT do
--  It does not DROP them. PostgREST picks an overload from the parameter names
--  in the request body, and while the shipped client always sends `a_version`
--  (so it resolves to the uuid form), `get_public_link_settings` is called with
--  `tok` alone and may well be resolving to the TEXT form in production right
--  now. Dropping is a bet on which one the wire picks; delegating is not.
--
--  So each old form becomes a one-line shim over the new one. There is then
--  exactly ONE implementation of each rule, the old signature inherits every
--  future check for free, and nothing any deployed bundle calls changes shape.
--
--  Re-runnable, and safe on a partial prior state: CREATE OR REPLACE only, no
--  drops, no data touched. Existing GRANTs survive CREATE OR REPLACE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · add_public_impression(text, text, text)  →  the uuid form
--     Returns uuid, same as today. A malformed token raises the same message
--     the uuid form raises for an unknown one, rather than leaking a Postgres
--     cast error to a reader.
-- ---------------------------------------------------------------------------
create or replace function public.add_public_impression(tok text, a_anchor text, a_kind text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v uuid;
begin
  begin
    v := tok::uuid;
  exception when invalid_text_representation then
    raise exception 'story not found or not public';
  end;
  return public.add_public_impression(v, a_anchor, a_kind, null);
end;
$function$;

comment on function public.add_public_impression(text, text, text) is
  'COMPATIBILITY SHIM (migration 9, 2026-08-23). Delegates to add_public_impression(uuid,text,text,text), which owns every check. Kept only because PostgREST resolves overloads from the request body and an older bundle may still call this signature. Do not add logic here. Safe to DROP once no deployed client can send a three-argument call.';

-- ---------------------------------------------------------------------------
-- 2 · remove_public_impression(text, text, text)  →  the uuid form
--     Returns void, same as today.
-- ---------------------------------------------------------------------------
create or replace function public.remove_public_impression(tok text, a_anchor text, a_kind text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v uuid;
begin
  begin
    v := tok::uuid;
  exception when invalid_text_representation then
    raise exception 'story not found or not public';
  end;
  perform public.remove_public_impression(v, a_anchor, a_kind, null);
end;
$function$;

comment on function public.remove_public_impression(text, text, text) is
  'COMPATIBILITY SHIM (migration 9, 2026-08-23). Delegates to remove_public_impression(uuid,text,text,text). Do not add logic here.';

-- ---------------------------------------------------------------------------
-- 3 · get_public_link_settings(text)  →  the uuid form
--     Returns TABLE(allow_comments boolean, allow_impressions boolean), same
--     as today. This is a READ on a path the reader hits while opening a link,
--     so a malformed token returns NO ROWS rather than raising: the client
--     already treats an empty result as "no settings", and an error here would
--     put a banner in front of a reader for a typo in a URL.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_link_settings(tok text)
returns table(allow_comments boolean, allow_impressions boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v uuid;
begin
  begin
    v := tok::uuid;
  exception when invalid_text_representation then
    return;
  end;
  return query select * from public.get_public_link_settings(v);
end;
$function$;

comment on function public.get_public_link_settings(text) is
  'COMPATIBILITY SHIM (migration 9, 2026-08-23). Delegates to get_public_link_settings(uuid). Do not add logic here. NOTE: this signature may be the one PostgREST actually resolves, because the client sends `tok` alone — check before dropping it.';

-- ---------------------------------------------------------------------------
-- 4 · Verify. Every one of these should now be a shim: short, and containing
--     the name of the function it delegates to.
-- ---------------------------------------------------------------------------
select p.oid::regprocedure::text as signature,
       length(p.prosrc)          as src_len,
       (p.prosrc ~* ('public\.' || p.proname)) as delegates,   -- parens matter: ~* binds tighter than ||
       p.prosecdef               as security_definer,
       array_to_string(p.proconfig, ',') as config,
       obj_description(p.oid, 'pg_proc') is not null as documented
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('add_public_impression', 'remove_public_impression', 'get_public_link_settings')
order by p.proname, p.oid;
