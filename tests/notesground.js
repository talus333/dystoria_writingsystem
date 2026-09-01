const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1600,height:950} });
  await p.goto('file://' + __dirname + '/../out.html');
  await p.waitForTimeout(900);
  for (const theme of ['ember','classic']) {
    // v.537 lesson: set the theme AFTER goMode, then assert it stuck.
    await p.evaluate(() => { try{ goMode('edit'); }catch(e){} });
    await p.waitForTimeout(400);
    await p.evaluate(t => { document.body.classList.toggle('ember', t==='ember'); }, theme);
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const cs = el => el ? getComputedStyle(el).backgroundColor : 'MISSING';
      const np = document.getElementById('notesPanel');
      const em = document.getElementById('editMode');
      const nl = document.getElementById('notesList');
      return {
        cls: document.body.className,
        notesPanel: cs(np),
        notesList: cs(nl),
        editMode: cs(em),
        npHead: cs(np && np.querySelector('.np-head')),
      };
    });
    console.log(theme.toUpperCase(), JSON.stringify(r, null, 1));
  }
  await b.close();
})();
