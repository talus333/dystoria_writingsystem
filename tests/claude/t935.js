/* v.935 — a writer opts into beta reading from their account, from Community and from Find readers; asking a friend to be your
   beta reader, and the friend's side (yes with the 18+ box, or a quiet "not now"); the fallbacks for a database that has not had
   migration 22. Negative control: v.934 (build376). */
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const P = [], F = []; const is = (c, m) => (c ? P : F).push(m); const N = 14;
const done = () => { while (P.length + F.length < N) F.push('(not reached)'); console.log('\nPASS ' + P.length + '  FAIL ' + F.length); P.forEach(m => console.log('  ✓ ' + m)); F.forEach(m => console.log('  ✗ ' + m)); process.exit(0); };
process.on('unhandledRejection', e => { F.push('(crashed — ' + String(e && e.message).slice(0, 300) + ')'); done(); });
const BEN = '00000000-0000-0000-0000-0000000000b1', CY = '00000000-0000-0000-0000-0000000000c1', ANA = '00000000-0000-0000-0000-0000000000a1';
const init = () => {
  const BEN = '00000000-0000-0000-0000-0000000000b1', CY = '00000000-0000-0000-0000-0000000000c1';
  window.__S = { profile: null, calls: [], no22: false, dir: [], group: [], flashes: [],
    friends: [{ user_id: BEN, username: 'Ben', status: 'accepted', requested_by_me: false, online: false, unread: 0 }, { user_id: CY, username: 'Cy', status: 'accepted', requested_by_me: true, online: false, unread: 0 }] };
  const miss = n => ({ data: null, error: { message: 'Could not find the function public.' + n + ' in the schema cache', code: 'PGRST202' } });
  const rpc = async (n, a) => { const S = window.__S; S.calls.push({ n, a: JSON.parse(JSON.stringify(a || {})) });
    if (n === 'my_partners') return { data: S.friends, error: null };
    if (n === 'beta_profile_get') return { data: S.profile, error: null };
    if (n === 'beta_group') return { data: S.group, error: null };
    if (n === 'beta_profile_set'){ if (!a.a_adult) return { data: 'adult', error: null };
      S.profile = { open: a.a_open, adult: true, swap: a.a_swap, volunteer: a.a_volunteer, reads: a.a_reads, lengths: a.a_lengths, capacity: a.a_capacity, wont: a.a_wont, about: a.a_about, turnaround: a.a_turnaround, portions: a.a_portions || (S.profile && S.profile.portions) || [], feedback: a.a_feedback || (S.profile && S.profile.feedback) || [], active: 0 }; return { data: 'ok', error: null }; }
    if (n === 'beta_ask_friend'){ if (S.no22) return miss('beta_ask_friend(a_note, a_to)'); if (!S.profile) return { data: 'opt_in', error: null };
      const f = S.friends.find(x => x.user_id === a.a_to); S.group.push({ user_id: a.a_to, name: f ? f.username : '?', status: 'pending', requested_by_me: true, note: a.a_note, i_read: 0, they_read: 0, reading_mine: 0, i_am_reading: 0, capacity: 0, active: 0, open: false, opted: false, rel: 'reads_for_me' }); return { data: 'ok', error: null }; }
    if (n === 'beta_respond'){ if (S.no22 && ('a_adult' in a)) return miss('beta_respond(a_accept, a_adult, a_other)');
      const g = S.group.find(x => x.user_id === a.a_other); if (!g) return { data: 'not_found', error: null };
      if (a.a_accept){ if (!S.profile){ if (!a.a_adult) return { data: 'adult', error: null }; S.profile = { open: true, adult: true, swap: false, volunteer: false, reads: [], lengths: [], capacity: 2, active: 0 }; } g.status = 'accepted'; }
      else S.group = S.group.filter(x => x !== g);
      return { data: 'ok', error: null }; }
    if (n === 'beta_directory') return { data: S.dir, error: null };
    return { data: [], error: null }; };
  window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }), getUser: async () => ({ data: { user: null } }) },
    from: () => { const p = new Proxy(function(){}, { get(t, k){ if (k === 'then') return r => r({ data: [], error: null }); return () => p; }, apply(){ return p; } }); return p; }, rpc,
    functions: { invoke: async () => ({}) },
    channel: () => { const c = { on(){ return c; }, subscribe(){ return c; }, send(){ return c; }, unsubscribe(){}, track(){} }; return c; }, removeChannel(){} }) };
  try { localStorage.setItem('dystoria.mobileNoticeSeen', '1'); localStorage.setItem('dystoria.consent', 'denied'); } catch (e){}
};
const card = pg => pg.evaluate(() => { const c = document.getElementById('invCard'); return (c && c.classList.contains('show')) ? c.innerText.replace(/\s+/g, ' ').trim() : ''; });
const waitCard = async (pg, re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)){ const t = await card(pg); if (re.test(t)) return t; await pg.waitForTimeout(300); } return await card(pg); };
const signIn = (pg, prof, group) => pg.evaluate(([prof, group]) => { if (prof !== undefined) window.__S.profile = prof; if (group) window.__S.group = group;
  cloud.user = { id: '00000000-0000-0000-0000-0000000000aa', is_anonymous: false, email: 'w@example.com' };
  window.__realFlash = window.flashStatus; window.flashStatus = m => { window.__S.flashes.push(String(m)); }; window.sitePrompt = async () => 'my novel, would you?'; }, [prof === undefined ? undefined : prof, group || null]);
const click = (pg, sel, text) => pg.evaluate(([sel, text]) => { const b = Array.from(document.querySelectorAll(sel)).find(x => !text || (x.textContent || '').trim() === text); if (b) b.click(); return !!b; }, [sel, text]);
const txt = (pg, sel) => pg.evaluate(sel => { const e = document.querySelector(sel); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; }, sel);
const waitTxt = async (pg, sel, re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 12000)){ const t = await txt(pg, sel); if (re.test(t)) return t; await pg.waitForTimeout(300); } return await txt(pg, sel); };
const LISTED = { open: true, adult: true, swap: true, volunteer: false, reads: ['Fantasy'], lengths: ['novel'], capacity: 2, active: 0, portions: ['full'], feedback: ['story'] };
const PRIVATE = { open: true, adult: true, swap: false, volunteer: false, reads: [], lengths: [], capacity: 2, active: 0 };
(async () => {
  const B = process.argv[2];
  const b = await chromium.launch({ args: ['--no-sandbox'] }); const errs = [];
  const open = async (suffix, wait) => { const pg = await b.newPage({ viewport: { width: 1300, height: 900 } }); pg.on('pageerror', e => errs.push(String(e.message))); await pg.addInitScript(init); await pg.goto('file://' + B + (suffix || '')); await pg.waitForTimeout(wait || 2500); return pg; };

  /* ---- 1–3 Your account → Beta reading ---- */
  let pg = await open(); await signIn(pg, null); await pg.waitForTimeout(3500);
  await pg.evaluate(() => openAccount());
  let t = await waitTxt(pg, '#profileCard .ac-betarow', /Not listed/);
  is(/Beta reading/i.test(t) && /Not listed/.test(t) && /Read for others/i.test(t), '1 Your account has a Beta reading section: a writer who is not listed is offered "Read for others" · ' + t.slice(0, 160));
  await click(pg, '#profileCard .abr-go'); t = await waitCard(pg, /Read for other writers/);
  const R2 = await pg.evaluate(() => ({ acct: !!(document.getElementById('profileBd') && getComputedStyle(document.getElementById('profileBd')).display !== 'none' && document.getElementById('profileBd').classList.contains('show')),
    roles: Array.from(document.querySelectorAll('#invCard input[name="bqRole"]')).map(x => x.value + (x.checked ? '*' : '')), vol: !!document.querySelector('#invCard input[name="bqVol"]') }));
  await pg.evaluate(() => { const c = document.querySelector('#invCard .iv-card'); c.querySelector('input[name="bqRole"][value="both"]').checked = true; c.querySelector('.bq-reads .bx-chip[data-v="Fantasy"]').click(); c.querySelector('.bx-ivad').checked = true; });
  await click(pg, '#invCard .bq-save'); const t2 = await waitCard(pg, /You.re a beta reader/);
  let S = await pg.evaluate(() => window.__S); let set = S.calls.filter(c => c.n === 'beta_profile_set').slice(-1)[0] || { a: {} };
  is(/How would you like to take part/i.test(t) && JSON.stringify(R2.roles) === '["swap*","volunteer","both"]' && !R2.vol && set.a.a_swap === true && set.a.a_volunteer === true && JSON.stringify(set.a.a_reads) === '["Fantasy"]' && /can now find you/.test(t2),
    '2 it opens the same questions with a choice of how to take part (swap by default); "Both" lists them as swapping and reading for anyone · ' + JSON.stringify([R2.roles, set.a.a_swap, set.a.a_volunteer]));
  await click(pg, '#invCard .iv-btn', 'Later'); await pg.evaluate(() => openAccount());
  t = await waitTxt(pg, '#profileCard .ac-betarow', /Listed/);
  const t3a = t; await click(pg, '#profileCard .abr-pause'); t = await waitTxt(pg, '#profileCard .ac-betarow', /Paused/);
  S = await pg.evaluate(() => window.__S); set = S.calls.filter(c => c.n === 'beta_profile_set').slice(-1)[0] || { a: {} };
  is(/Listed\. Swaps reads and reads for anyone · Fantasy · 2 at a time/.test(t3a) && /Edit/.test(t3a) && /Pause/.test(t3a) && /Paused\./.test(t) && /Resume/.test(t) && set.a.a_open === false && set.a.a_swap === true && set.a.a_volunteer === true && JSON.stringify(set.a.a_reads) === '["Fantasy"]' && !('a_portions' in set.a),
    '3 once listed it shows a summary with Edit and Pause; Pause turns reads off and keeps everything else · ' + t3a.slice(0, 110) + ' → ' + t.slice(0, 60));
  await pg.close();

  /* ---- 4 Community → Friends: the card ---- */
  pg = await open(); await signIn(pg, null); await pg.waitForTimeout(3500);
  await pg.evaluate(() => window.dystChatOpen());
  t = await waitTxt(pg, '#chatPanel', /Also willing to read for others/);
  const has4 = /Also willing to read for others\?/.test(t) && /Add me/i.test(t);
  await click(pg, '#chatPanel .bx-also-x'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.dystChatClose(); window.dystChatOpen(); }); await pg.waitForTimeout(1200);
  const gone4 = !(await pg.evaluate(() => !!document.querySelector('#chatPanel .bx-also')));
  await pg.evaluate(L => { localStorage.removeItem('dystoria.betaCardOff'); window.__S.profile = L; return window.dystBetaRefresh(); }, LISTED); await pg.waitForTimeout(600);
  await pg.evaluate(() => { window.dystChatClose(); window.dystChatOpen(); }); await pg.waitForTimeout(1200);
  const listed4 = !(await pg.evaluate(() => !!document.querySelector('#chatPanel .bx-also')));
  is(has4 && gone4 && listed4, '4 Community shows "Also willing to read for others?" once to a writer who is not listed; dismissed it stays away, and a listed writer never sees it · ' + JSON.stringify({ has4, gone4, listed4 }));

  /* ---- 5–7 ask a friend ---- */
  const btn5 = await pg.evaluate(() => Array.from(document.querySelectorAll('#chatPanel .ch-row')).map(r => r.querySelector('.ch-name').textContent + ':' + (r.querySelector('.bx-fask') ? 'ask' : '-')));
  await click(pg, '#chatPanel .ch-row[data-id="' + BEN + '"] .bx-fask'); await pg.waitForTimeout(1500);
  S = await pg.evaluate(() => window.__S); let ask = S.calls.filter(c => c.n === 'beta_ask_friend').slice(-1)[0] || { a: {} };
  const btn5b = await pg.evaluate(() => Array.from(document.querySelectorAll('#chatPanel .ch-row')).map(r => r.querySelector('.ch-name').textContent + ':' + (r.querySelector('.bx-fask') ? 'ask' : '-')));
  is(JSON.stringify(btn5) === '["Ben:ask","Cy:ask"]' && ask.a.a_to === BEN && ask.a.a_note === 'my novel, would you?' && /Asked Ben/.test(S.flashes.join('|')) && JSON.stringify(btn5b) === '["Ben:-","Cy:ask"]',
    '5 each friend has an "Ask to be your beta reader" button; asking Ben sends the ask with the note, says so, and his button goes · ' + JSON.stringify([btn5, btn5b, S.flashes.slice(-1)]));
  await pg.evaluate(() => window.dystBetaOpen('group')); t = await waitTxt(pg, '#chatPanel', /Ask a friend/);
  const R6 = await pg.evaluate(() => ({ rows: Array.from(document.querySelectorAll('#chatPanel .bx-frow')).map(r => r.getAttribute('data-name')), asked: /Asked[\s\S]*Ben/i.test(document.getElementById('chatPanel').innerText) }));
  await click(pg, '#chatPanel .bx-frow .bx-fask2'); await pg.waitForTimeout(1500);
  S = await pg.evaluate(() => window.__S); ask = S.calls.filter(c => c.n === 'beta_ask_friend').slice(-1)[0] || { a: {} };
  const rows6 = await pg.evaluate(() => document.querySelectorAll('#chatPanel .bx-frow').length);
  is(JSON.stringify(R6.rows) === '["Cy"]' && R6.asked && ask.a.a_to === CY && rows6 === 0, '6 Beta readers → Group has "Ask a friend" for friends who are not readers yet (Cy, not Ben who is already asked); asking empties it · ' + JSON.stringify([R6, rows6]));
  await pg.evaluate(() => { window.__S.no22 = true; window.__S.group = []; window.__S.flashes = []; return window.dystBetaRefresh(); }); await pg.waitForTimeout(500);
  await pg.evaluate(BEN => window.dystBetaAskFriend(BEN, 'Ben'), BEN); await pg.waitForTimeout(1200);
  await pg.evaluate(() => window.dystBetaOpen('group')); await pg.waitForTimeout(1200);
  S = await pg.evaluate(() => window.__S); t = await txt(pg, '#chatPanel');
  is(/migration 22/.test(S.flashes.join('|')) && !/migration 17/.test(t) && /Ask a friend/i.test(t), '7 before migration 22 is run, asking a friend says it needs that update and the rest of Beta readers carries on · ' + JSON.stringify(S.flashes));
  await pg.close();
  pg = await open(); await signIn(pg, null); await pg.waitForTimeout(3500);
  await pg.evaluate(BEN => window.dystBetaAskFriend(BEN, 'Ben'), BEN); t = await waitCard(pg, /Set up your reader profile first/);
  S = await pg.evaluate(() => window.__S);
  is(/Set up your reader profile first/.test(t) && /To ask Ben to read for you/.test(t) && !S.calls.some(c => c.n === 'beta_ask_friend'), '8 a writer with no reader profile is told to set theirs up before asking a friend · ' + t.slice(0, 140));
  await pg.close();

  /* ---- 9–12 the friend's side ---- */
  const INC = [{ user_id: ANA, name: 'Ana', status: 'pending', requested_by_me: false, note: 'It’s a ghost story.', i_read: 0, they_read: 0, reading_mine: 0, i_am_reading: 0, capacity: 2, active: 0, open: true, opted: true, rel: 'i_read_for' }];
  pg = await open(); await signIn(pg, null, INC);
  t = await waitCard(pg, /Ana would like you to be a/);
  is(/Ana would like you to be a Beta reader/i.test(t) && /ghost story/.test(t) && /18 or older/.test(t) && /Not now/i.test(t) && /Yes, I.ll read/i.test(t) && /whether other writers can find you/.test(t),
    '9 a friend with no reader profile is shown the ask in the app: who, their note, the 18+ box, Yes or Not now · ' + t.slice(0, 200));
  await click(pg, '#invCard .iv-btn', 'Yes, I’ll read'); await pg.waitForTimeout(400); const t10a = await card(pg);
  S = await pg.evaluate(() => window.__S); const early = S.calls.some(c => c.n === 'beta_respond');
  await pg.evaluate(() => { document.querySelector('#invCard .bx-ivad').checked = true; }); await click(pg, '#invCard .iv-btn', 'Yes, I’ll read');
  t = await waitCard(pg, /A few questions/);
  S = await pg.evaluate(() => window.__S); let rs = S.calls.filter(c => c.n === 'beta_respond').slice(-1)[0] || { a: {} };
  is(/18 and over/.test(t10a) && !early && rs.a.a_other === ANA && rs.a.a_accept === true && rs.a.a_adult === true && /A few questions/.test(t) && /Just Ana/.test(t) && /other writers can find me/.test(t) && S.profile.volunteer === false && S.profile.swap === false,
    '10 yes needs the 18+ box; then they are Ana’s reader, private, and asked the questions with "Just Ana" or "other writers can find me" · ' + JSON.stringify(rs.a));
  await pg.close();
  pg = await open(); await signIn(pg, null, INC); await waitCard(pg, /Ana would like you to be a/);
  const t11 = await pg.evaluate(async () => { document.getElementById('invCard').classList.remove('show'); window.dystBetaOpen(); await new Promise(z => setTimeout(z, 1500)); const p = document.getElementById('chatPanel'); return { txt: p.innerText.replace(/\s+/g, ' '), fa: !!p.querySelector('.bx-fa .bx-fa-see') }; });
  await click(pg, '#chatPanel .bx-fa-see'); t = await waitCard(pg, /Ana would like you to be a/);
  await click(pg, '#invCard .iv-btn', 'Not now'); await pg.waitForTimeout(4500);
  S = await pg.evaluate(() => window.__S); rs = S.calls.filter(c => c.n === 'beta_respond').slice(-1)[0] || { a: {} };
  const after11 = await pg.evaluate(() => ({ card: document.getElementById('invCard').classList.contains('show'), fa: !!document.querySelector('#chatPanel .bx-fa') }));
  is(t11.fa && /Ana would like you as a beta reader/.test(t11.txt) && /Ana would like you to be a/.test(t) && rs.a.a_accept === false && S.profile === null && !after11.card,
    '11 the ask also waits at the top of Beta readers with Answer; "Not now" declines, makes no profile, and the card does not come back · ' + JSON.stringify([rs.a, after11]));
  await pg.close();
  pg = await open(); await signIn(pg, null, INC); await pg.evaluate(() => { window.__S.no22 = true; }); await waitCard(pg, /Ana would like you to be a/);
  await pg.evaluate(() => { window.__S.profile = { open: true, adult: true, swap: false, volunteer: false, reads: [], lengths: [], capacity: 2, active: 0 }; document.querySelector('#invCard .bx-ivad').checked = true; });
  await click(pg, '#invCard .iv-btn', 'Yes, I’ll read'); t = await waitCard(pg, /A few questions/);
  S = await pg.evaluate(() => window.__S); const rsp = S.calls.filter(c => c.n === 'beta_respond');
  is(rsp.length === 2 && ('a_adult' in rsp[0].a) && !('a_adult' in rsp[1].a) && rsp[1].a.a_accept === true && /A few questions/.test(t), '12 a database without migration 22 is answered the old way (two arguments) · ' + JSON.stringify(rsp.map(x => Object.keys(x.a))));
  await pg.close();

  /* ---- 13 Find readers: swap instead? ---- */
  pg = await open(); await signIn(pg, PRIVATE); await pg.waitForTimeout(3500);
  const R13 = await pg.evaluate(async (L) => { const W = ms => new Promise(z => setTimeout(z, ms));
    window.dystBetaOpen('find'); await W(1800); const p = document.getElementById('chatPanel'); const a = p.innerText.replace(/\s+/g, ' ');
    p.querySelector('.bx-also-go').click(); await W(600); const c = document.getElementById('invCard'); const q = c.classList.contains('show') ? c.innerText.replace(/\s+/g, ' ') : ''; c.classList.remove('show');
    window.__S.profile = L; await window.dystBetaRefresh(); window.dystBetaOpen('find'); await W(1800);
    return { hint: /Swap instead\?/.test(a) && /List me/i.test(a), q: /Read for other writers/.test(q) && /How would you like to take part/i.test(q), listed: !document.querySelector('#chatPanel .bx-also') }; }, LISTED);
  is(R13.hint && R13.q && R13.listed, '13 Find readers offers "Swap instead?" to a writer who is not listed (it opens the questions), and not to one who is · ' + JSON.stringify(R13));
  await pg.close();
  is(!errs.length, '14 no page errors · ' + JSON.stringify(errs.slice(0, 3)));
  await b.close(); done();
})();
