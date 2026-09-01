/* t_bonds.js — a Bonds regression suite.
 *
 * NOT a restoration. The eleven harnesses named in
 * claude/Dystoria_Groups_As_Containers_Design.md §12 (229 assertions) were never
 * committed to the repo and are not in the project; they lived in an earlier
 * session's container and are gone. This is a NEW suite, written against two
 * things that do survive: the design docs' explicit claims, and BONDS.KINDS —
 * the app's own declared lens vocabulary, so the expectations are read off the
 * system rather than invented.
 *
 * VOCABULARY NOTE: the relation words are not free text. A first cut of this file
 * seeded 'Enemy of', which is in no family, and three assertions failed — the app
 * was right and the test was wrong. Enmity is Rivals / Competes with / Feuds with
 * / Betrays / Bound to destroy / Wounded by / Toys with / Haunts. Any new case
 * here must take its words from the FAMILIES table in the source, not from
 * plausible English.
 *
 * SEEDING NOTE, learned the hard way: BONDS.graph() merges five relationship
 * stores, and a bond written onto a pair that the story already relates is
 * silently outvoted — a first attempt "seeded" Hansel and Gretel and was reading
 * the story's own Devotion bond back. Every case here creates FRESH elements, so
 * what it asserts is what it wrote.
 *
 *   node tests/t_bonds.js [path/to/index.html]
 */
const { chromium } = require('playwright');
const FILE = process.argv[2] || (__dirname + '/../out.html');

let pass = 0; const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (got, want, label) => ok(got === want, label + ' (got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want) + ')');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:1500,height:900} });
  const p = await ctx.newPage();
  const errs = []; const NOISE = /ERR_TUNNEL|Failed to load resource|URL scheme "file"/;
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !NOISE.test(m.text())) errs.push(m.text()); });

  await p.goto('file://' + FILE); await p.waitForTimeout(2500);
  await p.evaluate(() => { const f=document.getElementById('landingFrame'); if(f) f.remove();
    try{ localStorage.setItem('dystoria_entered','1'); localStorage.setItem('dystoria.onboarding','off'); }catch(e){} });
  await p.reload(); await p.waitForTimeout(3200);
  await p.evaluate(() => { try{
    if(!loadSessions().some(x=>x.id==='.s_hansel_demo') && window.buildHanselSession){
      const l=loadSessions(); l.unshift(window.buildHanselSession()); persistSessions(l); }
    openSession('.s_hansel_demo'); }catch(e){} });
  await p.waitForTimeout(1800);

  // ---- the lens vocabulary itself -----------------------------------------
  const K = await p.evaluate(() => {
    const out = {}; Object.keys(BONDS.KINDS).forEach(k => {
      const v = BONDS.KINDS[k];
      out[k] = { cats:v.cats, fams:(v.families && v.families['being|being']) || null };
    });
    return { kinds: (BONDS.kinds()||[]).map(x=>x.id||x), table: out };
  });
  ok(K.kinds.length === 7, 'seven lenses exist (got ' + K.kinds.length + ')');
  ok(K.kinds.indexOf('free') >= 0, 'the free lens exists — ALWAYS_LENS, guaranteed on every group');
  eq(K.table.free.cats, null, 'free admits every cast');
  eq(K.table.free.fams, null, 'free admits every relation family');
  ok((K.table.place.cats||[]).indexOf('being') < 0, 'the place blueprint does not admit people (§5: not-applicable is absent, not empty)');
  ok((K.table.faction.cats||[]).indexOf('being') >= 0, 'the faction chart admits beings (v.410 — a chain of command of people)');
  ok((K.table.family.fams||[]).join() === 'Kinship', 'the family tree admits Kinship only');
  ok((K.table.social.fams||[]).indexOf('Enmity') >= 0, 'the social web admits Enmity');

  // ---- one record, two dimensions, two lenses (§12's lens test) -----------
  const lensTest = await p.evaluate(() => {
    const mk = (w,n) => { const e = ecBuildItem(w,'',0,'being'); e.name = n; e.role = 'being';
      if (typeof ensureDistinctBeing==='function') ensureDistinctBeing(e);
      state.prompt.words.push(e); return wordKey(e); };
    const A = mk('Knight','Bonds Test A'), B = mk('Knight','Bonds Test B');
    if (typeof ensureSession==='function') ensureSession();
    state.session.words = state.prompt.words;
    state.session.bonds = state.session.bonds || [];
    const ka = A<B?A:B, kb = A<B?B:A;
    state.session.bonds.push({ a:ka, b:kb,
      fwd:{ type:'Mother of', dims:[{type:'Mother of'},{type:'Feuds with'}] }, rev:null });
    const at = k => { const g = BONDS.graph({ kind:k });
      const e = (g.edges||[]).find(x => (x.akey===ka&&x.bkey===kb)||(x.akey===kb&&x.bkey===ka));
      /* `type` is the pair's PRIMARY word; `kindType` is the dimension THIS LENS
         actually draws. §16 records the bug that came of confusing them — a social
         web over a family drew the betrayal and printed "Mother of" over it. */
      return e ? { drawn:e.kindType, primary:e.type, dims:(e.dims||[]).map(d=>d.type),
                   mood:e.mood ? (e.mood.type+'|'+e.mood.valence+'|'+e.mood.conflict) : '' } : null; };
    let sentence = '';
    try { const g = BONDS.graph({ kind:'free' });
      const e = (g.edges||[]).find(x => (x.akey===ka&&x.bkey===kb)||(x.akey===kb&&x.bkey===ka));
      if (e && typeof BONDS.readsAs==='function') sentence = String(BONDS.readsAs(e, ka)||''); } catch(e){}
    return { family:at('family'), social:at('social'), place:at('place'), free:at('free'), sentence };
  });

  ok(!!lensTest.family, 'the family tree draws a kinship bond');
  ok(!!lensTest.social, 'the social web draws the SAME record by its enmity dimension');
  eq(lensTest.family && lensTest.family.drawn, 'Mother of', 'family DRAWS the kinship dimension (kindType)');
  eq(lensTest.social && lensTest.social.drawn, 'Feuds with', 'social draws the enmity word from the same record');
  ok(lensTest.family && lensTest.social
     && lensTest.family.dims.join() === lensTest.social.dims.join(),
     'both lenses read ONE record — the dimension list is identical, only the drawn word differs');
  ok(lensTest.family && lensTest.social && lensTest.family.primary === lensTest.social.primary,
     'the pair keeps ONE primary word across lenses');
  /* §6: "the lens hides the other dimension's shape, never its temperature."
     Colour belongs to the pair, geometry to the lens — so mood must be byte-identical
     under a family tree and a social web, and a hostile bond inside a family stays
     visibly hostile without leaving the family tree. */
  ok(lensTest.family && lensTest.social && lensTest.family.mood === lensTest.social.mood,
     'mood is IDENTICAL across lenses — colour belongs to the pair (§6)');
  ok(lensTest.family && /conflict|true/.test(String(lensTest.family.mood)),
     'a feud inside a family tree still reads as conflict there (§13, the closed soft spot)');
  eq(lensTest.place, null, 'the place blueprint draws nothing between two people');
  ok(!!lensTest.free, 'the free lens draws it');
  ok(/\S/.test(lensTest.sentence), 'readsAs returns a sentence for the pair');

  // ---- conflict wins the mood outright (v.407) ----------------------------
  const mood = await p.evaluate(() => {
    const mk = (w,n) => { const e = ecBuildItem(w,'',0,'being'); e.name = n; e.role='being';
      if (typeof ensureDistinctBeing==='function') ensureDistinctBeing(e);
      state.prompt.words.push(e); return wordKey(e); };
    const A = mk('Knight','Mood A'), B = mk('Knight','Mood B');
    state.session.words = state.prompt.words;
    const ka = A<B?A:B, kb = A<B?B:A;
    state.session.bonds.push({ a:ka, b:kb,
      fwd:{ type:'Bound to destroy', dims:[{type:'Bound to destroy'},{type:'Mother of'}] }, rev:null });
    const g = BONDS.graph({ kind:'free' });
    const e = (g.edges||[]).find(x => (x.akey===ka&&x.bkey===kb)||(x.akey===kb&&x.bkey===ka));
    /* conflict lives on the MOOD, which is the pair's, not on the edge's own flag. */
    return e ? { conflict:!!(e.mood&&e.mood.conflict), mood:(e.mood&&e.mood.type)||'',
                 valence:(e.mood&&e.mood.valence)||'' } : null;
  });
  ok(!!mood, 'the conflict pair is in the graph');
  ok(mood && mood.conflict === true, 'a conflict bond is flagged as conflict whatever else it carries (v.407)');

  // ---- the invariant the design says it must never break -----------------
  const invariant = await p.evaluate(() => {
    const k = 'dystoria.bonds.v1.' + state.session.id;
    const s = JSON.parse(localStorage.getItem(k) || '{}');
    const bad = (s.groups||[]).filter(g => g && (g.edges || g.dims || g.bonds || g.relationships));
    return { groups:(s.groups||[]).length, holdingEdges:bad.length };
  });
  eq(invariant.holdingEdges, 0, 'NO group stores a relationship (§8 — the design has failed if one ever does)');

  // ---- every group offers the free lens, and the sync of v.557 -----------
  const gl = await p.evaluate(() => {
    /* Guarded: on a build before v.557 this helper does not exist, and an
       unguarded call THROWS — which aborts the whole run instead of failing one
       assertion, and makes the suite useless for bisecting an older build. */
    if (typeof window.dystEnsureGroupElement === 'function') window.dystEnsureGroupElement('Suite Order');
    const list = BONDS.groupList() || [];
    return { n:list.length, names:list.map(g=>g.name),
             hasHelper: typeof window.dystEnsureGroupElement === 'function',
             everyHasLens: list.every(g => !!g.lens),
             orgNames:(state.prompt.words||[]).filter(w=>w&&w.cat==='org').map(w=>w.name||w.word) };
  });
  ok(gl.n > 0, 'groupList returns groups');
  ok(gl.everyHasLens, 'every group resolves a lens');
  ok(gl.hasHelper, 'dystEnsureGroupElement exists (v.557 — the Bonds→Elements half of the sync)');
  ok(gl.names.indexOf('Suite Order') >= 0, 'an org element appears in Bonds as a group (v.557)');
  ok(gl.orgNames.indexOf('Suite Order') >= 0, 'and it is an element too (v.557)');
  eq(gl.names.filter(n=>n==='Suite Order').length, 1, 'it appears in Bonds exactly once');

  ok(errs.length === 0, 'no page errors (' + errs.slice(0,2).join(' | ') + ')');

  console.log('t_bonds: ' + pass + ' passed, ' + fails.length + ' failed  (' + require('path').basename(FILE) + ')');
  fails.forEach(f => console.log('  ✗ ' + f));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
