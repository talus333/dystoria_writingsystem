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

-- The six things the old text form must now refuse (or handle) exactly as the
-- uuid form does. Run against the scratch cluster BEFORE and AFTER migration 9;
-- before, most of these come back `ACCEPTED`.
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on

-- fixtures: one public story with impressions ON, one with impressions OFF
delete from public.story_impressions;
delete from public.stories;
insert into public.stories (id, is_public, public_token, allow_impressions)
values ('11111111-1111-1111-1111-111111111111', true, '22222222-2222-2222-2222-222222222222', true),
       ('33333333-3333-3333-3333-333333333333', true, '44444444-4444-4444-4444-444444444444', false);

create or replace function pg_temp.try(sql text) returns text language plpgsql as $$
begin execute sql; return 'ACCEPTED';
exception when others then return 'refused: ' || left(sqlerrm, 46);
end; $$;

select 'a signed-out reader          | ' || pg_temp.try($$ select set_config('test.uid','',true); select public.add_public_impression('22222222-2222-2222-2222-222222222222','anchor-1','like') $$);
select set_config('test.uid','99999999-9999-9999-9999-999999999999', false);
select 'impressions turned OFF       | ' || pg_temp.try($$ select public.add_public_impression('44444444-4444-4444-4444-444444444444','anchor-1','like') $$);
select 'a made-up impression kind    | ' || pg_temp.try($$ select public.add_public_impression('22222222-2222-2222-2222-222222222222','anchor-1','FLURB') $$);
select 'an empty anchor              | ' || pg_temp.try($$ select public.add_public_impression('22222222-2222-2222-2222-222222222222','   ','like') $$);
select 'a malformed token            | ' || pg_temp.try($$ select public.add_public_impression('not-a-uuid','anchor-1','like') $$);
select 'remove, signed out           | ' || pg_temp.try($$ select set_config('test.uid','',true); select public.remove_public_impression('22222222-2222-2222-2222-222222222222','anchor-1','like') $$);
select set_config('test.uid','99999999-9999-9999-9999-999999999999', false);

-- a legitimate mark must still work, and must be clamped
delete from public.story_impressions;
select 'a legitimate mark            | ' || pg_temp.try($$ select public.add_public_impression('22222222-2222-2222-2222-222222222222', repeat('x', 3000), 'like') $$);
select 'anchor stored, length        | ' || coalesce((select length(anchor_key)::text from public.story_impressions order by created_at desc limit 1), '(none)');
select 'reader recorded              | ' || coalesce((select reader_id::text from public.story_impressions order by created_at desc limit 1), '(null)');
select 'settings read through text   | ' || coalesce((select allow_impressions::text from public.get_public_link_settings('22222222-2222-2222-2222-222222222222')), '(none)');
select 'settings, malformed token    | ' || coalesce((select allow_impressions::text from public.get_public_link_settings('not-a-uuid')), 'NO ROWS (correct)');
select 'remove works                 | ' || pg_temp.try($$ select public.remove_public_impression('22222222-2222-2222-2222-222222222222', repeat('x',3000), 'like') $$);
select 'rows after remove            | ' || (select count(*)::text from public.story_impressions);
