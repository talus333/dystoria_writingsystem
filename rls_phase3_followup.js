/* =====================================================================================
   Dystoria — RLS Phase 3, the two loose ends. Paste into the console on the app, signed in.

   (1) THE DELETE PROBE, DONE PROPERLY. The first run reported "anon cannot delete stories (204)".
       PostgREST answers a DELETE with 204 No Content whether it removed nothing or removed
       everything, so that was a sentence about the status line, not about the database. Doing it
       honestly means having something to lose that does not matter: this makes a throwaway story
       of its own, asks the anonymous key to delete it, then looks to see whether it is still
       there — and cleans up after itself either way. Your real stories are never the target.

   (2) THE FOUR STORIES YOU DO NOT OWN. The run found four readable stories owned by someone else.
       That is exactly what a genuine collaboration looks like, and also exactly what a leak looks
       like. The difference is whether a row exists in story_collaborators putting you on each one,
       so this asks.
   ===================================================================================== */
(async () => {
  const URL_ = (typeof SUPA_URL !== 'undefined') ? SUPA_URL : null;
  const ANON = (typeof SUPA_KEY !== 'undefined') ? SUPA_KEY : null;
  if (!URL_ || !ANON){ console.error('Not on the Dystoria app — SUPA_URL / SUPA_KEY are not here.'); return; }
  let JWT = null;
  try { JWT = (await supa.auth.getSession()).data.session.access_token; } catch (e){}
  if (!JWT){ console.error('Not signed in — sign in and run this again.'); return; }
  const uid = JSON.parse(atob(JWT.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;
  const REST = URL_.replace(/\/+$/,'') + '/rest/v1';

  async function req(method, path, token, body){
    const h = { apikey: ANON, Authorization: 'Bearer ' + token };
    if (method !== 'GET') h['Prefer'] = 'return=representation';
    if (body) h['Content-Type'] = 'application/json';
    try {
      const r = await fetch(REST + '/' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await r.json(); } catch (e){}
      return { code: r.status, n: Array.isArray(j) ? j.length : 0, body: j };
    } catch (e){ return { code: 0, n: 0, body: String(e) }; }
  }

  const out = [];
  const P = m => out.push({ '':'PASS', check:m });
  const F = m => out.push({ '':'FAIL', check:m });
  const N = m => out.push({ '':'note', check:m });

  // ---------------------------------------------------------------- (1) the delete probe ------
  const made = await req('POST', 'stories', JWT, { owner: uid, title: 'RLS probe — safe to delete' });
  const probeId = made.body && made.body[0] && made.body[0].id;
  if (!probeId){
    N('could not create a throwaway story (' + made.code + ') — the delete probe was skipped rather than aimed at a real one');
  } else {
    const del = await req('DELETE', 'stories?id=eq.' + probeId, ANON);
    const after = await req('GET', 'stories?id=eq.' + probeId + '&select=id', JWT);
    if (after.n === 1) P('anon cannot delete a story — the throwaway survived (delete answered ' + del.code + ', ' + del.n + ' rows)');
    else F('ANON DELETED A STORY (delete answered ' + del.code + ', ' + del.n + ' rows) — anyone with the publishable key can wipe your rows');
    const gone = await req('DELETE', 'stories?id=eq.' + probeId, JWT);
    if (gone.code === 200 || gone.code === 204) P('throwaway cleaned up');
    else N('the throwaway story "RLS probe — safe to delete" is still there — delete it by hand (id ' + probeId + ')');
  }

  // ---------------------------------------------------------------- (2) the four stories ------
  const mine = await req('GET', 'stories?select=id,owner,title&limit=200', JWT);
  const notMine = (mine.body || []).filter(s => s && s.owner !== uid);
  if (!notMine.length){
    P('nothing readable that you do not own');
  } else {
    console.log('%cStories you can read but do not own:', 'font-weight:700');
    for (const s of notMine){
      const c = await req('GET', 'story_collaborators?story_id=eq.' + s.id + '&user_id=eq.' + uid + '&select=story_id', JWT);
      if (c.n === 1) P('shared with you: "' + (s.title || s.id) + '" — a collaborator row exists');
      else F('NOT SHARED WITH YOU: "' + (s.title || s.id) + '" (' + s.id + ') — readable with no collaborator row. That is a leak.');
    }
  }

  console.table(out);
  const f = out.filter(x => x[''] === 'FAIL').length;
  console.log(f ? '%cLoose ends: ' + f + ' FAILED — read them above.' : '%cBoth loose ends are clean.',
              f ? 'color:#b0402f;font-weight:700' : 'color:#2e7d4f;font-weight:700');
  console.log('Still untested: the cross-account probes. They need a story id from an account that ' +
              'has never shared with you — sign up a throwaway account, make one story, copy its id ' +
              'into OTHER_STORY_ID at the top of rls_phase3_console.js, and run that again as yourself.');
})();
