import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.beta_profiles (user_id uuid primary key references auth.users(id) on delete cascade, open boolean not null default true, adult boolean not null default false,
  reads text[] not null default '{}', lengths text[] not null default '{}', capacity int not null default 2, wont text, about text, turnaround text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), swap boolean not null default true, volunteer boolean not null default false);
create table public.beta_links (id uuid, a uuid, b uuid, status text, requested_by uuid, kind text, reader uuid, created_at timestamptz default now());
create function public._beta_me() returns uuid language plpgsql stable as $$ begin if auth.uid() is null then raise exception 'sign in'; end if; return auth.uid(); end $$;
create function public._beta_active(u uuid) returns int language sql stable as $$ select 0 $$;
create function public._beta_name(u uuid) returns text language sql stable as $$ select coalesce((select email from auth.users where id = u), 'A writer') $$;
create function public._beta_opted(u uuid) returns boolean language sql stable as $$ select exists (select 1 from public.beta_profiles p where p.user_id = u and p.adult) $$;
create function public._blocked_either(x uuid, y uuid) returns boolean language sql stable as $$ select false $$;
-- the v.836 forms this migration replaces
create function public.beta_profile_set(a_reads text[], a_lengths text[], a_capacity int, a_wont text, a_about text, a_turnaround text, a_open boolean, a_adult boolean, a_swap boolean default true, a_volunteer boolean default false) returns text language sql as $$ select 'old' $$;
create function public.beta_directory(a_read text default null) returns table(user_id uuid) language sql as $$ select null::uuid where false $$;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a', 'ana'), ('00000000-0000-0000-0000-00000000000b', 'ben'), ('00000000-0000-0000-0000-00000000000c', 'cy');
insert into public.beta_profiles (user_id, adult, swap, volunteer) values ('00000000-0000-0000-0000-00000000000c', true, false, false);
`);
const mig = fs.readFileSync('/home/claude/beta_reader_signup_migration_21.sql', 'utf8');
await db.exec(mig); await db.exec(mig);   // twice: safe to re-run
ok(true, 'the migration runs, and runs again over itself');
const as = async (u) => db.exec(`select set_config('request.jwt.claim.sub', '${u}', false)`);
const one = async (q, p) => (await db.query(q, p)).rows[0];
const A = '00000000-0000-0000-0000-00000000000a', Bn = '00000000-0000-0000-0000-00000000000b', C = '00000000-0000-0000-0000-00000000000c';
await as(A);
let r = await one(`select public.beta_profile_set('{Fantasy,Horror}', '{short,novel}', 2, null, 'reads at night', 'two weeks', true, true, false, true, '{section,full,bogus}', '{reader,line,nonsense}') as v`);
let p = (await one(`select public.beta_profile_get() as v`)).v;
ok(r.v === 'ok' && JSON.stringify(p.portions) === '["full","section"]' && JSON.stringify(p.feedback) === '["line","reader"]', 'a reader\'s portions and feedback are saved, unknown values dropped ' + JSON.stringify([p.portions, p.feedback]));
r = await one(`select public.beta_profile_set('{Fantasy}', '{short}', 3, null, 'x', 'a month', true, true, false, true) as v`);
p = (await one(`select public.beta_profile_get() as v`)).v;
ok(r.v === 'ok' && p.capacity === 3 && JSON.stringify(p.portions) === '["full","section"]' && JSON.stringify(p.feedback) === '["line","reader"]', 'an older app (ten arguments) saves the rest and leaves the two new answers as they were');
r = await one(`select public.beta_profile_set('{Fantasy}', '{short}', 3, null, 'x', 'a month', true, true, false, true, '{}', '{}') as v`);
p = (await one(`select public.beta_profile_get() as v`)).v;
ok(JSON.stringify(p.portions) === '[]' && JSON.stringify(p.feedback) === '[]', 'an empty answer clears them');
await db.query(`select public.beta_profile_set('{Fantasy}', '{short}', 2, null, 'x', 'a month', true, true, false, true, '{section}', '{story}')`);
r = await one(`select public.beta_profile_set('{}', '{}', 2, null, null, null, true, false) as v`);
ok(r.v === 'adult', 'the 18+ box is still required');
await as(Bn);
let threw = ''; try { await db.query(`select * from public.beta_directory(null)`); } catch (e){ threw = String(e.message); }
ok(/opt_in/.test(threw), 'someone who has not opted in still cannot see the directory');
await db.query(`select public.beta_profile_set('{Mystery}', '{novel}', 1, null, null, null, true, true, true, false)`);
let d = (await db.query(`select * from public.beta_directory(null)`)).rows;
ok(d.length === 1 && d[0].name === 'ana' && JSON.stringify(d[0].portions) === '["section"]' && JSON.stringify(d[0].feedback) === '["story"]' && d[0].volunteer === true,
  'the directory lists the volunteer with her portions and feedback, and not the invited reader who stayed private ' + JSON.stringify(d.map(x => [x.name, x.portions, x.feedback])));
d = (await db.query(`select * from public.beta_directory('fantasy')`)).rows;
ok(d.length === 1, 'the genre filter still works');
const g = (await db.query(`select has_function_privilege('authenticated', 'public.beta_profile_set(text[], text[], int, text, text, text, boolean, boolean, boolean, boolean, text[], text[])', 'execute') as a, has_function_privilege('anon', 'public.beta_profile_set(text[], text[], int, text, text, text, boolean, boolean, boolean, boolean, text[], text[])', 'execute') as n, (select count(*) from pg_proc where proname = 'beta_profile_set') as c`)).rows[0];
ok(g.a === true && g.n === false && Number(g.c) === 1, 'signed-in people may call it, visitors may not, and there is one beta_profile_set, not two ' + JSON.stringify(g));
console.log(res.join('\n')); console.log(res.filter(x => x.startsWith('PASS')).length + '/' + res.length);
