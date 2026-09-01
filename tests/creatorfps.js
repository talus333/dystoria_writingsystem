// v.553: no full-viewport backdrop-filter may sit over the app — it halves the
// frame rate for as long as the surface is open. Measured, not assumed.
const { chromium } = require('playwright');
const FILE = process.argv[2] || (__dirname + '/../out.html');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  await p.goto('file://' + FILE); await p.waitForTimeout(2500);
  await p.evaluate(() => { const f=document.getElementById('landingFrame'); if(f) f.remove();
    try{ localStorage.setItem('dystoria_entered','1'); localStorage.setItem('dystoria.onboarding','off'); }catch(e){} });
  await p.reload(); await p.waitForTimeout(3000);
  await p.evaluate(() => { try{
    if(!loadSessions().some(x=>x.id==='.s_hansel_demo') && window.buildHanselSession){
      const l=loadSessions(); l.unshift(window.buildHanselSession()); persistSessions(l); }
    openSession('.s_hansel_demo'); }catch(e){} });
  await p.waitForTimeout(1800);

  const fps = () => p.evaluate(() => new Promise(res => {
    let n=0; const t0=performance.now();
    const tick=()=>{ n++; if(performance.now()-t0<1800) requestAnimationFrame(tick); else res(Math.round(n/((performance.now()-t0)/1000))); };
    requestAnimationFrame(tick); }));

  const fail = [];
  const base = await fps();
  console.log('closed'.padEnd(22), base+' fps');
  if (base < 50) { console.log('(baseline itself is low — the machine is loaded; skipping)'); await b.close(); process.exit(0); }

  for (const fn of ['openCharCreator','openSettingCreator','openObjectCreator','openGroupCreator','openEventCreator','openConceptCreator']) {
    if (await p.evaluate(f => typeof window[f], fn) !== 'function') continue;
    await p.evaluate(f => window[f](), fn);
    await p.waitForTimeout(1000);
    const r = await fps();
    console.log(fn.padEnd(22), r+' fps');
    if (r < base * 0.8) fail.push(fn + ' drops to ' + r + ' fps against a ' + base + ' baseline');
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  }

  // v.554: the other full-screen scrims must be blur-free too. NONE of them exist
  // in the DOM at rest — all five are built on demand — so an earlier version of
  // this check called getElementById, found nothing, skipped every id and passed
  // on a build where four were still blurring. It now plants a synthetic div
  // carrying each id, which matches the id-based rules, and REQUIRES a minimum
  // number of ids to have been exercised so a vacuous pass is impossible.
  const scrims = await p.evaluate(() => {
    const ids = ['qaIntroModal','qaProvModal','apCard','scCard'];
    const bad = [];
    ids.forEach(id => {
      const d = document.createElement('div');
      d.id = id; d.style.position = 'fixed'; d.style.inset = '0';
      document.body.appendChild(d);
      const cs = getComputedStyle(d);
      const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      d.remove();
      if (bf !== 'none') bad.push({ id, bf });
    });
    // #rfxModal's CSS is injected by JS when Refract first opens, so a synthetic
    // element sees nothing at rest. Assert the OVERRIDE exists instead: it is
    // (1,2,2) against the injected rule's (1,0,0), so it wins whatever the order.
    let rfxOverride = false;
    for (const sh of document.styleSheets) {
      let rules; try { rules = sh.cssRules; } catch(e) { continue; }
      for (const r of rules || []) {
        if (r.selectorText && /#rfxModal/.test(r.selectorText)
            && /none/.test(r.style && (r.style.backdropFilter || r.style.webkitBackdropFilter) || '')) rfxOverride = true;
      }
    }
    return { bad, checked: ids.length, rfxOverride };
  });
  console.log('scrims checked:', scrims.checked, ' refract override present:', scrims.rfxOverride);
  if (scrims.checked < 4) fail.push('only ' + scrims.checked + ' scrims were checked — this check is measuring nothing');
  if (scrims.bad.length) fail.push('full-screen scrims still blurring: ' + JSON.stringify(scrims.bad));
  if (!scrims.rfxOverride) fail.push('no #rfxModal backdrop-filter:none override found');

  // no full-screen backdrop-filter may be live on any open surface
  const blurs = await p.evaluate(() => {
    const out=[]; document.querySelectorAll('*').forEach(el=>{
      const cs=getComputedStyle(el); const bf=cs.backdropFilter||cs.webkitBackdropFilter||'none';
      if(bf==='none'||cs.display==='none'||cs.visibility==='hidden') return;
      const r=el.getBoundingClientRect(); const area=r.width*r.height;
      if(area > window.innerWidth*window.innerHeight*0.5)
        out.push({ id:el.id||el.className, area:Math.round(area), bf });
    }); return out; });
  if (blurs.length) fail.push('full-viewport backdrop-filter still live: ' + JSON.stringify(blurs));

  console.log(fail.length ? '\nFAIL\n  - '+fail.join('\n  - ') : '\ncreatorfps: all clear');
  await b.close();
  process.exit(fail.length?1:0);
})();
