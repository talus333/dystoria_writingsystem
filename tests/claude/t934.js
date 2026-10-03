/* v.934 — a beta reader's questions after an invitation, the public way in (/?beta=reader), the two new answers on the profile and
   in the directory, and the fallback for a database that has not had migration 21. Negative control: v.933 (build375). */
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const P = [], F = []; const is = (c, m) => (c ? P : F).push(m); const N = 9;
const done = () => { while (P.length + F.length < N) F.push('(not reached)'); console.log('\nPASS ' + P.length + '  FAIL ' + F.length); P.forEach(m => console.log('  ✓ ' + m)); F.forEach(m => console.log('  ✗ ' + m)); process.exit(0); };
process.on('unhandledRejection', e => { F.push('(crashed — ' + String(e && e.message).slice(0, 300) + ')'); done(); });
const init = () => {
  window.__S = { profile: null, calls: [], old: false, dir: [] };
  const rpc = async (n, a) => { const S = window.__S; S.calls.push({ n, a: JSON.parse(JSON.stringify(a || {})) });
    if (n === 'beta_invite_peek') return { data: { status: 'open', author_name: 'Mara', note: 'Read my book?' }, error: null };
    if (n === 'beta_profile_get') return { data: S.profile, error: null };
    if (n === 'beta_invite_accept'){ if (!a.a_adult) return { data: 'adult', error: null }; S.profile = { open: true, adult: true, swap: false, volunteer: false, reads: [], lengths: [], capacity: 2, active: 0 }; return { data: 'ok', error: null }; }
    if (n === 'beta_profile_set'){ if (S.old && ('a_portions' in a)) return { data: null, error: { message: 'Could not find the function public.beta_profile_set(a_about, a_adult, …) in the schema cache', code: 'PGRST202' } };
      if (!a.a_adult) return { data: 'adult', error: null };
      S.profile = { open: a.a_open, adult: true, swap: a.a_swap, volunteer: a.a_volunteer, reads: a.a_reads, lengths: a.a_lengths, capacity: a.a_capacity, wont: a.a_wont, about: a.a_about, turnaround: a.a_turnaround, portions: a.a_portions || [], feedback: a.a_feedback || [], active: 0 }; return { data: 'ok', error: null }; }
    if (n === 'beta_directory') return { data: S.dir, error: null };
    return { data: [], error: null }; };
  window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }), getUser: async () => ({ data: { user: null } }) },
    from: () => { const p = new Proxy(function(){}, { get(t, k){ if (k === 'then') return r => r({ data: [], error: null }); return () => p; }, apply(){ return p; } }); return p; }, rpc,
    channel: () => { const c = { on(){ return c; }, subscribe(){ return c; }, send(){ return c; }, unsubscribe(){}, track(){} }; return c; }, removeChannel(){} }) };
  try { localStorage.setItem('dystoria.mobileNoticeSeen', '1'); localStorage.setItem('dystoria.consent', 'denied'); } catch (e){}
};
const card = pg => pg.evaluate(() => { const c = document.getElementById('invCard'); return (c && c.classList.contains('show')) ? c.innerText.replace(/\s+/g, ' ').trim() : ''; });
const waitCard = async (pg, re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)){ const t = await card(pg); if (re.test(t)) return t; await pg.waitForTimeout(300); } return await card(pg); };
const signIn = pg => pg.evaluate(() => { cloud.user = { id: '00000000-0000-0000-0000-0000000000aa', is_anonymous: false, email: 'r@example.com' }; });
const click = (pg, sel, text) => pg.evaluate(([sel, text]) => { const b = Array.from(document.querySelectorAll('#invCard ' + sel)).find(x => !text || (x.textContent || '').trim() === text); if (b) b.click(); return !!b; }, [sel, text]);
(async () => {
  const B = process.argv[2];
  const b = await chromium.launch({ args: ['--no-sandbox'] }); const errs = [];
  const open = async (suffix, wait) => { const pg = await b.newPage({ viewport: { width: 1300, height: 900 } }); pg.on('pageerror', e => errs.push(String(e.message))); await pg.addInitScript(init); await pg.goto('file://' + B + suffix); await pg.waitForTimeout(wait || 3000); return pg; };

  /* ---- 1–3 an invited reader ---- */
  let pg = await open('#/beta-join/11111111-2222-3333-4444-555555555555', 700); await signIn(pg);
  let t = await waitCard(pg, /Yes, I.ll read/i);
  await pg.evaluate(() => { const a = document.querySelector('#invCard .bx-ivad'); if (a) a.checked = true; }); await click(pg, '.iv-btn', 'Yes, I’ll read');
  t = await waitCard(pg, /A few questions/);
  is(/A few questions/.test(t) && /Would you read for other writers too\?/i.test(t) && /Just Mara/.test(t) && /What do you like to read\?/i.test(t) && /How much at a time\?/i.test(t) && /A chapter or section/.test(t) && /What kind of feedback do you give\?/i.test(t) && /Line-level notes/.test(t) && /Skip for now/i.test(t),
    '1 after "Yes, I’ll read" an invited reader is asked a few optional questions: other writers too, genres, how much at a time, the feedback they give · ' + t.slice(0, 200));
  await pg.evaluate(() => { const c = document.querySelector('#invCard .iv-card'); const pick = (cls, v) => c.querySelector('.' + cls + ' .bx-chip[data-v="' + v + '"]').click();
    pick('bq-reads', 'Fantasy'); pick('bq-ports', 'section'); pick('bq-ports', 'full'); pick('bq-fb', 'line'); c.querySelector('input[name="bqVol"][value="1"]').checked = true; c.querySelector('.bq-about').value = 'I notice pacing.'; });
  await click(pg, '.bq-save'); t = await waitCard(pg, /can now find you/);
  let S = await pg.evaluate(() => window.__S);
  let set = S.calls.filter(c => c.n === 'beta_profile_set').slice(-1)[0] || { a: {} };
  is(set.a.a_volunteer === true && set.a.a_swap === false && JSON.stringify(set.a.a_portions) === '["section","full"]' && JSON.stringify(set.a.a_feedback) === '["line"]' && JSON.stringify(set.a.a_reads) === '["Fantasy"]' && JSON.stringify(set.a.a_lengths) === '["novella","novel"]' && set.a.a_about === 'I notice pacing.',
    '2 the answers are saved: listed for other writers (a volunteer, not a swapper), with what they read, take on and give · ' + JSON.stringify(set.a));
  is(/You.re Mara.s beta reader/.test(t) && /Writers looking for readers can now find you/.test(t), '3 and they are told they can now be found · ' + t.slice(0, 160));
  await pg.close();

  /* ---- 4 skipping keeps them private ---- */
  pg = await open('#/beta-join/11111111-2222-3333-4444-555555555555', 700); await signIn(pg);
  await waitCard(pg, /Yes, I.ll read/i);
  await pg.evaluate(() => { const a = document.querySelector('#invCard .bx-ivad'); if (a) a.checked = true; }); await click(pg, '.iv-btn', 'Yes, I’ll read');
  await waitCard(pg, /A few questions/); await click(pg, '.bq-skip'); t = await waitCard(pg, /Nothing to do until then/);
  S = await pg.evaluate(() => window.__S);
  is(/Nothing to do until then/.test(t) && !S.calls.some(c => c.n === 'beta_profile_set') && S.profile.volunteer === false, '4 "Skip for now" saves nothing and leaves them private, reading for Mara only · ' + t.slice(0, 120));

  /* ---- 5 a database without migration 21 ---- */
  await pg.evaluate(() => { window.__S.old = true; document.getElementById('invCard').classList.remove('show'); window.dystBetaReaderSetup({ who: 'Mara' }); });
  await waitCard(pg, /A few questions/);
  await pg.evaluate(() => { const c = document.querySelector('#invCard .iv-card'); c.querySelector('.bq-ports .bx-chip[data-v="short"]').click(); c.querySelector('input[name="bqVol"][value="1"]').checked = true; });
  await click(pg, '.bq-save'); t = await waitCard(pg, /can now find you/);
  S = await pg.evaluate(() => window.__S); const sets = S.calls.filter(c => c.n === 'beta_profile_set');
  is(/can now find you/.test(t) && sets.length === 2 && ('a_portions' in sets[0].a) && !('a_portions' in sets[1].a) && sets[1].a.a_volunteer === true && S.profile.volunteer === true,
    '5 before migration 21 is run the two new answers are left out and everything else still saves · ' + JSON.stringify(sets.map(x => Object.keys(x.a).length)));

  /* ---- 6 the profile form and the directory card ---- */
  const R6 = await pg.evaluate(async () => { document.getElementById('invCard').classList.remove('show'); const W = ms => new Promise(z => setTimeout(z, ms));
    window.__S.old = false; window.__S.profile.portions = ['section']; window.__S.profile.feedback = ['story'];
    window.__S.dir = [{ user_id: '00000000-0000-0000-0000-0000000000bb', name: 'Ana', reads: ['Fantasy'], lengths: ['novel'], capacity: 2, active: 0, open: true, about: 'Reads at night', wont: null, turnaround: 'two weeks', link: 'none', swap: false, volunteer: true, portions: ['section', 'full'], feedback: ['reader', 'line'] }];
    window.dystBetaOpen('profile'); await W(1500);
    const pn = document.getElementById('chatPanel'); const prof = pn ? pn.innerText.replace(/\s+/g, ' ') : '';
    const on = pn ? Array.from(pn.querySelectorAll('.bx-ports .bx-chip.on, .bx-fb .bx-chip.on')).map(x => x.getAttribute('data-v')) : [];
    window.dystBetaOpen('find'); await W(2000);
    const find = pn ? pn.innerText.replace(/\s+/g, ' ') : '';
    return { prof: /How much at a time/i.test(prof) && /The feedback you give/i.test(prof), on, find: (find.match(/Takes[^·]*· gives[^A-Z]*/) || [''])[0], ask: /Ask to read/i.test(find) }; });
  is(R6.prof && JSON.stringify(R6.on) === '["section","story"]' && /Takes a chapter or section, a whole novel · gives gut reactions as a reader, line-level notes/.test(R6.find) && R6.ask,
    '6 the reader profile has the two rows (with their answers on), and a writer searching sees "Takes … · gives …" on the card, with Ask to read · ' + JSON.stringify(R6));
  await pg.close();

  /* ---- 7–8 the public way in ---- */
  pg = await open('?beta=reader');
  t = await waitCard(pg, /Become a beta reader/);
  const url = await pg.evaluate(() => location.search + location.hash);
  await pg.evaluate(() => { window.__acct = 0; window.openAccount = () => { window.__acct++; }; });
  await click(pg, '.iv-btn', 'Become a reader'); const t7b = await card(pg);
  await pg.evaluate(() => { document.querySelector('#invCard .bx-ivad').checked = true; }); await click(pg, '.iv-btn', 'Become a reader'); await pg.waitForTimeout(300);
  const acct = await pg.evaluate(() => ({ n: window.__acct, shown: document.getElementById('invCard').classList.contains('show') }));
  is(/Become a beta reader/.test(t) && /You don.t need to write/.test(t) && url === '' && /18 and over/.test(t7b) && acct.n === 1 && !acct.shown,
    '7 /?beta=reader shows "Become a beta reader" to a visitor (the address tidied), needs the 18+ box, then opens sign-up · ' + JSON.stringify({ url, acct }));
  await signIn(pg); t = await waitCard(pg, /Tell writers what you like to read/);
  const noRadio = await pg.evaluate(() => !document.querySelector('#invCard input[name="bqVol"]'));
  await pg.evaluate(() => { document.querySelector('#invCard .bq-reads .bx-chip[data-v="Mystery"]').click(); }); await click(pg, '.bq-save'); t = await waitCard(pg, /You.re a beta reader/);
  S = await pg.evaluate(() => window.__S); set = S.calls.filter(c => c.n === 'beta_profile_set').slice(-1)[0] || { a: {} };
  is(noRadio && /You.re a beta reader/.test(t) && /can now find you/.test(t) && set.a.a_volunteer === true && set.a.a_swap === false && set.a.a_adult === true && JSON.stringify(set.a.a_reads) === '["Mystery"]' && !(await pg.evaluate(() => localStorage.getItem('dystoria.pendingBetaReader'))),
    '8 once signed up they answer the same questions and are listed for writers to find (no invitation, no writing needed) · ' + JSON.stringify(set.a));
  await pg.close();
  is(!errs.length, '9 no page errors · ' + JSON.stringify(errs.slice(0, 3)));
  await b.close(); done();
})();
