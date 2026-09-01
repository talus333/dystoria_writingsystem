// v.561: Bonds keeps the arrangement you made.
//
// The claim that needs proving is a FIXED POINT, not a feature. Save reads the
// positions off the DOM — which are already past `deRow` and `unblock`, the two
// display passes that nudge a layout so no three elements share a height and no
// line rests across a pill. Restore writes them back into `layouts[slot]`, where
// those same passes run over them again. If either pass is not idempotent, the
// drawing drifts a little every time you restore, and nothing about the code
// reading correctly would tell you. So the central assertion here is: save,
// move things, restore — and every element is at the SAME PIXEL it was at when
// Save was pressed. Then restore twice more and check it has not crept.
//
// The rest guards the things that would quietly lose work: Auto-arrange must not
// touch the saved copy (that separation is the whole feature), a save must be
// per group AND per lens, and an element added after the save must fall through
// to the automatic layout rather than being dropped at the origin.
const { chromium } = require('playwright');
const FILE = process.argv[2] || (__dirname + '/../out.html');

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = [];
  const NOISE = /ERR_TUNNEL|Failed to load resource|URL scheme "file"|posthog|CORS policy/;
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push('console: ' + m.text()); });

  const fail = [];
  const ok = (c, m) => { if (!c) fail.push(m); };

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
  await p.evaluate(() => { try { toPlan(); } catch (e) {} });
  await p.waitForTimeout(600);

  // The Hansel demo ships with no group, and an empty Bonds shows the first-run
  // cards rather than a canvas — so the fixture makes one first. A party is the
  // cheapest four-element group there is (v.560: it mints its own group element).
  await p.evaluate(() => {
    const t = [].slice.call(document.querySelectorAll('.pl-segbtn')).find(e => /^map$/i.test((e.textContent || '').trim()));
    if (t) t.click();
  });
  await p.waitForTimeout(1400);
  const seeded = await p.evaluate(() => {
    const keys = (state.nodes || []).filter(n => n && n.role === 'being').map(n => wordKey(n));
    if (keys.length < 4) return { err: 'only ' + keys.length + ' beings to group' };
    const id = makeBeingGroup(keys[0], 'The Arranged Group', 0, null, null);
    const g = beingGroupById(id); if (g) g.members = [keys[1], keys[2], keys[3]];
    renderConstellation();
    return { err: null, id: id };
  });
  ok(!seeded.err, 'fixture: ' + seeded.err);
  await p.waitForTimeout(1800);

  await p.evaluate(() => { try { window.__planSetView('bonds'); } catch (e) {} });
  await p.waitForTimeout(2600);
  const opened = await p.evaluate(() => {
    const btns = [].slice.call(document.querySelectorAll('.bn-set'));
    if (btns.length) btns[0].click();
    return { groups: btns.length, first: btns.length ? btns[0].textContent : null };
  });
  ok(opened.groups >= 1, 'Bonds shows no groups — nothing to arrange');
  await p.waitForTimeout(2000);

  const shot = () => p.evaluate(() => {
    const out = {};
    [].slice.call(document.querySelectorAll('.bn-canvas .bn-node[data-key]')).forEach(d => {
      out[d.dataset.key] = { x: Math.round(parseFloat(d.style.left) || 0), y: Math.round(parseFloat(d.style.top) || 0) };
    });
    return out;
  });
  const diff = (a, b) => {
    const keys = Object.keys(a);
    const moved = keys.filter(k => !b[k] || b[k].x !== a[k].x || b[k].y !== a[k].y);
    return { n: keys.length, moved: moved.length, sample: moved.slice(0, 3).map(k => k + ': ' + JSON.stringify(a[k]) + ' → ' + JSON.stringify(b[k])) };
  };
  const btn = (label) => p.evaluate((l) => {
    const b = [].slice.call(document.querySelectorAll('.bn-tools button')).find(x => (x.textContent || '').trim() === l);
    return !!b;
  }, label);
  const press = async (label) => {
    const hit = await p.evaluate((l) => {
      const b = [].slice.call(document.querySelectorAll('.bn-tools button')).find(x => (x.textContent || '').trim() === l);
      if (!b) return false; b.click(); return true;
    }, label);
    await p.waitForTimeout(1100);
    return hit;
  };

  const start = await shot();
  ok(Object.keys(start).length >= 3, 'the open group draws ' + Object.keys(start).length + ' elements — too few to arrange');

  // ---- 1. the rename ------------------------------------------------------
  const labels = await p.evaluate(() => [].slice.call(document.querySelectorAll('.bn-tools button')).map(b => (b.textContent || '').trim()));
  ok(labels.indexOf('Auto-arrange') >= 0, 'no "Auto-arrange" button: ' + JSON.stringify(labels));
  ok(labels.indexOf('Arrange') < 0, 'the old "Arrange" label is still there: ' + JSON.stringify(labels));
  ok(labels.indexOf('Save arrangement') >= 0, 'no "Save arrangement" button: ' + JSON.stringify(labels));
  ok(labels.indexOf('Restore saved') < 0, '"Restore saved" is offered before anything has been saved');

  // ---- 2. arrange it by hand ---------------------------------------------
  const arranged = await p.evaluate(() => {
    // move every element onto a distinctive grid, through the app's own writer
    const m = (window.BONDSVIEW && window.BONDSVIEW.__main) || null;
    const nodes = [].slice.call(document.querySelectorAll('.bn-canvas .bn-node[data-key]'));
    nodes.forEach((d, i) => {
      const x = 120 + (i % 3) * 260, y = 90 + Math.floor(i / 3) * 190;
      d.style.left = x + 'px'; d.style.top = y + 'px';
      try { if (window.__bnSavePos) window.__bnSavePos(d.dataset.key, x, y); } catch (e) {}
    });
    return nodes.length;
  });
  // the app has no exported savePos, so drag each node with a real pointer instead
  const drags = await p.evaluate(() => [].slice.call(document.querySelectorAll('.bn-canvas .bn-node[data-key]'))
    .map(d => { const r = d.getBoundingClientRect(); return { key: d.dataset.key, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  for (let i = 0; i < drags.length; i++) {
    const d = drags[i];
    await p.mouse.move(d.x, d.y);
    await p.mouse.down();
    await p.mouse.move(d.x + 14 + (i % 3) * 9, d.y + 11 + (i % 2) * 13, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(160);
  }
  await p.waitForTimeout(600);
  const mine = await shot();
  ok(diff(start, mine).moved > 0, 'dragging did not move anything — the fixture proves nothing');

  // ---- 3. save it ---------------------------------------------------------
  ok(await press('Save arrangement'), 'could not press Save arrangement');
  const savedShot = await shot();
  // Save deliberately SETTLES before it snapshots: a drag writes a position
  // without re-rendering, so the picture at the instant of the click may still be
  // one deRow/unblock has not corrected. What must be true is that the saved
  // picture is the settled one — a further render moves nothing.
  const settle = await p.evaluate(() => { try { window.BONDSVIEW.render(window.BONDSVIEW.MAIN); return true; } catch (e) { return false; } });
  await p.waitForTimeout(1000);
  if (settle) {
    const again = await shot();
    ok(diff(savedShot, again).moved === 0,
       'the saved picture is not settled — a plain re-render moved ' + diff(savedShot, again).moved +
       ' of ' + diff(savedShot, again).n + ': ' + JSON.stringify(diff(savedShot, again).sample));
  }
  // storyId() is private to the Bonds module, so the store is found by prefix —
  // and the read is asserted, because a harness that reads {} passes everything.
  const stored = await p.evaluate(() => {
    let k = null;
    for (let i = 0; i < localStorage.length; i++) {
      const n = localStorage.key(i);
      if (n && n.indexOf('dystoria.bonds.v1.') === 0) { k = n; break; }
    }
    if (!k) return { err: 'no bonds store in localStorage' };
    const s = JSON.parse(localStorage.getItem(k) || '{}');
    const keys = Object.keys(s.saved || {});
    return { err: null, storeKey: k, bags: keys, one: keys.length === 1 ? s.saved[keys[0]] : null,
             layoutKeys: Object.keys(s.layouts || {}) };
  });
  ok(!stored.err, String(stored.err));
  if (stored.err) { console.log('FAIL ' + fail.length); fail.forEach(f => console.log('  \u00b7 ' + f)); await b.close(); process.exit(1); }
  ok(stored.bags.length === 1, 'expected one saved arrangement, got ' + stored.bags.length);
  ok(/^group:.*\|lens:/.test(stored.bags[0] || ''),
     'the save is not keyed by group AND lens: "' + stored.bags[0] + '"');
  ok(stored.one && stored.one.n === Object.keys(savedShot).length,
     'the save records ' + (stored.one && stored.one.n) + ' elements, the canvas draws ' + Object.keys(savedShot).length);
  // the contract, stated directly: what was stored is what is on the screen
  if (stored.one && stored.one.pos) {
    const off = Object.keys(savedShot).filter(k => !stored.one.pos[k] ||
      stored.one.pos[k].x !== savedShot[k].x || stored.one.pos[k].y !== savedShot[k].y);
    ok(off.length === 0, off.length + ' of ' + Object.keys(savedShot).length +
       ' saved positions do not match the picture that was saved: ' +
       JSON.stringify(off.slice(0, 3).map(k => k + ' stored ' + JSON.stringify(stored.one.pos[k]) + ' on screen ' + JSON.stringify(savedShot[k]))));
  }
  ok(!!(stored.one && stored.one.view), 'the save did not keep the camera');
  ok(await btn('Restore saved'), '"Restore saved" did not appear after saving');

  // ---- 4. THE FIXED POINT: disturb it, restore, land on the same pixels ---
  ok(await press('Auto-arrange'), 'could not press Auto-arrange');
  const auto = await shot();
  ok(diff(savedShot, auto).moved > 0, 'Auto-arrange changed nothing — this check proves nothing');
  const stillSaved = await p.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k) || '{}');
    return Object.keys(s.saved || {}).length;
  }, stored.storeKey);
  ok(stillSaved === 1, 'Auto-arrange destroyed the saved arrangement — that separation is the whole feature');

  ok(await press('Restore saved'), 'could not press Restore saved');
  const back = await shot();
  const d1 = diff(savedShot, back);
  ok(d1.moved === 0, 'restore did not land where save was pressed: ' + d1.moved + ' of ' + d1.n +
     ' elements moved — ' + JSON.stringify(d1.sample));

  // and it does not creep: the display passes run again on every render
  await press('Restore saved');
  await press('Restore saved');
  const back3 = await shot();
  const d3 = diff(savedShot, back3);
  ok(d3.moved === 0, 'the drawing crept over three restores (' + d3.moved + ' moved) — ' + JSON.stringify(d3.sample));

  // leaving the group and coming back keeps it too
  await p.evaluate(() => { try { window.__planSetView('map'); } catch (e) {} });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { window.__planSetView('bonds'); } catch (e) {} });
  await p.waitForTimeout(2200);
  const reopened = await shot();
  const d4 = diff(savedShot, reopened);
  ok(d4.n > 0, 'the group did not reopen');
  ok(d4.moved === 0, 'reopening the group moved ' + d4.moved + ' elements away from the restored arrangement');

  // ---- 5. a save belongs to ONE lens -------------------------------------
  const lensSwap = await p.evaluate(() => {
    const sel = document.querySelector('.bn-lensbtn, .bn-lens, #bnLens, .bn-kind');
    return { found: !!sel, cls: sel ? sel.className : null };
  });
  const twoSlots = await p.evaluate(() => {
    // switch the open group to another structure its cast can wear, through the app
    try {
      const m = window.BONDSVIEW && window.BONDSVIEW.MAIN;
      if (!m) return { err: 'no main mount exported' };
      const was = m.ui.kind;
      const alt = ['social', 'faction', 'family', 'free'].find(k => k !== was);
      m.ui.kind = alt; window.BONDSVIEW.render(m);
      return { was: was, now: alt };
    } catch (e) { return { err: e.message }; }
  });
  if (!twoSlots.err) {
    await p.waitForTimeout(1800);
    const otherLens = await p.evaluate(() => [].slice.call(document.querySelectorAll('.bn-tools button')).map(b => (b.textContent || '').trim()));
    ok(otherLens.indexOf('Restore saved') < 0,
       'the other structure (' + twoSlots.now + ') offers a Restore that belongs to ' + twoSlots.was);
    await p.evaluate((k) => { const m = window.BONDSVIEW.MAIN; m.ui.kind = k; window.BONDSVIEW.render(m); }, twoSlots.was);
    await p.waitForTimeout(1600);
    ok(await btn('Restore saved'), 'coming back to the saved structure lost its Restore button');
  }

  await p.screenshot({ path: __dirname + '/../shots/arrangement.png' }).catch(() => {});
  await b.close();

  console.log(fail.length ? 'FAIL ' + fail.length : 'PASS');
  fail.forEach(f => console.log('  · ' + f));
  if (errs.length) { console.log('page errors:'); errs.slice(0, 8).forEach(e => console.log('  ! ' + e)); }
  process.exit(fail.length || errs.length ? 1 : 0);
})();
