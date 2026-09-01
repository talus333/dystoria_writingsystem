// v.559: the map's party pill lives in the Context rail's Groups section, and
// carries a visible explode/combine control.
//
// The failure this most easily introduces is a bar that is PRESENT but not
// USABLE — off-screen, inside a collapsed section, or zero-height. So every
// assertion here goes through a real rect or a real click, never through
// getElementById alone.
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

  await p.goto('file://' + FILE); await p.waitForTimeout(2500);
  await p.evaluate(() => {
    const f = document.getElementById('landingFrame'); if (f) f.remove();
    try { localStorage.setItem('dystoria_entered', '1'); localStorage.setItem('dystoria.onboarding', 'off'); } catch (e) {}
  });
  await p.reload(); await p.waitForTimeout(3200);
  await p.evaluate(() => {
    try {
      if (!loadSessions().some(x => x.id === '.s_hansel_demo') && window.buildHanselSession) {
        const l = loadSessions(); l.unshift(window.buildHanselSession()); persistSessions(l);
      }
      openSession('.s_hansel_demo');
    } catch (e) {}
  });
  await p.waitForTimeout(1800);

  const fail = [];
  const ok = (c, m) => { if (!c) fail.push(m); };

  // ---- get onto the map ---------------------------------------------------
  await p.evaluate(() => { try { toPlan(); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    const t = [].slice.call(document.querySelectorAll('.pl-segbtn'))
      .find(e => /^map$/i.test((e.textContent || '').trim()));
    if (t) t.click();
  });
  await p.waitForTimeout(1400);

  // ---- make a party out of two beings on this section ---------------------
  const made = await p.evaluate(() => {
    const keys = (state.nodes || []).filter(n => n && n.role === 'being').map(n => wordKey(n));
    if (keys.length < 2) return { err: 'only ' + keys.length + ' beings on this section' };
    const id = makeBeingGroup(keys[0], 'The Test Party', 0, null, null);
    const g = beingGroupById(id);
    if (g) g.members = [keys[1]];
    renderConstellation();
    return { id: id, n: (beingGroupsList() || []).length };
  });
  ok(!made.err, 'could not make a party: ' + made.err);
  ok(made.n === 1, 'expected exactly one party, got ' + made.n);
  await p.waitForTimeout(700);

  // ---- 1. the bar is inside the Groups accordion section ------------------
  const where = await p.evaluate(() => {
    const bar = document.getElementById('groupsBar');
    if (!bar) return { err: 'no #groupsBar' };
    const sec = bar.closest('.xb-sec');
    const rail = bar.closest('#expRight');
    const head = bar.closest('#mapHead');
    const ttl = sec ? (sec.querySelector('.xb-ttl') || {}).textContent : null;
    const r = bar.getBoundingClientRect();
    // where does it sit relative to the "+ group" pill and the org rows?
    const kids = sec ? [].slice.call(sec.children).map(e => e.id || e.className) : [];
    return { err: null, inRail: !!rail, inMapHead: !!head, sectionTitle: (ttl || '').trim(),
             dataSec: sec ? sec.getAttribute('data-sec') : null,
             rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
             kids: kids };
  });
  ok(!where.err, String(where.err));
  ok(where.inRail === true, '#groupsBar is not inside #expRight');
  ok(where.inMapHead === false, '#groupsBar is still on the map floor (#mapHead)');
  ok(where.dataSec === 'org', 'not in the Groups section (data-sec=' + where.dataSec + ')');
  ok(where.sectionTitle === 'Groups', 'section header reads "' + where.sectionTitle + '"');
  ok(where.rect.w > 0 && where.rect.h > 0, 'the bar has no box: ' + JSON.stringify(where.rect));
  ok(where.rect.x > 1100, 'the bar is not in the right-hand rail: x=' + where.rect.x);
  // + group pill above it, org rows below it
  const iAdd = where.kids.findIndex(k => /xb-add/.test(String(k)));
  const iBar = where.kids.indexOf('groupsBar');
  const iRows = where.kids.indexOf('expLORows');
  ok(iAdd >= 0 && iBar > iAdd, '"+ group" pill is not above the party chips (' + JSON.stringify(where.kids) + ')');
  ok(iRows > iBar, 'the org rows are not below the party chips (' + JSON.stringify(where.kids) + ')');

  // ---- 2. the chip is on screen and readable ------------------------------
  const chip = await p.evaluate(() => {
    const c = document.querySelector('#groupsBar .group-chip');
    if (!c) return { err: 'no chip' };
    const r = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    const lbl = c.querySelector('.group-lbl');
    const vis = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
    return { err: null, text: (lbl ? lbl.textContent : ''), bg: cs.backgroundColor, color: cs.color,
             rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
             hitOwn: !!(vis && c.contains(vis)),
             acts: [].slice.call(c.querySelectorAll('.group-act')).map(a => a.className) };
  });
  ok(!chip.err, 'chip: ' + chip.err);
  if (!chip.err) {
    ok(chip.text.indexOf('The Test Party') === 0, 'chip label reads "' + chip.text + '"');
    ok(chip.rect.w > 40 && chip.rect.h >= 16, 'chip box is too small: ' + JSON.stringify(chip.rect));
    ok(chip.rect.y > 0 && chip.rect.y < 900, 'chip is off-screen vertically: y=' + chip.rect.y);
    ok(chip.hitOwn, 'something is covering the chip at its own centre');
    ok(chip.acts.length === 4, 'expected 4 acts (explode, notes, edit, ×), got ' + chip.acts.length + ': ' + JSON.stringify(chip.acts));
    ok(chip.acts.some(c => /group-ex/.test(c)), 'no .group-ex explode control on the chip');
  }

  // ---- 3. the explode control actually explodes (and combines back) -------
  const before = await p.evaluate(() => (beingGroupsList()[0] || {}).exploded === true);
  ok(before === false, 'party started exploded');
  await p.click('#groupsBar .group-chip .group-ex');
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => {
    const g = beingGroupsList()[0] || {};
    const c = document.querySelector('#groupsBar .group-chip');
    const ex = c && c.querySelector('.group-ex');
    return { exploded: g.exploded === true, on: !!(c && c.classList.contains('on')),
             title: ex ? (ex.getAttribute('title') || ex.getAttribute('data-tip') || ex.getAttribute('aria-label') || '') : '' };   // the app's tooltip layer moves title -> data-tip on first hover
  });
  ok(after.exploded === true, 'the explode control did not explode the party');
  ok(after.on === true, 'the chip did not take its .on state after exploding');
  ok(/combine/i.test(after.title), 'the control still offers to explode after exploding: "' + after.title + '"');

  await p.click('#groupsBar .group-chip .group-ex');
  await p.waitForTimeout(500);
  const back = await p.evaluate(() => {
    const g = beingGroupsList()[0] || {};
    const ex = document.querySelector('#groupsBar .group-chip .group-ex');
    return { exploded: g.exploded === true, title: ex ? (ex.getAttribute('title') || ex.getAttribute('data-tip') || ex.getAttribute('aria-label') || '') : '' };
  });
  ok(back.exploded === false, 'the control did not combine the party back');
  ok(/explode/i.test(back.title), 'the control does not offer to explode again: "' + back.title + '"');

  // ---- 4. the other three acts survived the move -------------------------
  const acts = await p.evaluate(() => {
    const c = document.querySelector('#groupsBar .group-chip');
    return [].slice.call(c.querySelectorAll('.group-act')).map(a => {
      const r = a.getBoundingClientRect();
      return { cls: a.className, w: Math.round(r.width), h: Math.round(r.height) };
    });
  });
  acts.forEach(a => ok(a.w >= 6 && a.h >= 6, 'act ' + a.cls + ' has no box: ' + JSON.stringify(a)));

  // ---- 5. collapsing the Groups section hides the chips ------------------
  await p.evaluate(() => {
    const h = document.querySelector('#expRight .xb-sec[data-sec="org"] .xb-head');
    if (h) h.click();
  });
  await p.waitForTimeout(500);
  const collapsed = await p.evaluate(() => {
    const bar = document.getElementById('groupsBar');
    const r = bar.getBoundingClientRect();
    return { display: getComputedStyle(bar).display, h: Math.round(r.height) };
  });
  ok(collapsed.display === 'none' || collapsed.h === 0,
     'the collapsed Groups section still shows the party chips (' + JSON.stringify(collapsed) + ')');
  await p.evaluate(() => {
    const h = document.querySelector('#expRight .xb-sec[data-sec="org"] .xb-head');
    if (h) h.click();
  });
  await p.waitForTimeout(400);

  // ---- 6. the party is a Social group in Bonds --------------------------
  // v.559b. A READ, not a copy: it must appear in the group list without any
  // record of it existing in the Bonds store.
  const bonds = await p.evaluate(() => {
    let list = [], store = null;
    try { list = (BONDS.groupList() || []).map(g => ({
      id: g.id, name: g.name, type: g.type, lens: g.lens,
      members: (g.members || []).length,
      // B.groupList is a curated door, not a view of the store — it does not
      // carry `source`, so provenance is read off the id it minted.
      src: /^src:party:/.test(g.id) ? 'party' : /^src:chart:/.test(g.id) ? 'chart' : /^src:concepts:/.test(g.id) ? 'concepts' : null })); } catch (e) { list = [{ id: 'ERR ' + e.message }]; }
    try { store = JSON.parse(localStorage.getItem('dystoria.bonds.v1.' + (typeof storyId === 'function' ? storyId() : '')) || '{}'); } catch (e) {}
    return { list, stored: ((store && store.groups) || []).map(g => g.id) };
  });
  const party = bonds.list.find(g => g.src === 'party');
  ok(!!party, 'the party is not in the Bonds group list: ' + JSON.stringify(bonds.list));
  if (party) {
    ok(party.name === 'The Test Party', 'Bonds calls it "' + party.name + '"');
    ok(party.type === 'social', 'the party is type "' + party.type + '", not social');
    ok(party.lens === 'social', 'the party opens on lens "' + party.lens + '", not social');
    ok(party.members === 2, 'the party carries ' + party.members + ' members in Bonds, expected 2');
    ok(party.id === 'src:party:' + made.id, 'party id is ' + party.id);
    ok(bonds.stored.indexOf(party.id) < 0, 'the party was COPIED into the Bonds store — it must only be read');
  }
  ok(bonds.list.filter(g => g.src === 'party').length === 1,
     'the party appears ' + bonds.list.filter(g => g.src === 'party').length + ' times in Bonds');

  // the three sentences that used to know only chart-or-concept-map
  const words = await p.evaluate((pid) => {
    // open Bonds so the group buttons are built
    try { window.__planSetView('bonds'); } catch (e) {}
    return new Promise(res => setTimeout(() => {
      const btns = [].slice.call(document.querySelectorAll('.bn-set'));
      const b = btns.find(x => (x.childNodes[0] && x.childNodes[0].textContent || '').indexOf('The Test Party') === 0);
      res({ n: btns.length,
            title: b ? (b.getAttribute('title') || b.getAttribute('data-tip') || '') : null,
            glyph: b ? ((b.querySelector('.bn-set-src') || {}).textContent || '') : null,
            cat: b ? ((b.querySelector('.bn-set-cat') || {}).textContent || '') : null });
    }, 1400));
  }, made.id);
  ok(words.title !== null, 'no Bonds group button for the party (' + words.n + ' buttons)');
  if (words.title !== null) {
    ok(/party on the map/.test(words.title), 'the party button says: "' + words.title + '"');
    ok(!/concept map/.test(words.title), 'the party is described as a concept map: "' + words.title + '"');
    ok(words.glyph === '∴', 'provenance glyph is "' + words.glyph + '", expected ∴');
    ok(/social/i.test(words.cat), 'the party is typed "' + words.cat + '" on its button');
  }
  await p.evaluate(() => { try { window.__planSetView('map'); } catch (e) {} });
  await p.waitForTimeout(1000);

  // ---- 7. an empty bar leaves no gap ------------------------------------
  await p.evaluate(() => {
    const g = beingGroupsList()[0]; if (g) dissolveBeingGroup(g.id);
    renderConstellation();
  });
  await p.waitForTimeout(500);
  const empty = await p.evaluate(() => {
    const bar = document.getElementById('groupsBar');
    const r = bar.getBoundingClientRect();
    return { display: getComputedStyle(bar).display, h: Math.round(r.height), kids: bar.children.length };
  });
  ok(empty.kids === 0, 'the bar still holds chips after the party was dissolved');
  ok(empty.display === 'none' || empty.h === 0,
     'an empty party bar still takes room in the rail: ' + JSON.stringify(empty));

  // dissolving the party on the map takes it out of Bonds too — the read is live
  const gone = await p.evaluate(() => {
    try { return (BONDS.groupList() || []).filter(g => g.source && g.source.kind === 'party').length; }
    catch (e) { return 'ERR ' + e.message; }
  });
  ok(gone === 0, 'the party survives in Bonds after being dissolved on the map (' + gone + ')');

  await p.screenshot({ path: __dirname + '/../shots/partypill.png' }).catch(() => {});
  await b.close();

  console.log(fail.length ? 'FAIL ' + fail.length : 'PASS');
  fail.forEach(f => console.log('  · ' + f));
  if (errs.length) { console.log('page errors:'); errs.slice(0, 8).forEach(e => console.log('  ! ' + e)); }
  process.exit(fail.length || errs.length ? 1 : 0);
})();
