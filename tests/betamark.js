// v.555: the beta state must be visible in the three places it was added, and
// the header mark must NOT have moved — v.546 put its centre at x=48 to line up
// with the Plan medallion, and a badge in normal flow would shift it.
const { chromium } = require('playwright');
const FILE = process.argv[2] || (__dirname + '/../out.html');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  await p.goto('file://' + FILE); await p.waitForTimeout(2500);
  await p.evaluate(() => { const f=document.getElementById('landingFrame'); if(f) f.remove();
    try{ localStorage.setItem('dystoria_entered','1'); localStorage.setItem('dystoria.onboarding','off'); }catch(e){} });
  await p.reload(); await p.waitForTimeout(3200);

  const fail = [];
  const r = await p.evaluate(() => {
    const bt = document.getElementById('brandTitle');
    const bb = bt && bt.querySelector('.brand-beta');
    const svg = bt && bt.querySelector('svg');
    const line = document.getElementById('appBetaLine');
    const med = document.querySelector('#deskbar #padTools > button .mp-med');
    const rect = e => { if(!e) return null; const x=e.getBoundingClientRect();
      return { cx:Math.round(x.x+x.width/2), w:Math.round(x.width), h:Math.round(x.height) }; };
    return {
      betaText: bb ? (bb.textContent||'').trim() : null,
      betaColor: bb ? getComputedStyle(bb).color : null,
      betaPos: bb ? getComputedStyle(bb).position : null,
      markCx: rect(svg) ? rect(svg).cx : null,
      medCx: rect(med) ? rect(med).cx : null,
      headerH: Math.round(document.querySelector('header').getBoundingClientRect().height),
      menuLine: line ? (line.textContent||'').trim() : null,
      aria: bt ? bt.getAttribute('aria-label') : null,
      guestBeta: !!document.querySelector('.rd-guest-brand .rd-brand-beta'),
    };
  });
  console.log(r);

  if (r.betaText !== 'beta') fail.push('no beta beside the brand mark (got ' + r.betaText + ')');
  if (r.betaPos !== 'absolute') fail.push('the beta is in normal flow — it will move the mark');
  if (r.markCx == null || r.medCx == null) fail.push('could not measure the mark against the medallion');
  else if (Math.abs(r.markCx - r.medCx) > 1) fail.push('the mark no longer lines up with the Plan medallion: ' + r.markCx + ' vs ' + r.medCx);
  if (r.headerH !== 57) fail.push('the header height changed to ' + r.headerH + ' (was 57)');
  if (!r.menuLine || !/^beta/.test(r.menuLine)) fail.push('no beta line in the menu (got ' + r.menuLine + ')');
  if (!/\d{4}\.\d{2}\.\d{2}\.\d+/.test(r.menuLine||'')) fail.push('the menu beta line carries no version: ' + r.menuLine);
  if (!/beta/i.test(r.aria||'')) fail.push('the brand aria-label does not say beta: ' + r.aria);
  if (!r.guestBeta) fail.push('the public reader brand has no beta mark');

  // Contrast against the band the mark ACTUALLY sits on. The header is a
  // gradient, so two earlier cuts of this check were wrong in opposite ways: one
  // walked up for a backgroundColor, found none, returned null and passed
  // silently; the next tested every colour stop in the gradient and failed on a
  // stop nowhere near the mark. The only honest measurement is the rendered
  // pixel, so hide the beta, screenshot the exact rectangle it occupies, and
  // average it.
  const box = await p.evaluate(() => {
    const bb=document.querySelector('#brandTitle .brand-beta'); if(!bb) return null;
    const r=bb.getBoundingClientRect(); bb.style.visibility='hidden';
    return { x:Math.round(r.x), y:Math.round(r.y), width:Math.max(2,Math.round(r.width)), height:Math.max(2,Math.round(r.height)) };
  });
  let contrast = null;
  if (box) {
    const fs = require('fs'), os = require('os'), path = require('path');
    const shot = path.join(os.tmpdir(), 'betabg.png');
    await p.screenshot({ path: shot, clip: box });
    await p.evaluate(() => { const bb=document.querySelector('#brandTitle .brand-beta'); if(bb) bb.style.visibility=''; });
    const fg = await p.evaluate(() => getComputedStyle(document.querySelector('#brandTitle .brand-beta')).color);
    const py = `
import sys
from PIL import Image
im = Image.open(${JSON.stringify(shot)}).convert('RGB')
px = list(im.get_flattened_data()) if hasattr(im, "get_flattened_data") else list(im.getdata())
n = len(px)
bg = tuple(sum(c[i] for c in px)//n for i in range(3))
fg = tuple(int(v) for v in "${fg}".replace('rgb(','').replace(')','').split(','))
def lin(c):
    c/=255.0
    return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def L(c): return .2126*lin(c[0])+.7152*lin(c[1])+.0722*lin(c[2])
a,b=L(fg),L(bg); hi,lo=max(a,b),min(a,b)
print('%.2f %02x%02x%02x' % ((hi+.05)/(lo+.05), *bg))
`;
    const out = require('child_process').execFileSync('python3', ['-c', py]).toString().trim().split(' ');
    contrast = { ratio: parseFloat(out[0]), bg: '#'+out[1] };
  }
  console.log('header beta on its actual ground:', contrast);
  if (!contrast) fail.push('could not sample the ground behind the beta — the contrast check measured nothing');
  else if (contrast.ratio < 4.5) fail.push('the header beta is under AA at ' + contrast.ratio + ' on ' + contrast.bg);

  // v.556: the expectation line, in the first-run doors ONLY. The planning doors
  // share that markup verbatim, so a careless anchor would have put it in both.
  const doors = await p.evaluate(() => {
    if (window.showFirstRunDoors) window.showFirstRunDoors();
    const w = document.getElementById('firstRunDoors');
    const bt = w && w.querySelector('.fr-beta');
    return { line: bt ? (bt.textContent||'').trim() : null,
             afterDoors: bt ? !!(bt.previousElementSibling && bt.previousElementSibling.className === 'fr-doors') : false,
             beforeSkip: bt ? ((bt.nextElementSibling||{}).className === 'fr-skip') : false,
             rule: bt ? getComputedStyle(bt).borderTopWidth : null };
  });
  console.log('doors line:', doors.line);
  if (!doors.line || !/early access/i.test(doors.line)) fail.push('no early-access line in the begin-here doors');
  if (doors.line && /--/.test(doors.line)) fail.push('the doors line still has a double hyphen instead of an em dash');
  if (!doors.afterDoors) fail.push('the doors line is not below the four doors');
  if (!doors.beforeSkip) fail.push('the doors line is not directly above the skip');
  if (doors.rule === '0px') fail.push('the doors line lost its separating rule — it will read as a fifth option');

  console.log(fail.length ? '\nFAIL\n  - '+fail.join('\n  - ') : '\nbetamark: all clear');
  await b.close();
  process.exit(fail.length?1:0);
})();
