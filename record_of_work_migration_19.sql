-- record_of_work_migration_19.sql — Dystoria v.869
-- #81 Record of Work, phase 3: seals and the shareable Record.
-- [Jeremy: "…a way to submit work that comes with proof of originality…"]
--
-- 1 · ledger_seals — when a writing session ends, the app sends the closing hash of that session's record (and a small
--     summary: how much was typed, dictated, pasted, AI-assisted…) and the SERVER stamps it with the server's own clock.
--     A seal can't be backdated or edited afterwards: there is no update or delete policy, and the only way in is
--     seal_session(), which sets the owner and the time itself.
-- 2 · work_records — an issued Record of Work: what the writer chose to share, the fingerprint of the text it describes
--     (never the text itself), and the seals it rests on. Issued through issue_record(), which refuses a Record whose
--     seals aren't on the server. Read by anyone with its code through get_record() (the page at #/proof/<code>);
--     never editable — issuing again makes a new Record and marks the old one superseded.
--
-- Safe to run more than once. Run it in the Supabase SQL editor.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- 1 · seals
create table if not exists public.ledger_seals (
  id         bigint generated always as identity primary key,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  story      text not null,
  ws         text,
  head       text not null check (head ~ '^[0-9a-f]{64}$'),
  n          int  not null default 0,
  words      int  not null default 0,
  summary    jsonb not null default '{}'::jsonb,
  sealed_at  timestamptz not null default now(),
  unique (owner, story, head)
);
alter table public.ledger_seals enable row level security;
drop policy if exists ledger_seals_select_own on public.ledger_seals;
create policy ledger_seals_select_own on public.ledger_seals for select to authenticated using (owner = auth.uid());
revoke all on public.ledger_seals from anon, authenticated;
grant select on public.ledger_seals to authenticated;

create or replace function public.seal_session(p_story text, p_ws text, p_head text, p_n int, p_words int, p_summary jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  t   timestamptz;
begin
  if uid is null then raise exception 'sign in'; end if;
  if coalesce(p_head, '') !~ '^[0-9a-f]{64}$' or length(coalesce(p_story, '')) = 0 or length(p_story) > 120 then
    raise exception 'bad seal';
  end if;
  if pg_column_size(coalesce(p_summary, '{}'::jsonb)) > 4000 then raise exception 'seal too large'; end if;
  if (select count(*) from public.ledger_seals where owner = uid and sealed_at > now() - interval '1 day') >= 1000 then
    raise exception 'rate';
  end if;
  insert into public.ledger_seals (owner, story, ws, head, n, words, summary)
  values (uid, p_story, left(coalesce(p_ws, ''), 60), p_head, greatest(0, coalesce(p_n, 0)), greatest(0, coalesce(p_words, 0)), coalesce(p_summary, '{}'::jsonb))
  on conflict (owner, story, head) do nothing;
  select sealed_at into t from public.ledger_seals where owner = uid and story = p_story and head = p_head;
  return t;
end
$$;
revoke all on function public.seal_session(text, text, text, int, int, jsonb) from public;
grant execute on function public.seal_session(text, text, text, int, int, jsonb) to authenticated;

-- ---------------------------------------------------------------- 2 · records
create table if not exists public.work_records (
  id             text primary key,
  owner          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  story          text not null,
  title          text not null,
  author         text not null,
  payload        jsonb not null,
  text_fp        text not null,
  heads          text[] not null default '{}',
  issued_at      timestamptz not null default now(),
  superseded_by  text
);
create index if not exists work_records_owner_story on public.work_records (owner, story, issued_at desc);
alter table public.work_records enable row level security;
drop policy if exists work_records_select_own on public.work_records;
create policy work_records_select_own on public.work_records for select to authenticated using (owner = auth.uid());
revoke all on public.work_records from anon, authenticated;
grant select on public.work_records to authenticated;

create or replace function public.issue_record(p_story text, p_title text, p_author text, p_payload jsonb, p_text_fp text, p_heads text[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  uid    uuid := auth.uid();
  new_id text;
  sealed int;
  t      timestamptz;
begin
  if uid is null then raise exception 'sign in'; end if;
  if length(coalesce(p_story, '')) = 0 or length(p_story) > 120 then raise exception 'bad story'; end if;
  if coalesce(p_text_fp, '') !~ '^[0-9a-f]{64}$' then raise exception 'bad fingerprint'; end if;
  if pg_column_size(p_payload) > 600000 then raise exception 'record too large'; end if;
  if coalesce(array_length(p_heads, 1), 0) = 0 then raise exception 'unsealed'; end if;
  select count(distinct head) into sealed from public.ledger_seals where owner = uid and story = p_story and head = any(p_heads);
  if sealed <> (select count(distinct h) from unnest(p_heads) h) then raise exception 'unsealed'; end if;
  if (select count(*) from public.work_records where owner = uid and issued_at > now() - interval '1 day') >= 100 then raise exception 'rate'; end if;
  loop
    new_id := lower(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=', 'xyz'));
    exit when not exists (select 1 from public.work_records where id = new_id);
  end loop;
  insert into public.work_records (id, owner, story, title, author, payload, text_fp, heads)
  values (new_id, uid, p_story, left(coalesce(p_title, 'Untitled'), 200), left(coalesce(p_author, ''), 80), p_payload, p_text_fp, p_heads)
  returning issued_at into t;
  update public.work_records set superseded_by = new_id
   where owner = uid and story = p_story and id <> new_id and superseded_by is null;
  return jsonb_build_object('id', new_id, 'issued_at', t);
end
$$;
revoke all on function public.issue_record(text, text, text, jsonb, text, text[]) from public;
grant execute on function public.issue_record(text, text, text, jsonb, text, text[]) to authenticated;

-- anyone with the code can read an issued Record, with its seals and their server times
create or replace function public.get_record(p_id text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select jsonb_build_object(
    'id', r.id, 'title', r.title, 'author', r.author, 'payload', r.payload, 'text_fp', r.text_fp,
    'issued_at', r.issued_at, 'superseded_by', r.superseded_by,
    'seals', coalesce((select jsonb_agg(jsonb_build_object('ws', s.ws, 'head', s.head, 'n', s.n, 'words', s.words, 'sealed_at', s.sealed_at) order by s.sealed_at)
                         from public.ledger_seals s where s.owner = r.owner and s.story = r.story and s.head = any(r.heads)), '[]'::jsonb))
  from public.work_records r where r.id = lower(p_id)
$$;
revoke all on function public.get_record(text) from public;
grant execute on function public.get_record(text) to anon, authenticated;

-- Check: select proname, prosecdef from pg_proc where proname in ('seal_session','issue_record','get_record');
