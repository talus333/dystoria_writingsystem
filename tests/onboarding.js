// v.549: walk the whole overview tour and assert what Jeremy asked for.
const { chromium } = require('playwright');
const FILE = process.argv[2] || (__dirname + '/../out.html');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  const errs = [];
  const NOISE = /ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource|URL scheme "file"/;
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type()==='error' && !NOISE.test(m.text())) errs.push('console: '+m.text()); });

  await p.goto('file://' + FILE);
  await p.waitForTimeout(2500);
  // the landing gate only builds its iframe for a pristine visitor; drop it as a
  // click would, then take the "Get Started" path a new writer takes.
  await p.evaluate(() => { const f=document.getElementById('landingFrame'); if(f) f.remove();
    try{ localStorage.setItem('dystoria_entered','1'); }catch(e){}
    if (window.__enterBeginPage) window.__enterBeginPage(); });
  await p.waitForTimeout(1500);

  const doorsBefore = await p.evaluate(() => !!document.getElementById('firstRunDoors'));

  // wait for the tour card
  let up = false;
  for (let i=0;i<40 && !up;i++){ await p.waitForTimeout(500);
    up = await p.evaluate(() => { const c=document.getElementById('onbCard'); return !!(c && c.classList.contains('show')); }); }
  if (!up) { console.log('FAIL — the tour never appeared'); await b.close(); process.exit(1); }

  const seen = [];
  const fail = [];
  let fullScreenSeenOnWrite = null;

  for (let step=0; step<20; step++){
    await p.waitForTimeout(1100);   // let this step's act finish before measuring it
    const s = await p.evaluate(() => {
      const c=document.getElementById('onbCard'); if(!c) return null;
      return { kicker:(c.querySelector('.ob-kicker')||{}).textContent||'',
               title:(c.querySelector('.ob-title')||{}).textContent||'',
               body:(c.querySelector('.ob-body')||{}).textContent||'',
               hasAbout: !!c.querySelector('.ob-about'),
               last: (c.querySelector('.ob-next')||{}).textContent==='Done',
               writing: document.body.classList.contains('writing'),
               editScrollTop: (()=>{const e=document.getElementById('editScroll'); return e?Math.round(e.scrollTop):0;})(),
               orgOpen: (()=>{const e=document.getElementById('editCols'); return !!(e&&e.classList.contains('org-open'));})(),
               notes: (()=>{const e=document.getElementById('editBody'); return e?e.querySelectorAll('.nt').length:0;})(),
               notePanel: (()=>{const l=document.getElementById('notesList'); return l?l.querySelectorAll('.np-item').length:0;})(),
               readScrollTop: (()=>{const e=document.getElementById('readBody'); return e?Math.round(e.scrollTop):0;})(),
               bookOn: (typeof readBookOn==='function')?readBookOn():false,
               npOpen: document.body.classList.contains('np-open') };
    });
    if (!s) break;
    seen.push(s);
    if (s.hasAbout) fail.push('step "'+s.title+'" still offers the About escape hatch');
    if (/Write Mode/.test(s.title)) fullScreenSeenOnWrite = s.writing;
    // v.550: the modes must show WRITING, not the story's cover illustration.
    if (/Revise Mode/.test(s.title)){
      if (!(s.editScrollTop > 60)) fail.push('Revise is still parked on the cover (editScroll ' + s.editScrollTop + ')');
      if (!s.orgOpen)   fail.push('Revise did not open the contents drawer');
      if (s.notes < 2)  fail.push('Revise shows ' + s.notes + ' example notes in the prose, wanted 2');
      if (s.notePanel < 2) fail.push('the notes margin lists ' + s.notePanel + ', wanted 2');
    }
    if (/gutter drawers/.test(s.title)){
      if (s.orgOpen) fail.push('a drawer is open on the toolkit step — it hides the other tabs');
      if (!/gutter/.test(s.body)) fail.push('the toolkit step has no runtime body: ' + JSON.stringify(s.body).slice(0,60));
    }
    if (/Review Mode/.test(s.title)){
      if (!s.bookOn) fail.push('Review is not in book view');
      if (!(s.readScrollTop > 600)) fail.push('Review is still on the front matter (readBody ' + s.readScrollTop + ')');
    }
    if (/The Notepad/.test(s.title) && !s.npOpen) fail.push('the Notepad step did not open an element notepad');
    if (s.last) { await p.click('#onbCard .ob-next'); break; }
    await p.click('#onbCard .ob-next');
    await p.waitForTimeout(700);
  }

  await p.waitForTimeout(1600);
  const after = await p.evaluate(() => ({
    doors: !!document.getElementById('firstRunDoors'),
    card: (() => { const c=document.getElementById('onbCard'); return !!(c && c.classList.contains('show')); })(),
    padOpen: document.body.classList.contains('np-open'),
  }));
  // v.551: "on screen" is not the same as USABLE. The notepad the tour opened was
  // sitting over these doors, so a new writer could not take the path the tour had
  // just handed them. Click a real door and require it to act.
  let doorClicked = null;
  try {
    await p.click('#firstRunDoors .fr-door[data-act="plan"]', { timeout: 4000 });
    await p.waitForTimeout(900);
    doorClicked = await p.evaluate(() => !document.getElementById('firstRunDoors'));
  } catch(e){ doorClicked = 'blocked: ' + String(e.message||e).split('\n')[0].slice(0,90); }

  console.log('doors shown BEFORE the tour:', doorsBefore, '(want false)');
  console.log('steps:');
  seen.forEach(s => console.log('   ' + (s.kicker+'').padEnd(18) + ' | ' + s.title));
  const plan = seen.find(s => /Plan · /.test(s.kicker));
  console.log('\nPlan step body:', plan ? plan.body.slice(0,150)+'…' : '(missing)');
  console.log('body.writing while on the Write card:', fullScreenSeenOnWrite, '(want false)');
  console.log('doors AFTER the tour:', after.doors, '(want true)   card still up:', after.card, '  notepad open:', after.padOpen, '(want false)');
  console.log('a door actually clicks through:', doorClicked, '(want true)');

  if (doorsBefore) fail.push('the begin-here doors appeared BEFORE the tour');
  if (!plan) fail.push('no Plan views step found');
  else {
    if (!/Bonds/.test(plan.body)) fail.push('the Plan step does not mention Bonds');
    if (/three tabs/.test(plan.body)) fail.push('the Plan step still says "three tabs"');
    if (!/four tabs/.test(plan.body)) fail.push('the Plan step does not say "four tabs"');
  }
  if (fullScreenSeenOnWrite !== false) fail.push('Write Mode entered full-screen during the tour (body.writing='+fullScreenSeenOnWrite+')');
  if (!after.doors) fail.push('the begin-here doors did NOT open when the tour finished');
  if (after.card) fail.push('the tour card is still up after Done');
  if (after.padOpen) fail.push('the notepad is still open over the doors (body.np-open)');
  if (doorClicked !== true) fail.push('a door could not be clicked — ' + doorClicked);
  if (errs.length) fail.push('page errors: ' + errs.slice(0,3).join(' | '));

  console.log(fail.length ? '\nFAIL\n  - ' + fail.join('\n  - ') : '\nonboarding: all clear');
  await b.close();
  process.exit(fail.length?1:0);
})();
