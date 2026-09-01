// v.545: every medallion wears a ring at rest, the same brand gold on hover,
// and in Ember the ACTIVE ring is that same gold. Header icons match the logo.
//
// Hover is forced through CDP (CSS.forcePseudoState) rather than by moving a
// synthetic mouse: p.hover() is silently intercepted by overlays in this app,
// which made an earlier version of this file report "all clear" while measuring
// a resting medallion and calling it a hover.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:1500,height:900} });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  await p.goto('file://' + __dirname + '/../out.html');
  await p.waitForTimeout(1400);
  await p.evaluate(() => { const f=document.getElementById('landingFrame'); if(f) f.remove(); });
  await p.evaluate(() => { try{ goMode('notepad'); }catch(e){} });
  await p.waitForTimeout(600);
  await p.evaluate(() => document.body.classList.add('ember'));
  await p.waitForTimeout(400);
  if (!await p.evaluate(() => document.body.classList.contains('ember'))) throw new Error('ember did not stick');

  const bar = await p.evaluate(() =>
    [...document.querySelectorAll('#deskbar #padTools > button')]
      .map(b => ({ id:b.id, on:b.classList.contains('on')||b.classList.contains('active') })));
  console.log('bar:', JSON.stringify(bar));
  if (!bar.length) throw new Error('no mode buttons found — harness is pointed at nothing');

  const { root } = await cdp.send('DOM.getDocument');
  const ring = sel => p.evaluate(s => {
    const m = document.querySelector(s); if (!m) return null;
    return getComputedStyle(m).borderTopColor;
  }, sel);

  const GOLD = 'rgb(250, 154, 49)';
  const fail = [];
  for (const b0 of bar) {
    const sel = `#deskbar #padTools > button#${b0.id} .mp-med`;
    const rest = await ring(sel);
    if (!rest) { fail.push('no .mp-med for ' + b0.id + ' — measuring nothing'); continue; }
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#deskbar #padTools > button#${b0.id}` });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    // the ring TRANSITIONS. Reading straight after forcing the state returns the
    // resting colour mid-fade — which is how an earlier run of this file
    // "discovered" that the v.540 hover ring had never worked. It works; the
    // harness was just faster than the animation.
    await p.waitForTimeout(320);
    const hov = await ring(sel);
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    await p.waitForTimeout(120);
    console.log(`  ${b0.id.padEnd(13)} ${b0.on?'ACTIVE':'      '}  rest ${String(rest).padEnd(24)} hover ${hov}`);
    if (rest === 'rgba(0, 0, 0, 0)' || rest === 'transparent') fail.push(b0.id + ' has no ring at rest');
    if (hov !== GOLD) fail.push(b0.id + ' hover ring is ' + hov + ', wanted ' + GOLD);
    if (b0.on && rest !== GOLD) fail.push(b0.id + ' is ACTIVE but its ring is ' + rest);
  }

  const ico = await p.evaluate(() => { const s=document.querySelector('header .hbtn svg'); return s?getComputedStyle(s).color:null; });
  console.log('  header icon colour:', ico, '(logo --gold is ' + GOLD + ')');
  if (ico !== GOLD) fail.push('header icons are ' + ico + ', not the logo gold');

  console.log(fail.length ? '\nFAIL\n  - ' + fail.join('\n  - ') : '\nringcheck: all clear');
  await b.close();
  process.exit(fail.length?1:0);
})();
