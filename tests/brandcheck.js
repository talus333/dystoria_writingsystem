// Permanent check: the brand mark is one vector, in both places, on the live token.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1200,height:700}, deviceScaleFactor:4 });
  await p.goto('file://' + (process.argv[2] || (__dirname + '/../out.html')));
  await p.waitForTimeout(1200);
  await p.evaluate(() => { const f=document.getElementById('landingFrame'); if(f) f.remove(); });
  await p.waitForTimeout(300);

  const r = await p.evaluate(() => {
    const out = {};
    out.rasterFeatherLeft = /pattern0_296_348|pattern0_guest/.test(document.documentElement.innerHTML);
    const hm = document.querySelector('#brandTitle .brand-mark');
    const gm = document.querySelector('.rd-guest-brand .brand-mark');
    out.headerMark = !!hm;
    out.guestMark  = !!gm;
    out.headerFill = hm ? getComputedStyle(hm).fill : null;
    out.guestFill  = gm ? getComputedStyle(gm).fill : null;
    out.gold = getComputedStyle(document.body).getPropertyValue('--gold').trim();
    const ring = document.querySelector('#brandTitle .brand-ring');
    out.ringPresent = !!ring;
    out.ringStroke  = ring ? getComputedStyle(ring).stroke : null;
    out.ringHiddenAtRest = ring ? getComputedStyle(ring).strokeDashoffset : null;
    // the mark must actually paint inside the 34px box
    const bb = hm ? hm.getBoundingClientRect() : null;
    out.headerBox = bb ? [Math.round(bb.width), Math.round(bb.height)] : null;
    return out;
  });
  console.log(r);

  const fail = [];
  if (r.rasterFeatherLeft) fail.push('a raster feather pattern is still in the document');
  if (!r.headerMark) fail.push('no .brand-mark in the header');
  if (!r.guestMark)  fail.push('no .brand-mark on the guest reader brand');
  if (r.headerFill !== 'rgb(250, 154, 49)') fail.push('header mark not painting --gold: ' + r.headerFill);
  if (r.guestFill  !== 'rgb(250, 154, 49)') fail.push('guest mark not painting --gold: ' + r.guestFill);
  if (!r.ringPresent) fail.push('the hover ring circle was lost');
  if (r.ringStroke !== 'rgb(250, 154, 49)') fail.push('ring stroke changed: ' + r.ringStroke);
  if (!r.headerBox || r.headerBox[0] < 18 || r.headerBox[1] < 25) fail.push('header mark box too small: ' + r.headerBox);

  console.log(fail.length ? 'FAIL\n  - ' + fail.join('\n  - ') : 'brandcheck: all clear');
  await b.close();
  process.exit(fail.length ? 1 : 0);
})();
