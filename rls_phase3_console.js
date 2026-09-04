/* =====================================================================================
   Dystoria — RLS Phase 3, the browser-console version.
   2026-09-03. Same probes as rls_phase3_postgrest.sh, with nothing to copy around.

   HOW TO RUN
     1. Open Dystoria in a browser and SIGN IN.
     2. Open the developer console (⌥⌘I on a Mac, then the Console tab).
     3. Paste this whole file and press Enter.
   It finds the project URL, the publishable key and your session token by itself, because the
   page already has all three — which is the point of the test: everything used here is
   available to anyone who loads your site.

   OPTIONAL, and it is the sharpest probe: put a story UUID belonging to a DIFFERENT account
   in OTHER_STORY_ID below. Without it the cross-account read/patch/delete cannot be tested.

   WHAT IT WRITES: nothing that is meant to succeed. Every write below is an attack that must be
   refused; if one succeeds, that is the finding, and it will say so in red.

   A network failure is reported as NOTE, never PASS. A probe that could not reach the server
   has not proved that the server refuses anything.
   ===================================================================================== */
(async () => {
  const OTHER_STORY_ID = '';          // ← paste another account's story UUID here (optional)

  const CFG = (globalThis.__RLS_CFG) || {};
  const URL_ = CFG.url || (typeof SUPA_URL !== 'undefined' ? SUPA_URL : null);
  const ANON = CFG.key || (typeof SUPA_KEY !== 'undefined' ? SUPA_KEY : null);
  if (!URL_ || !ANON){
    console.error('Could not find SUPA_URL / SUPA_KEY on this page. Are you on the Dystoria app?');
    return;
  }
  let JWT = CFG.jwt || null;
  if (!JWT){
    try { JWT = (await supa.auth.getSession()).data.session.access_token; } catch (e){ JWT = null; }
  }
  const REST = URL_.replace(/\/+$/, '') + '/rest/v1';

  const rows = [];
  let pass = 0, fail = 0, note = 0;
  const P = (m) => { rows.push({ '': 'PASS', check: m }); pass++; };
  const F = (m) => { rows.push({ '': 'FAIL', check: m }); fail++; };
  const N = (m) => { rows.push({ '': 'note', check: m }); note++; };

  /* one request; `code: 0` means it never reached the server */
  async function req(method, path, token, body){
    const h = { apikey: ANON, Authorization: 'Bearer ' + token };
    /* `Prefer: return=representation` goes on EVERY write, not only the ones with a body.
       PostgREST answers a DELETE with 204 No Content whether it removed nothing or removed
       everything, so without this header "anon cannot delete stories (204)" is a sentence about
       the status line and not about the database. A probe that cannot tell those two apart is
       worse than no probe, because it reports a pass. */
    if (method !== 'GET' && method !== 'HEAD') h['Prefer'] = 'return=representation';
    if (body) h['Content-Type'] = 'application/json';
    try {
      const r = await fetch(REST + '/' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await r.json(); } catch (e){ j = null; }
      return { code: r.status, n: Array.isArray(j) ? j.length : 0, body: j };
    } catch (e){ return { code: 0, n: 0, body: String(e && e.message || e) }; }
  }
  const blocked = (r) => r.code === 401 || r.code === 403 || r.code === 404 ||
                         ((r.code === 200 || r.code === 204 || r.code === 201) && r.n === 0);

  const TABLES = ['stories','profiles','subscriptions','story_collaborators',
                  'ai_usage','story_comments','story_impressions','feedback'];

  console.log('%cDystoria — RLS Phase 3 (PostgREST, from the browser)', 'font-weight:700;font-size:13px');
  console.log('project: ' + URL_ + '   ·   signed in: ' + (JWT ? 'yes' : 'NO — only the anonymous half will run'));

  // ------------------------------------------------------------------ ANONYMOUS -------------
  for (const t of TABLES){
    const r = await req('GET', t + '?select=*&limit=5', ANON);
    if (r.code === 0) N('anon read ' + t + ' — could not reach the server');
    else if (r.code === 200 && r.n === 0) P('anon read ' + t + ' — 200, empty (RLS returns nothing)');
    else if (r.code === 401 || r.code === 403 || r.code === 404) P('anon read ' + t + ' — refused (' + r.code + ')');
    else if (r.code === 200) F('anon READ ' + r.n + ' ROWS from ' + t);
    else N('anon read ' + t + ' — unexpected ' + r.code);
  }

  let r = await req('POST', 'subscriptions', ANON,
                    { user_id:'00000000-0000-0000-0000-000000000000', plan:'pro', status:'active' });
  /* `Prefer: return=representation` means a real insert comes back as the row it created, so a
     2xx with nothing in it created nothing — counting the status alone was a false FAIL waiting
     to happen, and a check that cries wolf is a check that gets waved through next time. */
  if (r.code === 0) N('anon subscription insert — unreachable');
  else if ((r.code === 200 || r.code === 201) && r.n > 0) F('anon INSERTED a subscription — THE PAID GATE IS OPEN');
  else P('anon cannot insert a subscription (' + r.code + ', ' + r.n + ' rows)');

  r = await req('PATCH', 'subscriptions?user_id=neq.00000000-0000-0000-0000-000000000000', ANON, { plan:'pro' });
  if (r.code === 0) N('anon subscription patch — unreachable');
  else if (blocked(r)) P('anon cannot patch subscriptions (' + r.code + ', ' + r.n + ' rows)');
  else F('anon PATCHED ' + r.n + ' subscription rows — THE PAID GATE IS OPEN');

  r = await req('DELETE', 'stories?id=neq.00000000-0000-0000-0000-000000000000', ANON);
  if (r.code === 0) N('anon story delete — unreachable');
  else if (blocked(r)) P('anon cannot delete stories (' + r.code + ')');
  else F('anon DELETED ' + r.n + ' stories');

  // ------------------------------------------------------------------ SIGNED IN --------------
  if (JWT){
    let uid = null;
    try { uid = JSON.parse(atob(JWT.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub; } catch (e){}

    r = await req('GET', 'stories?select=id,owner&limit=200', JWT);
    if (r.code === 0) N('user read stories — unreachable');
    else if (r.code === 200){
      P('user reads their own stories (' + r.n + ')');
      const notMine = (r.body || []).filter(x => x && x.owner !== uid).length;
      if (notMine === 0) P('every readable story is the user’s own');
      else N(notMine + ' readable stories belong to someone else — confirm each was genuinely shared with this account');
    } else F('user cannot read their own stories (' + r.code + ')');

    r = await req('GET', 'profiles?select=id,email&limit=50', JWT);
    if (r.code === 0) N('user read profiles — unreachable');
    else if (r.n <= 1) P('user reads at most their own profile row (' + r.n + ')');
    else F('user reads ' + r.n + ' profile rows — that is the email list');

    r = await req('GET', 'subscriptions?select=*&limit=50', JWT);
    if (r.code === 0) N('user read subscriptions — unreachable');
    else if (r.n <= 1) P('user reads at most their own subscription (' + r.n + ')');
    else F('user reads ' + r.n + ' subscription rows');

    r = await req('GET', 'ai_usage?select=user_id&limit=200', JWT);
    if (r.code === 0) N('user read ai_usage — unreachable');
    else {
      const others = (r.body || []).filter(x => x && x.user_id !== uid).length;
      if (others === 0) P('user reads nobody else’s ai_usage');
      else F('user reads ' + others + ' ai_usage rows belonging to other people');
    }

    r = await req('PATCH', 'subscriptions?plan=eq.free', JWT, { plan:'pro', status:'active' });
    if (r.code === 0) N('user self-upgrade — unreachable');
    else if (blocked(r)) P('user cannot upgrade themselves (' + r.code + ', ' + r.n + ' rows)');
    else F('user UPGRADED THEMSELVES to pro (' + r.n + ' rows) — THE PAID GATE IS OPEN');

    r = await req('POST', 'subscriptions', JWT, { plan:'pro', status:'active' });
    if (r.code === 0) N('user subscription insert — unreachable');
    else if ((r.code === 200 || r.code === 201) && r.n > 0) F('user INSERTED a subscription — THE PAID GATE IS OPEN');
    else P('user cannot insert a subscription (' + r.code + ', ' + r.n + ' rows)');

    if (OTHER_STORY_ID){
      r = await req('GET', 'stories?id=eq.' + OTHER_STORY_ID + '&select=id', JWT);
      if (r.code === 0) N('cross-account read — unreachable');
      else if (r.n === 0) P('user cannot read another account’s story');
      else F('user READ another account’s story');

      r = await req('PATCH', 'stories?id=eq.' + OTHER_STORY_ID, JWT, { planning_baton: null });
      if (r.code === 0) N('cross-account patch — unreachable');
      else if (blocked(r)) P('user cannot patch another account’s story');
      else F('user PATCHED another account’s story (' + r.n + ' rows)');

      r = await req('DELETE', 'stories?id=eq.' + OTHER_STORY_ID, JWT);
      if (r.code === 0) N('cross-account delete — unreachable');
      else if (blocked(r)) P('user cannot delete another account’s story');
      else F('user DELETED another account’s story (' + r.n + ' rows)');
    } else {
      N('OTHER_STORY_ID is empty — the cross-account probes were skipped, and they are the sharpest ones');
    }
  } else {
    N('not signed in — only the anonymous half ran');
  }

  console.table(rows);
  const line = pass + ' passed, ' + fail + ' failed, ' + note + ' to check by hand';
  if (fail > 0) console.log('%cPhase 3 has NOT passed — ' + line, 'color:#b0402f;font-weight:700;font-size:13px');
  else console.log('%cPhase 3 passed — ' + line, 'color:#2e7d4f;font-weight:700;font-size:13px');
  console.log('Still open (roadmap): set_story_public(sid,false) clears is_public but leaves ' +
              'public_token live. To settle it, unshare a test story and try its old public link.');
  return { pass, fail, note };
})();
