// v.545: the menu must not show controls the app hides inline, and the two that
// moved must actually be in Settings.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const fail = [];
  for (const w of [1200, 424]) {
    const p = await b.newPage({ viewport:{width:w,height:820} });
    await p.goto('file://' + __dirname + '/../out.html');
    await p.waitForTimeout(1400);
    const r = await p.evaluate(() => {
      const g = id => { const e=document.getElementById(id); return e ? {
        disp:getComputedStyle(e).display, parent:e.closest('#appMenu')?'appMenu':(e.closest('#settingsModal')?'settingsModal':'?'),
        inline:e.getAttribute('style')||'' } : null; };
      return { admin:(typeof aiIsAdmin==='function'?aiIsAdmin():null),
               autoExpBtn:g('autoExpBtn'), aiModelsBtn:g('aiModelsBtn'),
               gameBtn:g('gameBtn'), mFullLayoutBtn:g('mFullLayoutBtn') };
    });
    console.log(w+'px', JSON.stringify(r,null,1));
    if (r.admin !== false) fail.push(w+': expected signed-out admin=false');
    if (r.aiModelsBtn.disp !== 'none') fail.push(w+': AI Models leaking to a non-admin ('+r.aiModelsBtn.disp+')');
    if (r.gameBtn.disp !== 'none')     fail.push(w+': Game Mode leaking ('+r.gameBtn.disp+')');
    if (r.autoExpBtn.parent !== 'settingsModal') fail.push(w+': Auto-Export is not in Settings');
    if (r.mFullLayoutBtn.parent !== 'settingsModal') fail.push(w+': Full layout is not in Settings');
    if (r.autoExpBtn.disp === 'none') fail.push(w+': Auto-Export should be visible in Settings');
    const wantFL = (w <= 500) ? 'flex' : 'none';
    if (r.mFullLayoutBtn.disp !== wantFL) fail.push(w+': Full layout display '+r.mFullLayoutBtn.disp+', wanted '+wantFL);
    await p.close();
  }
  console.log(fail.length ? '\nFAIL\n  - '+fail.join('\n  - ') : '\nmenuleak: all clear');
  await b.close();
  process.exit(fail.length?1:0);
})();
