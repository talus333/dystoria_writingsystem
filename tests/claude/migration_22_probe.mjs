import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table public.profiles (id uuid primary key, username text, email text);
create table public.stories (id uuid primary key default gen_random_uuid(), owner uuid);
create table public.story_comments (id uuid primary key default gen_random_uuid(), story_id uuid, author_id uuid, body text);
alter table public.story_comments enable row level security;
create table public.partnerships (a uuid, b uuid, status text default 'accepted', primary key (a, b));
create table public.blocks (blocker uuid, blocked uuid);
create function public._blocked_either(x uuid, y uuid) returns boolean language sql stable as $$ select exists (select 1 from public.blocks where (blocker = x and blocked = y) or (blocker = y and blocked = x)) $$;
create function public._are_partners(x uuid, y uuid) returns boolean language sql stable as $$ select exists (select 1 from public.partnerships where a = least(x, y) and b = greatest(x, y) and status = 'accepted') $$;
`);
const U = n => '00000000-0000-0000-0000-00000000000' + n;
const A = U('a'), Bn = U('b'), C = U('c'), D = U('d'), E = U('e');
for (const [id, n] of [[A, 'ana'], [Bn, 'ben'], [C, 'cy'], [D, 'dee'], [E, 'eve']]) await db.query(`insert into auth.users values ($1, $2)`, [id, n + '@x.io']), await db.query(`insert into public.profiles values ($1, $2, $3)`, [id, n, n + '@x.io']);
const m17 = fs.readFileSync('/home/claude/beta_exchange_migration_17.sql', 'utf8');
let e17 = ''; try { await db.exec(m17); } catch (e){ e17 = String(e.message); }
ok(!e17, 'migration 17 runs on the stand-in database ' + e17);
await db.exec(fs.readFileSync('/home/claude/beta_reader_signup_migration_21.sql', 'utf8'));
const mig = fs.readFileSync('/home/claude/beta_friend_ask_migration_22.sql', 'utf8');
await db.exec(mig); await db.exec(mig);
ok(true, 'migration 22 runs, and runs again over itself');
const as = async (u) => db.exec(`select set_config('request.jwt.claim.sub', '${u}', false)`);
const v = async (q, p) => Object.values((await db.query(q, p)).rows[0])[0];
const friends = async (x, y) => db.query(`insert into public.partnerships values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid), 'accepted') on conflict do nothing`, [x, y]);
await friends(A, Bn); await friends(A, C); await friends(A, E);
// ana is not in the exchange yet
await as(A);
ok(await v(`select public.beta_ask_friend($1, 'please')`, [Bn]) === 'opt_in', 'asking needs you to be in the exchange yourself');
await db.query(`select public.beta_profile_set('{Fantasy}', '{novel}', 2, null, null, null, true, true, false, false)`);
ok(await v(`select public.beta_ask_friend($1, null)`, [A]) === 'self', 'you cannot ask yourself');
ok(await v(`select public.beta_ask_friend($1, null)`, [D]) === 'not_friend', 'someone who is not your friend cannot be asked this way');
ok(await v(`select public.beta_request($1, null, 'read')`, [Bn]) === 'not_available', 'the old ask still refuses a friend who is not in the exchange');
ok(await v(`select public.beta_ask_friend($1, 'my novel, would you?')`, [Bn]) === 'ok', 'a friend who is not in the exchange can be asked');
ok(await v(`select public.beta_ask_friend($1, null)`, [Bn]) === 'already', 'and not asked twice');
let n = (await db.query(`select * from public.notice_batch_beta()`)).rows;
ok(n.length === 1 && n[0].kind === 'ask' && n[0].title === 'read' && n[0].email === 'ben@x.io' && n[0].note === 'my novel, would you?', 'the ask is emailed to the friend as an ask to read ' + JSON.stringify(n.map(x => [x.kind, x.title, x.email])));
// ben: no profile, sees the ask, must tick 18+
await as(Bn);
let g = (await db.query(`select * from public.beta_group()`)).rows;
ok(g.length === 1 && g[0].status === 'pending' && g[0].requested_by_me === false && g[0].rel === 'i_read_for' && g[0].name === 'ana', 'the friend sees the ask with no reader profile ' + JSON.stringify(g.map(x => [x.name, x.status, x.rel])));
ok(await v(`select public.beta_respond($1, true)`, [A]) === 'adult', 'saying yes needs the 18+ box');
ok(await v(`select public.beta_respond($1, true, true)`, [A]) === 'ok', 'with it, the friend becomes a reader');
let p = await v(`select public.beta_profile_get()`);
ok(p && p.adult === true && p.swap === false && p.volunteer === false, 'and gets a private profile: not swapping, not listed ' + JSON.stringify(p && [p.adult, p.swap, p.volunteer]));
await as(D); await db.query(`select public.beta_profile_set('{}', '{}', 2, null, null, null, true, true, true, true)`);
let d = (await db.query(`select name from public.beta_directory(null)`)).rows.map(x => x.name);
ok(d.indexOf('ben') < 0 && d.indexOf('ana') < 0, 'neither shows in the directory to a stranger ' + JSON.stringify(d));
await as(A);
g = (await db.query(`select * from public.beta_group()`)).rows;
ok(g.length === 1 && g[0].status === 'accepted' && g[0].rel === 'reads_for_me', 'ana now has ben reading for her');
ok(await v(`select public.beta_ask_friend($1, null)`, [Bn]) === 'already', 'asking someone who already reads for you says so');
// cy says "not now": quiet
ok(await v(`select public.beta_ask_friend($1, null)`, [C]) === 'ok', 'ana asks cy');
await as(C);
ok(await v(`select public.beta_respond($1, false)`, [A]) === 'ok', 'cy says not now');
ok((await db.query(`select * from public.beta_group()`)).rows.length === 0, 'the ask is gone from cy\'s side');
ok(await v(`select public.beta_profile_get()`) === null, 'and cy has no reader profile');
await as(A);
g = (await db.query(`select * from public.beta_group()`)).rows.filter(x => x.name === 'cy');
ok(g.length === 1 && g[0].status === 'pending' && g[0].requested_by_me === true, 'ana still sees it as waiting');
ok(await v(`select public.beta_ask_friend($1, null)`, [C]) === 'already', 'and cannot ask cy again inside 21 days');
n = (await db.query(`select * from public.notice_batch_beta()`)).rows.filter(x => x.email === 'cy@x.io');
ok(n.length === 0, 'an ask that was put away is not emailed');
await db.query(`update public.beta_links set created_at = now() - interval '22 days' where requested_by = $1 and dismissed_at is not null`, [A]);
ok(await v(`select public.beta_ask_friend($1, null)`, [C]) === 'ok', 'after 21 days ana may ask again');
await as(C);
ok((await db.query(`select * from public.beta_group()`)).rows.length === 1, 'and the new ask shows to cy');
ok(await v(`select public.beta_respond($1, true, true)`, [A]) === 'ok', 'cy can say yes this time');
// a swap ask cannot bring an outsider in; a normal decline still deletes
await as(D);
await friends(D, E);
await db.query(`insert into public.beta_links (a, b, status, requested_by, kind) values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid), 'pending', $1, 'swap')`, [D, E]);
await as(E);
ok(await v(`select public.beta_respond($1, true, true)`, [D]) === 'not_found', 'only an ask to read can bring someone in, not a swap');
ok(await v(`select public.beta_respond($1, false)`, [D]) === 'ok' && Number(await v(`select count(*) from public.beta_links where requested_by = $1`, [D])) === 0, 'an ordinary decline still removes the ask');
// blocked
await db.query(`insert into public.blocks values ($1, $2)`, [E, A]);
await as(A);
ok(await v(`select public.beta_ask_friend($1, null)`, [E]) === 'blocked', 'someone who blocked you cannot be asked');
// they had offered first
await db.query(`delete from public.blocks`); await as(E);
await db.query(`select public.beta_profile_set('{}', '{}', 2, null, null, null, true, true, false, true)`);
ok(await v(`select public.beta_request($1, null, 'offer')`, [A]) === 'ok', 'eve offers to read for ana');
await as(A);
ok(await v(`select public.beta_ask_friend($1, null)`, [E]) === 'accepted', 'ana asking eve then simply accepts the offer');
const pr = (await db.query(`select has_function_privilege('authenticated', 'public.beta_ask_friend(uuid, text)', 'execute') as a, has_function_privilege('anon', 'public.beta_ask_friend(uuid, text)', 'execute') as n,
  has_function_privilege('authenticated', 'public.beta_respond(uuid, boolean, boolean)', 'execute') as r, has_function_privilege('anon', 'public.beta_respond(uuid, boolean, boolean)', 'execute') as rn,
  has_function_privilege('authenticated', 'public.notice_batch_beta()', 'execute') as nb, (select count(*) from pg_proc where proname = 'beta_respond') as c`)).rows[0];
ok(pr.a === true && pr.n === false && pr.r === true && pr.rn === false && pr.nb === false && Number(pr.c) === 1, 'signed-in people may ask and answer, visitors may not, the email batch stays private, one beta_respond ' + JSON.stringify(pr));
console.log(res.join('\n')); console.log(res.filter(x => x.startsWith('PASS')).length + '/' + res.length);
