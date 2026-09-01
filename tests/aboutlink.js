// v.547/548: #about-tool / #about-philosophy open the About page at the right
// section — and CRUCIALLY for a writer who ALREADY HAS A STORY OPEN.
//
// Why that distinction is the whole point of this file: init() restores the last
// story at its top, and openSession -> setHash() REWRITES location.hash to
// '#/s/<id>', destroying '#about-tool' before applyHash() ever runs at the
// bottom of init(). On an empty profile nothing is restored, nothing rewrites
// the hash, and the broken code passes. v.547 shipped exactly that false pass.
//
// The story state is produced the way a real user gets there: load once (the app
// creates and remembers a story of its own), then load again with the hash.
const { chromium } = require('playwright');
const FILE = process.argv[2] || (__dirname + '/../out.html');

(async () => {
  const b = await chromium.launch();
  const fail = [];
  for (const withStory of [false, true]) {
    for (const [sec, wantId] of [['tool','aboutGuide'], ['philosophy','aboutPhilosophy']]) {
      const ctx = await b.newContext({ viewport:{width:1200,height:800} });
      // The story state is made by letting the app boot once and create+remember
      // its own story. That first page is then CLOSED and a second one opened —
      // navigating the same page to '...#about-x' would be a same-document
      // fragment navigation, init() would never re-run, and the test would pass
      // on a build where the boot path is broken. That is exactly how the first
      // cut of this file green-lit v.547.
      if (withStory) {
        const warm = await ctx.newPage();
        await warm.goto('file://' + FILE); await warm.waitForTimeout(2400);
        await warm.close();
      }
      const p = await ctx.newPage();
      await p.goto('file://' + FILE + '#about-' + sec);
      await p.waitForTimeout(2600);
      await p.evaluate(() => { const f=document.getElementById('landingFrame'); if(f) f.remove(); });
      await p.waitForTimeout(700);
      const r = await p.evaluate(id => {
        const ap = document.getElementById('aboutPage');
        const sc = ap && ap.querySelector('.about-scroll');
        const t  = document.getElementById(id);
        // the exact precondition of init()'s restore branch: if this holds, the
        // hash-eating openSession path ran on this load.
        let restored = false;
        try {
          const want = intendedStoryId();
          restored = !!(want && loadSessions().some(x => x.id === want));
        } catch(e){}
        return { open: !!(ap && ap.classList.contains('show')),
                 scrollTop: sc ? Math.round(sc.scrollTop) : null,
                 targetTop: t ? Math.round(t.offsetTop) : null,
                 hash: location.hash, restorePathRan: restored };
      }, wantId);
      const label = (withStory ? 'story open' : 'no story ') + ' ' + sec.padEnd(11);
      console.log(label, JSON.stringify(r));
      if (withStory && !r.restorePathRan)
        fail.push(label + ': no story to restore — this run is NOT exercising the real case');
      if (!r.open) fail.push(label + ': the About page did not open');
      if (r.hash) fail.push(label + ': hash left in the URL (' + r.hash + ')');
      if (r.targetTop != null && r.scrollTop != null && Math.abs(r.scrollTop - Math.max(0, r.targetTop - 12)) > 6)
        fail.push(label + ': scrolled to ' + r.scrollTop + ', wanted ~' + Math.max(0, r.targetTop - 12));
      await ctx.close();
    }
  }
  console.log(fail.length ? '\nFAIL\n  - ' + fail.join('\n  - ') : '\naboutlink: all clear');
  await b.close();
  process.exit(fail.length?1:0);
})();
