// v.557: a group is ONE thing. Made in Elements it appears in Bonds; made in
// Bonds it appears in Elements, the notepad and the Story Legend. And it appears
// exactly ONCE on each side — the failure this could most easily introduce.
const { chromium } = require('playwright');
const FILE = process.argv[2] || (__dirname + '/../out.html');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:1500,height:900} });
  const p = await ctx.newPage();
  const errs = [];
  const NOISE = /ERR_TUNNEL|Failed to load resource|URL scheme "file"/;
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !NOISE.test(m.text())) errs.push('console: '+m.text()); });

  await p.goto('file://' + FILE); await p.waitForTimeout(2500);
  await p.evaluate(() => { const f=document.getElementById('landingFrame'); if(f) f.remove();
    try{ localStorage.setItem('dystoria_entered','1'); localStorage.setItem('dystoria.onboarding','off'); }catch(e){} });
  await p.reload(); await p.waitForTimeout(3200);
  await p.evaluate(() => { try{
    if(!loadSessions().some(x=>x.id==='.s_hansel_demo') && window.buildHanselSession){
      const l=loadSessions(); l.unshift(window.buildHanselSession()); persistSessions(l); }
    openSession('.s_hansel_demo'); }catch(e){} });
  await p.waitForTimeout(1800);

  const snap = () => p.evaluate(() => {
    const orgNames = (state.prompt && state.prompt.words || [])
      .filter(w => w && w.cat === 'org').map(w => String(w.name || w.word || '').trim());
    let bonds = [];
    try { bonds = (BONDS.groupList()||[]).map(g => String(g.name||'').trim()); } catch(e){ bonds = ['ERR '+e.message]; }
    return { orgNames, bonds };
  });

  const fail = [];
  const count = (arr, n) => arr.filter(x => x === n).length;

  // ---- Elements -> Bonds -------------------------------------------------
  await p.evaluate(() => {
    const built = (typeof ecBuildItem==='function') ? ecBuildItem('Guild','',0,'org')
      : { word:'Guild', cat:'org', sub:'', set:0, role:'word', scope:'story' };
    built.name = 'The Bakers Guild';
    state.prompt.words.push(built);
    if (typeof ensureSession==='function') ensureSession();
    if (state.session) state.session.words = state.prompt.words;
  });
  await p.waitForTimeout(800);
  let s = await snap();
  console.log('after an Elements group :', JSON.stringify(s));
  if (count(s.orgNames,'The Bakers Guild') !== 1) fail.push('the Elements group is not in the element list exactly once');
  if (count(s.bonds,'The Bakers Guild') !== 1) fail.push('an Elements group appears ' + count(s.bonds,'The Bakers Guild') + ' times in Bonds, wanted 1');

  // ---- Bonds -> Elements -------------------------------------------------
  const made = await p.evaluate(() => {
    try {
      const ek = window.dystEnsureGroupElement ? window.dystEnsureGroupElement('The Night Court') : null;
      const k = 'dystoria.bonds.v1.' + state.session.id;
      const st = JSON.parse(localStorage.getItem(k) || '{}');
      st.groups = st.groups || [];
      st.groups.push({ id:'gtest1', name:'The Night Court', type:'political', members:[], el:ek });
      localStorage.setItem(k, JSON.stringify(st));
      return ek || '(no element key)';
    } catch(e){ return 'ERR ' + e.message; }
  });
  await p.waitForTimeout(800);
  s = await snap();
  console.log('after a Bonds group     :', JSON.stringify(s), ' element key:', made);
  if (count(s.orgNames,'The Night Court') !== 1) fail.push('a Bonds group appears ' + count(s.orgNames,'The Night Court') + ' times in Elements, wanted 1');
  if (count(s.bonds,'The Night Court') !== 1) fail.push('a Bonds group appears ' + count(s.bonds,'The Night Court') + ' times in Bonds, wanted 1 (the dedupe failed)');

  // ---- idempotence -------------------------------------------------------
  await p.evaluate(() => { if (window.dystEnsureGroupElement) window.dystEnsureGroupElement('The Night Court'); });
  await p.waitForTimeout(500);
  s = await snap();
  if (count(s.orgNames,'The Night Court') !== 1) fail.push('making the same group twice made two elements');

  // ---- the notepad actually lists it ------------------------------------
  // The first cut of this queried '#npElements .npc-pill' with the notepad shut,
  // got an empty list, and skipped its own assertion — measuring nothing and
  // reporting a pass. The notepad is opened and its Group filter clicked, and the
  // check REQUIRES the list to be non-empty before it will believe an absence.
  const np = await p.evaluate(async () => {
    document.body.classList.add('np-open','pad-open');
    if (typeof renderNpElements === 'function') renderNpElements();
    await new Promise(r => setTimeout(r, 500));
    const gb = [...document.querySelectorAll('#npElements button')].find(x => x.textContent.trim() === 'Group');
    if (gb) gb.click();
    await new Promise(r => setTimeout(r, 600));
    const txt = [...document.querySelectorAll('#npElements button, #npElements span')]
      .map(x => x.textContent.trim()).filter(Boolean);
    return { hasGroupFilter: !!gb, items: txt.length, all: txt.join(' | ') };
  });
  console.log('notepad: Group filter', np.hasGroupFilter, '·', np.items, 'items');
  if (!np.hasGroupFilter) fail.push('the notepad has no Group filter — an org element should create one');
  if (!np.items) fail.push('the notepad listed nothing — this check is measuring nothing');
  else {
    if (!/Night Court/.test(np.all)) fail.push('the Bonds group did not reach the notepad');
    if (!/Bakers Guild/.test(np.all)) fail.push('the Elements group did not reach the notepad');
  }

  // ---- two groups of the same KIND must be two elements -------------------
  // Found while building this and OLDER than it: wordKey is set|cat|word and
  // carries no name, so "The Bakers Guild" and "The Masons Guild" both keyed
  // 0|org|Guild on v.556 — one notepad, one row in the wiki, one membership.
  const twins = await p.evaluate(() => {
    const mk = n => { const w = ecBuildItem('Guild','',0,'org'); w.name = n;
      if (typeof ensureDistinctBeing === 'function') ensureDistinctBeing(w);
      state.prompt.words.push(w); return wordKey(w); };
    const a = mk('The Coopers Guild'), b2 = mk('The Masons Guild');
    if (state.session) state.session.words = state.prompt.words;
    let list = []; try { list = (BONDS.groupList()||[]).map(g=>g.name); } catch(e){}
    return { a, b:b2, collide:a===b2,
             bothInBonds: list.includes('The Coopers Guild') && list.includes('The Masons Guild') };
  });
  console.log('two same-kind groups   :', JSON.stringify(twins));
  if (twins.collide) fail.push('two groups of the same kind share one element key (' + twins.a + ')');
  if (!twins.bothInBonds) fail.push('two same-kind groups do not both reach Bonds');

  if (errs.length) fail.push('page errors: ' + errs.slice(0,3).join(' | '));
  console.log(fail.length ? '\nFAIL\n  - '+fail.join('\n  - ') : '\ngroupsync: all clear');
  await b.close();
  process.exit(fail.length?1:0);
})();
