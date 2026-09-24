-- ============================================================================
--  Dystoria · migration 10 — the beta-reader loop (app v.809, roadmap #14)
--  Written 2026-09-24. Run AFTER migrations 7, 8 and 9 (all applied).
--  Run it once in the Supabase SQL editor. Re-runnable: ADD COLUMN IF NOT EXISTS
--  and CREATE OR REPLACE only — no drops, no data touched.
--
--  WHAT IT ADDS
--   1 · story_comments.replies  (jsonb, default [])  — a thread under each comment:
--         [{ by: 'author'|'reader', name, body, at }]
--   2 · story_comments.author_account (boolean)      — true when the comment was
--         posted from a real (non-anonymous) account, so the author can tell a
--         named guest from a signed-in reader.
--   3 · add_comment_reply(cid, a_body, a_name)       — the ONLY way a reply is written.
--         The story's owner or a collaborator replies as 'author'; the reader who
--         wrote the comment (their own session, auth.uid() = author_id, link still
--         live) replies as 'reader'. Nobody else. 2,000 characters, 50 per thread,
--         no two from the same side within 3 seconds.
--   4 · add_public_comment_v — THE SPAM GUARD. What it had: 10 a minute per author.
--         What that missed: with no session at all auth.uid() is NULL, and
--         `author_id = NULL` matches nothing, so a reader with anonymous sign-in
--         blocked had NO limit. Now, as well:
--           · 60 comments per story per 10 minutes, whoever sends them;
--           · 1,000 per story per day;
--           · the name stripped of control characters and clamped to 40.
--   5 · add_public_comment (the old, pre-version form) becomes a one-line shim over
--         add_public_comment_v, exactly as migration 9 did for the impression RPCs —
--         one implementation of every rule. (It also means the old form now honours
--         the author's "comments off" switch, which it never did.)
--
--  The app works before this runs: comments post as before, resolve and the
--  unread count work (they live in the story). Replies say which file to run.
-- ============================================================================

-- 1 · 2 --------------------------------------------------------------------
alter table public.story_comments add column if not exists replies        jsonb   not null default '[]'::jsonb;
alter table public.story_comments add column if not exists author_account boolean not null default false;

-- 4 · the guarded post ------------------------------------------------------
create or replace function public.add_public_comment_v(
  tok uuid, a_name text, a_anchor text, a_section int, a_body text, a_version text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; allowed boolean; nid uuid; recent int; flood int; daily int; acct boolean; nm text;
begin
  select id, allow_comments into sid, allowed
    from public.stories where public_token = tok and is_public = true limit 1;
  if sid is null then raise exception 'story not found or not public'; end if;
  if allowed is not true then raise exception 'comments are turned off for this link'; end if;
  if a_body is null or length(trim(a_body)) = 0 then raise exception 'empty comment'; end if;

  -- per reader: 10 a minute (only meaningful when there is a session)
  if auth.uid() is not null then
    select count(*) into recent from public.story_comments
      where author_id = auth.uid() and created_at > now() - interval '60 seconds';
    if recent >= 10 then raise exception 'slow down'; end if;
  end if;
  -- per link: holds even with no session at all
  select count(*) into flood from public.story_comments
    where story_id = sid and created_at > now() - interval '10 minutes';
  if flood >= 60 then raise exception 'this story is getting a lot of comments right now — try again in a few minutes'; end if;
  select count(*) into daily from public.story_comments
    where story_id = sid and created_at > now() - interval '1 day';
  if daily >= 1000 then raise exception 'this story has reached today''s comment limit'; end if;

  acct := auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = false;
  nm := left(coalesce(nullif(trim(regexp_replace(coalesce(a_name, ''), '[[:cntrl:]]', '', 'g')), ''), 'Guest'), 40);

  insert into public.story_comments
      (story_id, author_id, author_name, anchor_key, section_idx, body, version_id, author_account)
    values (sid, auth.uid(), nm, left(a_anchor, 2000), coalesce(a_section, 0), left(trim(a_body), 4000), nullif(a_version, ''), acct)
    returning id into nid;
  return nid;
end; $$;
grant execute on function public.add_public_comment_v(uuid, text, text, int, text, text) to anon, authenticated;

-- 5 · the old form, a shim ----------------------------------------------------
create or replace function public.add_public_comment(
  tok uuid, a_name text, a_anchor text, a_section int, a_body text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return public.add_public_comment_v(tok, a_name, a_anchor, a_section, a_body, null);
end; $$;
comment on function public.add_public_comment(uuid, text, text, int, text) is
  'Shim (migration 10): delegates to add_public_comment_v so there is one implementation of every guard.';

-- 3 · replies ------------------------------------------------------------------
create or replace function public.add_comment_reply(cid uuid, a_body text, a_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_who text; v_name text; v_body text; n int; lastby text; lastat timestamptz; outv jsonb;
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  select id, story_id, author_id, coalesce(replies, '[]'::jsonb) as replies into r
    from public.story_comments where id = cid;
  if r.id is null then raise exception 'comment not found'; end if;

  if public.is_story_owner(r.story_id) or public.is_collaborator(r.story_id) then
    v_who := 'author';
  elsif r.author_id is not null and r.author_id = auth.uid() and public.story_is_public(r.story_id) then
    v_who := 'reader';
  else
    raise exception 'not allowed';
  end if;

  v_body := left(trim(coalesce(a_body, '')), 2000);
  if length(v_body) = 0 then raise exception 'empty reply'; end if;
  n := jsonb_array_length(r.replies);
  if n >= 50 then raise exception 'this thread is full'; end if;
  if n > 0 then
    lastby := r.replies -> (n - 1) ->> 'by';
    begin lastat := (r.replies -> (n - 1) ->> 'at')::timestamptz; exception when others then lastat := null; end;
    if lastby = v_who and lastat is not null and lastat > now() - interval '3 seconds' then raise exception 'slow down'; end if;
  end if;

  v_name := left(coalesce(nullif(trim(regexp_replace(coalesce(a_name, ''), '[[:cntrl:]]', '', 'g')), ''),
                      case when v_who = 'author' then 'Author' else 'Reader' end), 40);

  update public.story_comments
     set replies = r.replies || jsonb_build_array(jsonb_build_object(
           'by', v_who, 'name', v_name, 'body', v_body,
           'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
   where id = cid
   returning replies into outv;
  return outv;
end; $$;
revoke all on function public.add_comment_reply(uuid, text, text) from public;
grant execute on function public.add_comment_reply(uuid, text, text) to authenticated;
comment on function public.add_comment_reply(uuid, text, text) is
  'Migration 10: the one write path for a reply — the owner/collaborators as author, the comment''s own reader as reader.';

-- ============================================================================
--  Verify (read-only):
--    select column_name from information_schema.columns
--      where table_name = 'story_comments' and column_name in ('replies','author_account');   -- 2 rows
--    select proname, pg_get_function_identity_arguments(oid) from pg_proc
--      where proname in ('add_comment_reply','add_public_comment','add_public_comment_v');     -- 3 rows
--  Then, in the app: reply to a reader comment from Reader feedback; open the link as
--  that reader (same browser session that wrote it) and the reply is under the comment.
-- ============================================================================
