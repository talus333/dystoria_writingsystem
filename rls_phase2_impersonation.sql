-- =====================================================================================
--  Dystoria — RLS Phase 2: impersonation tests, inside a transaction that is ROLLED BACK
--  2026-09-03. Written against the schema in the repo's own migrations, not from memory:
--    stories(id, owner, is_public, public_token, planning_baton)   profiles(id, email)
--    story_collaborators(story_id, user_id, email)   subscriptions(user_id, plan, status)
--    ai_usage(user_id, …)   story_comments(story_id, author_id, …)
--    story_impressions(story_id, reader_id, …)
--  Helpers: public.is_collaborator(story_id), public.is_story_owner(story_id)
--
--  WHAT THIS ANSWERS. Phase 1 proved the policies are CONFIGURED — RLS on for all eight tables,
--  no policy whose condition is `true`, subscriptions write-locked. It did not prove they BEHAVE.
--  A policy can be present, non-permissive, and still let the wrong person through, because what
--  it does depends on auth.uid() at run time. This impersonates three real users and tries it.
--
--  HOW TO RUN. Supabase dashboard → SQL Editor → paste the whole file → Run. Read the NOTICE
--  output. The last statement is ROLLBACK.
--
--  EVERY WRITE IS UNDONE THE MOMENT IT IS MEASURED, not merely at the end. The first draft of this
--  script relied on the closing ROLLBACK, and it hid a real failure: when a broken policy let the
--  collaborator delete the story, the row was gone by the time the stranger tried to read it, and
--  the stranger's probe passed for the worst possible reason. Rehearsed against a fixture with
--  three deliberately broken policies, this version reports all three.
--
--  READING THE RESULT. Every line is PASS or FAIL. A FAIL is a finding — do not explain it away
--  from the policy text, because the policy text is what Phase 1 already checked.
-- =====================================================================================

begin;

do $outer$
declare
  -- The only probe that would remove a row if a policy were correct. Everything else is an attack
  -- that is supposed to affect nothing. Off by default; turn it on to prove the owner's own
  -- delete works (it is undone immediately either way).
  TEST_DESTRUCTIVE constant boolean := false;

  v_owner       uuid;
  v_story       uuid;
  v_collab      uuid;
  v_stranger    uuid;
  v_other_story uuid;
  n             bigint;
  pass_n        int := 0;
  fail_n        int := 0;
begin
  -- ---------------------------------------------------------------- pick the cast ------------
  select s.owner, s.id into v_owner, v_story
  from public.stories s join public.story_collaborators c on c.story_id = s.id
  limit 1;
  if v_owner is null then
    select s.owner, s.id into v_owner, v_story from public.stories s limit 1;
  end if;
  if v_owner is null then
    raise notice 'SKIP  — no stories in this database, so there is nothing to impersonate against.';
    return;
  end if;

  select c.user_id into v_collab from public.story_collaborators c
   where c.story_id = v_story and c.user_id <> v_owner limit 1;

  select u.id into v_stranger from auth.users u
   where u.id <> v_owner and (v_collab is null or u.id <> v_collab)
     and not exists (select 1 from public.story_collaborators c
                      where c.story_id = v_story and c.user_id = u.id)
   limit 1;

  select s.id into v_other_story from public.stories s
   where s.owner = v_owner and s.id <> v_story limit 1;

  raise notice '--------------------------------------------------------------------';
  raise notice 'owner        = %', v_owner;
  raise notice 'story        = %', v_story;
  raise notice 'collaborator = %', coalesce(v_collab::text,   '(none — those checks are skipped)');
  raise notice 'stranger     = %', coalesce(v_stranger::text, '(none — those checks are skipped)');
  raise notice 'destructive  = %', TEST_DESTRUCTIVE;
  raise notice '--------------------------------------------------------------------';

  -- =========================================================== THE OWNER =====================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.stories where id = v_story;
  if n = 1 then raise notice 'PASS  owner sees their own story'; pass_n := pass_n + 1;
  else raise notice 'FAIL  owner sees their own story (got %, expected 1)', n; fail_n := fail_n + 1; end if;

  -- owner may edit  ·  n = -1 means the statement was refused outright
  begin
    update public.stories set planning_baton = planning_baton where id = v_story;
    get diagnostics n = row_count;
    raise exception 'undo' using errcode = 'UT001';
  exception
    when sqlstate 'UT001' then null;
    when insufficient_privilege or check_violation then n := -1;
  end;
  if n = 1 then raise notice 'PASS  owner can update their own story'; pass_n := pass_n + 1;
  else raise notice 'FAIL  owner can update their own story (affected %)', n; fail_n := fail_n + 1; end if;

  -- the WITH CHECK is what stops a row being edited into someone else's name
  if v_stranger is not null then
    begin
      update public.stories set owner = v_stranger where id = v_story;
      get diagnostics n = row_count;
      raise exception 'undo' using errcode = 'UT001';
    exception
      when sqlstate 'UT001' then null;
      when insufficient_privilege or check_violation then n := -1;
    end;
    if n <= 0 then raise notice 'PASS  owner cannot hand their story to someone else (%)', case when n < 0 then 'refused' else '0 rows' end; pass_n := pass_n + 1;
    else raise notice 'FAIL  owner REASSIGNED ownership — with_check is not holding (% rows)', n; fail_n := fail_n + 1; end if;
  end if;

  reset role;

  -- =========================================================== THE COLLABORATOR ==============
  if v_collab is not null then
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_collab, 'role', 'authenticated')::text, true);
    set local role authenticated;

    select count(*) into n from public.stories where id = v_story;
    if n = 1 then raise notice 'PASS  collaborator sees the shared story'; pass_n := pass_n + 1;
    else raise notice 'FAIL  collaborator sees the shared story (got %)', n; fail_n := fail_n + 1; end if;

    if v_other_story is not null then
      select count(*) into n from public.stories where id = v_other_story;
      if n = 0 then raise notice 'PASS  collaborator does NOT see the owner''s other story'; pass_n := pass_n + 1;
      else raise notice 'FAIL  collaborator reads a story never shared with them (% rows)', n; fail_n := fail_n + 1; end if;
    else
      raise notice 'SKIP  the owner has only one story, so "another story" cannot be tested';
    end if;

    begin
      delete from public.stories where id = v_story;
      get diagnostics n = row_count;
      raise exception 'undo' using errcode = 'UT001';
    exception
      when sqlstate 'UT001' then null;
      when insufficient_privilege then n := -1;
    end;
    if n <= 0 then raise notice 'PASS  collaborator cannot delete the story (%)', case when n < 0 then 'refused' else '0 rows' end; pass_n := pass_n + 1;
    else raise notice 'FAIL  collaborator DELETED the story (% rows) — undone, but the policy is wrong', n; fail_n := fail_n + 1; end if;

    select count(*) into n from public.profiles;
    if n <= 1 then raise notice 'PASS  collaborator sees at most their own profile row (%)', n; pass_n := pass_n + 1;
    else raise notice 'FAIL  collaborator can read % profile rows — that is the email list', n; fail_n := fail_n + 1; end if;

    reset role;
  else
    raise notice 'SKIP  no collaborator on this story — share one and re-run for the middle tier';
  end if;

  -- =========================================================== THE STRANGER ==================
  if v_stranger is not null then
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    set local role authenticated;

    select count(*) into n from public.stories where id = v_story;
    if n = 0 then raise notice 'PASS  stranger cannot read the story'; pass_n := pass_n + 1;
    else raise notice 'FAIL  stranger can read the story (% rows)', n; fail_n := fail_n + 1; end if;

    begin
      update public.stories set planning_baton = planning_baton where id = v_story;
      get diagnostics n = row_count;
      raise exception 'undo' using errcode = 'UT001';
    exception
      when sqlstate 'UT001' then null;
      when insufficient_privilege or check_violation then n := -1;
    end;
    if n <= 0 then raise notice 'PASS  stranger cannot update the story (%)', case when n < 0 then 'refused' else '0 rows' end; pass_n := pass_n + 1;
    else raise notice 'FAIL  stranger UPDATED the story (% rows)', n; fail_n := fail_n + 1; end if;

    begin
      delete from public.stories where id = v_story;
      get diagnostics n = row_count;
      raise exception 'undo' using errcode = 'UT001';
    exception
      when sqlstate 'UT001' then null;
      when insufficient_privilege then n := -1;
    end;
    if n <= 0 then raise notice 'PASS  stranger cannot delete the story (%)', case when n < 0 then 'refused' else '0 rows' end; pass_n := pass_n + 1;
    else raise notice 'FAIL  stranger DELETED the story (% rows)', n; fail_n := fail_n + 1; end if;

    select count(*) into n from public.story_collaborators where story_id = v_story;
    if n = 0 then raise notice 'PASS  stranger cannot read the collaborator list'; pass_n := pass_n + 1;
    else raise notice 'FAIL  stranger reads % collaborator rows', n; fail_n := fail_n + 1; end if;

    select count(*) into n from public.ai_usage where user_id = v_owner;
    if n = 0 then raise notice 'PASS  stranger cannot read another user''s ai_usage'; pass_n := pass_n + 1;
    else raise notice 'FAIL  stranger reads % ai_usage rows belonging to the owner', n; fail_n := fail_n + 1; end if;

    select count(*) into n from public.story_impressions where story_id = v_story;
    if n = 0 then raise notice 'PASS  stranger cannot read impressions on a story they cannot see'; pass_n := pass_n + 1;
    else raise notice 'NOTE  stranger sees % impression rows — confirm this is the public-reader path, not a leak', n; end if;

    select count(*) into n from public.story_comments where story_id = v_story;
    if n = 0 then raise notice 'PASS  stranger cannot read comments on a story they cannot see'; pass_n := pass_n + 1;
    else raise notice 'NOTE  stranger sees % comment rows — confirm this is the beta-reader path, not a leak', n; end if;

    select count(*) into n from public.profiles where id <> v_stranger;
    if n = 0 then raise notice 'PASS  stranger cannot read other profiles'; pass_n := pass_n + 1;
    else raise notice 'FAIL  stranger reads % other profile rows — that is the email list', n; fail_n := fail_n + 1; end if;

    -- ---- THE ONE THAT MATTERS MOST: nobody may put themselves on the paid plan ----
    begin
      insert into public.subscriptions (user_id, plan, status) values (v_stranger, 'pro', 'active');
      get diagnostics n = row_count;
      raise exception 'undo' using errcode = 'UT001';
    exception
      when sqlstate 'UT001' then null;
      when insufficient_privilege or check_violation or unique_violation then n := -1;
    end;
    if n <= 0 then raise notice 'PASS  stranger cannot INSERT a subscription (%)', case when n < 0 then 'refused' else '0 rows' end; pass_n := pass_n + 1;
    else raise notice 'FAIL  stranger INSERTED a pro subscription — THE PAID GATE IS OPEN'; fail_n := fail_n + 1; end if;

    begin
      update public.subscriptions set plan = 'pro', status = 'active' where user_id = v_stranger;
      get diagnostics n = row_count;
      raise exception 'undo' using errcode = 'UT001';
    exception
      when sqlstate 'UT001' then null;
      when insufficient_privilege or check_violation then n := -1;
    end;
    if n <= 0 then raise notice 'PASS  stranger cannot UPGRADE THEMSELVES (%)', case when n < 0 then 'refused' else '0 rows' end; pass_n := pass_n + 1;
    else raise notice 'FAIL  stranger UPGRADED THEMSELVES to pro (% rows) — THE PAID GATE IS OPEN', n; fail_n := fail_n + 1; end if;

    begin
      update public.subscriptions set plan = 'pro' where user_id = v_owner;
      get diagnostics n = row_count;
      raise exception 'undo' using errcode = 'UT001';
    exception
      when sqlstate 'UT001' then null;
      when insufficient_privilege or check_violation then n := -1;
    end;
    if n <= 0 then raise notice 'PASS  stranger cannot touch someone else''s subscription (%)', case when n < 0 then 'refused' else '0 rows' end; pass_n := pass_n + 1;
    else raise notice 'FAIL  stranger changed ANOTHER user''s subscription (% rows)', n; fail_n := fail_n + 1; end if;

    begin
      delete from public.subscriptions where user_id = v_stranger;
      get diagnostics n = row_count;
      raise exception 'undo' using errcode = 'UT001';
    exception
      when sqlstate 'UT001' then null;
      when insufficient_privilege then n := -1;
    end;
    if n <= 0 then raise notice 'PASS  stranger cannot DELETE their subscription row (%)', case when n < 0 then 'refused' else '0 rows' end; pass_n := pass_n + 1;
    else raise notice 'FAIL  stranger DELETED their subscription row (% rows)', n; fail_n := fail_n + 1; end if;

    reset role;
  else
    raise notice 'SKIP  no third user in auth.users — sign up a throwaway account and re-run';
  end if;

  -- =========================================================== owner, destructive ============
  if TEST_DESTRUCTIVE then
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      delete from public.stories where id = v_story;
      get diagnostics n = row_count;
      raise exception 'undo' using errcode = 'UT001';
    exception
      when sqlstate 'UT001' then null;
      when insufficient_privilege then n := -1;
    end;
    if n = 1 then raise notice 'PASS  owner can delete their own story (undone)'; pass_n := pass_n + 1;
    else raise notice 'FAIL  owner cannot delete their own story (%)', n; fail_n := fail_n + 1; end if;
    reset role;
  else
    raise notice 'SKIP  owner-can-delete probe (set TEST_DESTRUCTIVE := true to include it)';
  end if;

  raise notice '--------------------------------------------------------------------';
  raise notice 'RESULT   % passed, % failed', pass_n, fail_n;
  if fail_n > 0 then
    raise notice 'Phase 2 has NOT passed. Each FAIL is a policy behaving differently from how it reads.';
  else
    raise notice 'Phase 2 passed. Nothing was kept — every write was undone, and the next statement is ROLLBACK.';
  end if;
  raise notice '--------------------------------------------------------------------';
end
$outer$;

rollback;
