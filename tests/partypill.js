// A party is a group you can link to.  (v.559 placement → v.560 the group row)
//
// v.559 put the party pill in the Context rail's Groups section. v.560 replaced
// the pill with a real group row, because everything Jeremy asked for next —
// click to see its connections, drag one out — is keyed by a word index, so the
// party had to own a group element, and once it did the row came free.
//
// WHAT THIS HARNESS IS GUARDING AGAINST, in order of how easily it would happen:
//   · the party listed TWICE (a chip beside its row; two readings in Bonds)
//   · a row that is present but not usable — no port, no arc, nothing to drag
//   · the element outliving its party, or worse, taking a group the writer made
//     themselves with it when the party is disbanded
//   · the pill body still exploding, which is the gesture Jeremy asked to retire
// Every one of them passes a "does the element exist" test, so nothing here
// asserts existence alone: the row is CLICKED, the connection is DRAGGED with a
// real pointer, and the counts are counts.
const { chromium } = require('playwright');
const FILE = process.argv[2] || (__dirname + '/../out.html');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  const NOISE = /ERR_TUNNEL|Failed to load resource|URL scheme "file"|posthog|CORS policy/;   // file:// origin noise, not the app
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push('console: ' + m.text()); });

  const fail = [];
  const ok = (c, m) => { if (!c) fail.push(m); };

  const boot = async (page) => {
    await page.goto('file://' + FILE); await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const f = document.getElementById('landingFrame'); if (f) f.remove();
      try { localStorage.setItem('dystoria_entered', '1'); localStorage.setItem('dystoria.onboarding', 'off'); } catch (e) {}
    });
    await page.reload(); await page.waitForTimeout(3200);
    await page.evaluate(() => {
      try {
        if (!loadSessions().some(x => x.id === '.s_hansel_demo') && window.buildHanselSession) {
          const l = loadSessions(); l.unshift(window.buildHanselSession()); persistSessions(l);
        }
        openSession('.s_hansel_demo');
      } catch (e) {}
    });
    await page.waitForTimeout(1800);
    await page.evaluate(() => { try { toPlan(); } catch (e) {} });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const t = [].slice.call(document.querySelectorAll('.pl-segbtn'))
        .find(e => /^map$/i.test((e.textContent || '').trim()));
      if (t) t.click();
    });
    await page.waitForTimeout(1400);
  };

  await boot(p);

  const made = await p.evaluate(() => {
    const keys = (state.nodes || []).filter(n => n && n.role === 'being').map(n => wordKey(n));
    if (keys.length < 3) return { err: 'only ' + keys.length + ' beings on this section' };
    const id = makeBeingGroup(keys[0], 'The Test Party', 0, null, null);
    const g = beingGroupById(id);
    if (g) g.members = [keys[1], keys[2]];
    renderConstellation();
    return { id: id, leader: keys[0], n: (beingGroupsList() || []).length };
  });
  ok(!made.err, 'could not make a party: ' + made.err);
  ok(made.n === 1, 'expected exactly one party, got ' + made.n);
  await p.waitForTimeout(1800);

  // ---- 1. the party owns a group element, and says so both ways -----------
  const own = await p.evaluate(() => {
    const g = beingGroupsList()[0] || {};
    const words = (state.prompt && state.prompt.words) || [];
    const idx = words.findIndex(w => w && wordKey(w) === g.el);
    const w = idx >= 0 ? words[idx] : null;
    return { el: g.el || null, idx: idx, cat: w && w.cat, name: w && w.name,
             partyOf: w && w.partyOf, partyMade: !!(w && w.partyMade),
             orgs: words.filter(x => x && x.cat === 'org').length };
  });
  ok(!!own.el, 'the party has no group element');
  ok(own.idx >= 0, 'the party points at an element that is not in the word list');
  ok(own.cat === 'org', 'the party element is cat "' + own.cat + '", not org');
  ok(own.name === 'The Test Party', 'the element is named "' + own.name + '"');
  ok(own.partyOf === made.id, 'the element does not point back at its party');
  ok(own.partyMade === true, 'the element is not marked as one this system made');
  ok(own.orgs === 1, 'expected exactly 1 org element, got ' + own.orgs);

  // ---- 2. it is an ordinary group row, listed exactly once ----------------
  const row = await p.evaluate((idx) => {
    const r = document.querySelector('#expLORows .xb-row[data-ci="' + idx + '"]');
    if (!r) return { err: 'no row in the Groups section' };
    const rect = r.getBoundingClientRect();
    const nm = r.querySelector('.xb-nm');
    const ex = r.querySelector('.xb-ex');
    const port = document.querySelector('#expRight .xb-portlayer .xb-port[data-ci="' + idx + '"]');
    const mid = document.elementFromPoint(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
    return { err: null,
             text: (nm ? nm.textContent : '').trim(),
             isParty: r.classList.contains('xb-party'),
             rows: document.querySelectorAll('#expLORows .xb-row').length,
             chipsInRail: document.querySelectorAll('#expRight #groupsBar .group-chip').length,
             barParent: (document.getElementById('groupsBar') || { parentNode: {} }).parentNode.id,
             hasEx: !!ex, exBox: ex ? Math.round(ex.getBoundingClientRect().width) : 0,
             hasPort: !!port,
             rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
             hitOwn: !!(mid && r.contains(mid)) };
  }, own.idx);
  ok(!row.err, 'row: ' + row.err);
  if (!row.err) {
    ok(/^The Test Party · 3$/.test(row.text), 'the row reads "' + row.text + '" (want name · headcount)');
    ok(row.isParty, 'the row is not marked .xb-party');
    ok(row.rows === 1, 'the Groups section holds ' + row.rows + ' rows, expected 1');
    ok(row.chipsInRail === 0, 'the retired party chip is still drawn in the rail (' + row.chipsInRail + ')');
    ok(row.barParent === 'mapHead', '#groupsBar is not back on the map floor (parent: ' + row.barParent + ')');
    ok(row.hasEx, 'no explode/combine control on the row');
    ok(row.exBox >= 10, 'the explode control has no box (' + row.exBox + 'px wide)');
    ok(row.hasPort, 'the row has no connection port — it cannot be linked');
    ok(row.rect.x > 1100 && row.rect.w > 40 && row.rect.h >= 16, 'row box looks wrong: ' + JSON.stringify(row.rect));
    ok(row.hitOwn, 'something is covering the row at its own centre');
  }

  // From here on every check drives the row with a real pointer, so there has to
  // BE one. On a build without it, say so once and stop rather than timing out
  // inside a click — a harness that dies is a harness with no verdict.
  const usable = own.idx >= 0 && !row.err && row.hasEx && row.hasPort;
  if (!usable) {
    fail.push('no usable party row — steps 3-9 not run (idx ' + own.idx + ', err ' + row.err + ')');
    console.log('FAIL ' + fail.length);
    fail.forEach(f => console.log('  \u00b7 ' + f));
    await b.close();
    process.exit(1);
  }

  // ---- 3. clicking the pill SELECTS it (and does not explode) -------------
  const before = await p.evaluate(() => (beingGroupsList()[0] || {}).exploded === true);
  ok(before === false, 'the party started exploded');
  await p.click('#expLORows .xb-row[data-ci="' + own.idx + '"] .xb-nm');
  await p.waitForTimeout(700);
  const clicked = await p.evaluate((idx) => {
    const r = document.querySelector('#expLORows .xb-row[data-ci="' + idx + '"]');
    const acts = r && r.parentNode.querySelector('.xb-acts');
    const port = document.querySelector('#expRight .xb-portlayer .xb-port[data-ci="' + idx + '"]');
    return { sel: !!(r && r.classList.contains('sel')),
             exploded: (beingGroupsList()[0] || {}).exploded === true,
             acts: !!acts,
             titles: acts ? [].slice.call(acts.querySelectorAll('button')).map(b => b.title) : [],
             portVis: port ? getComputedStyle(port).visibility : null };
  }, own.idx);
  ok(clicked.exploded === false, 'clicking the pill exploded the party — that gesture was retired');
  ok(clicked.sel === true, 'clicking the pill did not select the party');
  ok(clicked.acts === true, 'no action row appeared under the selected party');
  ok(clicked.titles.some(t => /Edit who is in this party/i.test(t)),
     'the action row does not offer to edit membership: ' + JSON.stringify(clicked.titles));
  ok(clicked.portVis === 'visible', 'the connection port is ' + clicked.portVis + ' on a selected party');

  // ---- 4. dragging the row onto a map element makes a real connection -----
  const geo = await p.evaluate((idx) => {
    const nmEl = document.querySelector('#expLORows .xb-row[data-ci="' + idx + '"] .xb-nm');
    const rr = nmEl ? nmEl.getBoundingClientRect() : null;
    const svg = document.getElementById('skySvg'); const r = svg.getBoundingClientRect();
    const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    const g = beingGroupsList()[0]; const inP = [g.leader].concat(g.members || []);
    let tj = -1, bd = 1e9;
    (state.nodes || []).forEach((n, j) => {
      const w = state.prompt.words[j];
      if (!w || (w.cat !== 'setting' && w.cat !== 'object') || w.role !== 'word' || w.needsPlace) return;
      if (inP.indexOf(wordKey(w)) >= 0) return;
      const sx = r.left + (n.x - vb[0]) / vb[2] * r.width, sy = r.top + (n.y - vb[1]) / vb[3] * r.height;
      if (sx < 60 || sx > 1250 || sy < 200 || sy > 880) return;            // reachable on this viewport
      const d = Math.hypot(sx - 700, sy - 500); if (d < bd) { bd = d; tj = j; }
    });
    const nd = tj >= 0 ? state.nodes[tj] : null;
    return { row: rr ? { x: rr.x + rr.width / 2, y: rr.y + rr.height / 2 } : null, tj: tj,
             tgt: nd ? { x: r.left + (nd.x - vb[0]) / vb[2] * r.width, y: r.top + (nd.y - vb[1]) / vb[3] * r.height } : null,
             before: (state.prompt.links || []).length };
  }, own.idx);
  ok(!!(geo.row && geo.tgt), 'no draggable row or no reachable map element to drop on');
  if (geo.row && geo.tgt) {
    await p.mouse.move(geo.row.x, geo.row.y);
    await p.mouse.down();
    await p.mouse.move(geo.row.x - 60, geo.row.y + 10, { steps: 6 });
    const mid = await p.evaluate(() => ({ linking: document.body.classList.contains('expb-linking') }));
    ok(mid.linking === true, 'dragging the party row did not start a link');
    await p.mouse.move(geo.tgt.x, geo.tgt.y, { steps: 14 });
    await p.waitForTimeout(250);
    await p.mouse.up();
    await p.waitForTimeout(1200);
  }
  const linked = await p.evaluate((g) => {
    const links = state.prompt.links || [];
    const gp = beingGroupsList()[0];
    const idx = (state.prompt.words || []).findIndex(w => w && wordKey(w) === gp.el);
    return { total: links.length,
             party: links.filter(l => (l.a === idx && l.b === g.tj) || (l.a === g.tj && l.b === idx)).length };
  }, geo);
  ok(linked.total === geo.before + 1, 'the drag made ' + (linked.total - geo.before) + ' links, expected 1');
  ok(linked.party === 1, 'the connection is not between the party and the element it was dropped on');

  // ---- 5. the explode control, and only it, explodes ----------------------
  await p.click('#expLORows .xb-row[data-ci="' + own.idx + '"] .xb-ex');
  await p.waitForTimeout(900);
  const blown = await p.evaluate((idx) => {
    const r = document.querySelector('#expLORows .xb-row[data-ci="' + idx + '"]');
    const ex = r && r.querySelector('.xb-ex');
    return { exploded: (beingGroupsList()[0] || {}).exploded === true,
             on: !!(r && r.classList.contains('xb-party-on')),
             title: ex ? (ex.getAttribute('title') || ex.getAttribute('data-tip') || ex.getAttribute('aria-label') || '') : '' };
  }, own.idx);
  ok(blown.exploded === true, 'the explode control did not explode the party');
  ok(blown.on === true, 'the row did not take its exploded class');
  ok(/combine/i.test(blown.title), 'the control still offers to explode after exploding: "' + blown.title + '"');
  await p.click('#expLORows .xb-row[data-ci="' + own.idx + '"] .xb-ex');
  await p.waitForTimeout(800);
  ok(await p.evaluate(() => (beingGroupsList()[0] || {}).exploded === false),
     'the control did not combine the party back');

  // ---- 6. the map connects the PARTY, not its leader ----------------------
  const mapDrag = await p.evaluate(() => {
    const g = beingGroupsList()[0];
    const li = (state.nodes || []).findIndex(n => n && n.role === 'being' && wordKey(n) === g.leader);
    state.selNode = li; renderConstellation();
    return { li };
  });
  await p.waitForTimeout(900);
  const mg = await p.evaluate((li) => {
    const g = document.querySelector('#skySvg g.node[data-node="' + li + '"]');
    if (!g) return { err: 'the party leader has no node' };
    let host = null;
    [].slice.call(g.querySelectorAll('title')).forEach(t => { if (!host && /connect the party/i.test(t.textContent)) host = t.parentNode; });
    if (!host) return { err: 'no "connect the party" control on the selected party', titles: [].slice.call(g.querySelectorAll('title')).map(t => t.textContent) };
    const r = host.getBoundingClientRect();
    const svg = document.getElementById('skySvg'); const rr = svg.getBoundingClientRect();
    const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    const gp = beingGroupsList()[0]; const inP = [gp.leader].concat(gp.members || []);
    const idx = (state.prompt.words || []).findIndex(w => w && wordKey(w) === gp.el);
    let tj = -1, bd = 1e9;
    (state.nodes || []).forEach((n, j) => {
      const w = state.prompt.words[j];
      if (!w || (w.cat !== 'setting' && w.cat !== 'object') || w.role !== 'word' || w.needsPlace) return;
      if (inP.indexOf(wordKey(w)) >= 0) return;
      if ((state.prompt.links || []).some(l => (l.a === idx && l.b === j) || (l.a === j && l.b === idx))) return;   // one it is not already tied to
      const sx = rr.left + (n.x - vb[0]) / vb[2] * rr.width, sy = rr.top + (n.y - vb[1]) / vb[3] * rr.height;
      if (sx < 60 || sx > 1250 || sy < 200 || sy > 880) return;
      const d = Math.hypot(sx - 700, sy - 500); if (d < bd) { bd = d; tj = j; }
    });
    const nd = tj >= 0 ? state.nodes[tj] : null;
    return { err: null, btn: { x: r.x + r.width / 2, y: r.y + r.height / 2 }, tj: tj, idx: idx, li: li,
             tgt: nd ? { x: rr.left + (nd.x - vb[0]) / vb[2] * rr.width, y: rr.top + (nd.y - vb[1]) / vb[3] * rr.height } : null };
  }, mapDrag.li);
  ok(!mg.err, 'map: ' + mg.err + (mg.titles ? ' — ' + JSON.stringify(mg.titles) : ''));
  if (!mg.err && mg.tgt) {
    await p.mouse.move(mg.btn.x, mg.btn.y); await p.mouse.down();
    await p.mouse.move(mg.btn.x + 20, mg.btn.y + 20, { steps: 5 });
    await p.mouse.move(mg.tgt.x, mg.tgt.y, { steps: 16 });
    await p.waitForTimeout(250);
    await p.mouse.up(); await p.waitForTimeout(1400);
    const after = await p.evaluate((d) => {
      const links = state.prompt.links || [];
      return { party: links.filter(l => (l.a === d.idx && l.b === d.tj) || (l.a === d.tj && l.b === d.idx)).length,
               leader: links.filter(l => (l.a === d.li && l.b === d.tj) || (l.a === d.tj && l.b === d.li)).length };
    }, mg);
    ok(after.party === 1, 'the map control did not connect the party (' + after.party + ')');
    ok(after.leader === 0, 'the map control connected the LEADER instead of the party');
  }

  // ---- 7. Bonds reads it once, and does not copy it -----------------------
  const bonds = await p.evaluate(() => {
    let list = [], stored = [];
    try { list = (BONDS.groupList() || []).map(g => ({ id: g.id, name: g.name, type: g.type, n: (g.members || []).length })); }
    catch (e) { list = [{ id: 'ERR ' + e.message }]; }
    try { const s = JSON.parse(localStorage.getItem('dystoria.bonds.v1.' + (typeof storyId === 'function' ? storyId() : '')) || '{}');
      stored = ((s && s.groups) || []).map(g => g.id); } catch (e) {}
    return { list, stored };
  });
  const parties = bonds.list.filter(g => /^src:party:/.test(g.id));
  const charts = bonds.list.filter(g => /^src:chart:/.test(g.id));
  ok(parties.length === 1, 'Bonds shows ' + parties.length + ' party groups: ' + JSON.stringify(bonds.list));
  ok(charts.length === 0, 'the party element is ALSO read as a chart group — it is listed twice: ' + JSON.stringify(bonds.list));
  if (parties[0]) {
    ok(parties[0].type === 'social', 'the party is type "' + parties[0].type + '", not social');
    ok(parties[0].n === 4, 'the party carries ' + parties[0].n + ' members in Bonds (3 people + its own group element)');
    ok(bonds.stored.indexOf(parties[0].id) < 0, 'the party was COPIED into the Bonds store — it must only be read');
  }

  // ---- 8. renaming the party renames its element -------------------------
  await p.evaluate(() => {
    const g = beingGroupsList()[0]; g.name = 'The Renamed Party';
    renderConstellation();
  });
  await p.waitForTimeout(1200);
  const renamed = await p.evaluate(() => {
    const g = beingGroupsList()[0];
    const w = (state.prompt.words || []).find(x => x && wordKey(x) === g.el);
    const r = document.querySelector('#expLORows .xb-row .xb-nm');
    return { name: w && w.name, row: r ? r.textContent.trim() : null,
             orgs: (state.prompt.words || []).filter(x => x && x.cat === 'org').length };
  });
  ok(renamed.name === 'The Renamed Party', 'the element kept the old name: "' + renamed.name + '"');
  ok(/^The Renamed Party/.test(renamed.row || ''), 'the row still reads "' + renamed.row + '"');
  ok(renamed.orgs === 1, 'renaming made a second element (' + renamed.orgs + ' orgs)');

  // ---- 8b. the element follows the party's SECTIONS ----------------------
  // Found by walking the frames rather than by looking at one: the element was
  // pushed into whichever section the writer was standing on, so a party three
  // sections long had a cluster on the map and no row in the drawer on two of
  // them. from/until/excl say where a party exists; the element follows.
  const spread = await p.evaluate(() => {
    const g = beingGroupsList()[0];
    return { frames: (state.frames || []).length,
             on: (state.frames || []).map((fr, i) => ({
               sec: i,
               active: beingGroupActiveHere(g, i),
               has: (((fr.prompt || {}).words) || []).some(w => w && wordKey(w) === g.el) })) };
  });
  ok(spread.frames > 1, 'the fixture has only ' + spread.frames + ' section — this check proves nothing');
  spread.on.forEach(f => ok(f.active === f.has,
    'section ' + f.sec + ': party active=' + f.active + ' but its element present=' + f.has));

  // and it withdraws from sections the party leaves
  await p.evaluate(() => { const g = beingGroupsList()[0]; g.from = 2; g.until = 4; renderConstellation(); });
  await p.waitForTimeout(1400);
  const scoped = await p.evaluate(() => {
    const g = beingGroupsList()[0];
    return (state.frames || []).map((fr, i) => ({ sec: i, active: beingGroupActiveHere(g, i),
      has: (((fr.prompt || {}).words) || []).some(w => w && wordKey(w) === g.el) }));
  });
  scoped.forEach(f => ok(f.active === f.has,
    'after narrowing to sections 2-3, section ' + f.sec + ': active=' + f.active + ' present=' + f.has));
  await p.evaluate(() => { const g = beingGroupsList()[0]; g.from = 0; g.until = null; renderConstellation(); });
  await p.waitForTimeout(1200);

  // ---- 9. disbanding takes the element it made with it -------------------
  await p.evaluate(() => {
    const g = beingGroupsList()[0]; dissolveBeingGroup(g.id);
    renderConstellation();
  });
  await p.waitForTimeout(1400);
  const gone = await p.evaluate(() => {
    let bl = [];
    try { bl = (BONDS.groupList() || []).map(g => g.id); } catch (e) {}
    return { parties: (beingGroupsList() || []).length,
             orgs: (state.prompt.words || []).filter(w => w && w.cat === 'org').length,
             rows: document.querySelectorAll('#expLORows .xb-row').length,
             inBonds: bl.filter(id => /^src:party:/.test(id)).length };
  });
  ok(gone.parties === 0, 'the party survived being disbanded');
  ok(gone.orgs === 0, 'disbanding left its group element behind (' + gone.orgs + ')');
  ok(gone.rows === 0, 'the Groups section still lists ' + gone.rows + ' rows');
  ok(gone.inBonds === 0, 'the party is still in Bonds after being disbanded');

  // ---- 10. a group the WRITER made is adopted, never deleted -------------
  const adopt = await p.evaluate(() => {
    window.dystEnsureGroupElement('The Bakers Guild');
    const keys = (state.nodes || []).filter(n => n && n.role === 'being').map(n => wordKey(n));
    const id = makeBeingGroup(keys[0], 'The Bakers Guild', 0, null, null);
    const g = beingGroupById(id); if (g) g.members = [keys[1]];
    renderConstellation();
    return { id };
  });
  await p.waitForTimeout(1500);
  const adopted = await p.evaluate(() => {
    const g = beingGroupsList()[0] || {};
    const w = (state.prompt.words || []).find(x => x && wordKey(x) === g.el);
    return { orgs: (state.prompt.words || []).filter(x => x && x.cat === 'org').length,
             made: !!(w && w.partyMade), partyOf: w && w.partyOf };
  });
  ok(adopted.orgs === 1, 'the party made a twin of the writer\'s own group (' + adopted.orgs + ' orgs)');
  ok(adopted.made === false, 'an adopted group is marked as one this system made — disbanding would delete it');
  ok(adopted.partyOf === adopt.id, 'the adopted group does not point at its party');
  await p.evaluate(() => { const g = beingGroupsList()[0]; dissolveBeingGroup(g.id); renderConstellation(); });
  await p.waitForTimeout(1400);
  const kept = await p.evaluate(() => ({
    parties: (beingGroupsList() || []).length,
    orgs: (state.prompt.words || []).filter(w => w && w.cat === 'org').length }));
  ok(kept.parties === 0, 'the adopted party survived being disbanded');
  ok(kept.orgs === 1, 'disbanding deleted the group the WRITER made (' + kept.orgs + ' orgs left)');

  await p.screenshot({ path: __dirname + '/../shots/partypill.png' }).catch(() => {});
  await p.close();

  // ---- 11. below 768px there is no rail, so the chip is still the way in --
  const ph = await ctx.newPage();
  ph.on('pageerror', e => errs.push('phone: ' + String(e)));
  await ph.setViewportSize({ width: 390, height: 820 });
  await ph.goto('file://' + FILE); await ph.waitForTimeout(2500);
  await ph.evaluate(() => { const f = document.getElementById('landingFrame'); if (f) f.remove();
    try { localStorage.setItem('dystoria_entered', '1'); localStorage.setItem('dystoria.onboarding', 'off'); } catch (e) {} });
  await ph.reload(); await ph.waitForTimeout(3500);
  const phone = await ph.evaluate(() => ({
    expb: document.body.classList.contains('expb'),
    barParent: (document.getElementById('groupsBar') || { parentNode: {} }).parentNode.id }));
  ok(phone.expb === false, 'the phone entered the desktop map layer');
  ok(phone.barParent === 'mapHead', 'the phone lost its party bar (parent: ' + phone.barParent + ')');
  await ph.close();

  await b.close();

  console.log(fail.length ? 'FAIL ' + fail.length : 'PASS');
  fail.forEach(f => console.log('  · ' + f));
  if (errs.length) { console.log('page errors:'); errs.slice(0, 8).forEach(e => console.log('  ! ' + e)); }
  process.exit(fail.length || errs.length ? 1 : 0);
})();
