/* t_dialogs.js — the dialog primitive, asserted on every dialog (roadmap #43, v.493).
 *
 *   node tests/t_dialogs.js [path/to/index.html]
 *   needs: playwright (npm i playwright) and a Chromium — CHROME=/path/to/chrome overrides the default.
 *
 * For every card the app can open headless, in Ember and Classic, it asserts:
 *   behaviour — role="dialog" + aria-modal on the card · focus lands inside on open · Escape closes it
 *               · Tab stays inside · a dialog raised over an open scrim draws no second scrim
 *   tokens    — radius 14 · scrim rgba(20,18,16,.42) · × 32×32 within 13px of the corner · title Cinzel 19 (or 22 on the three heroes)
 * Counter-tested against v.486 (before the pass): 200+ assertions fire there.
 */
'use strict';
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let pass = 0, fail = 0; const fails = [];
function ok(c, msg){ if (c) pass++; else { fail++; fails.push(msg); } }

const DIALOGS = [
  { name: 'confirm',        open: `siteConfirm('Delete this section? Its prose is kept as a version.', 'Delete')`, bd: '#confirmModal', card: '#confirmModal .cm-card', title: '#confirmModal .dlg-title', x: null, isOpen: `document.getElementById('confirmModal').classList.contains('show')` },
  { name: 'prompt',         open: `sitePrompt('Name this section','The Long Road','Save')`, bd: '#inPrompt', card: '#inPrompt .ip-card', title: '#inPrompt .ip-lbl', x: null, isOpen: `document.getElementById('inPrompt').classList.contains('show')` },
  { name: 'settings',       open: `document.getElementById('settingsBtn').click()`, bd: '#settingsModal', card: '#settingsModal .set-card', title: '#settingsModal .set-h', x: '#settingsModal .dlg-x', isOpen: `document.getElementById('settingsModal').classList.contains('show')` },
  { name: 'legal',          open: `openLegal('privacy')`, bd: '#legalModal', card: '#legalModal .lg-card', title: '#legalModal .lg-title', x: '#legalModal .lg-close', isOpen: `document.getElementById('legalModal').classList.contains('show')` },
  { name: 'help',           open: `document.getElementById('helpPanel').classList.add('show')`, bd: '#helpPanel .help-backdrop', card: '#helpPanel .help-card', title: '#helpPanel .help-title', x: '#helpPanel .help-close', isOpen: `document.getElementById('helpPanel').classList.contains('show')` },
  { name: 'versions',       open: `openVersionsModal()`, bd: '#versionsModal', card: '#versionsModal .ver-card', title: '#versionsModal .ver-h-title', x: '#verClose', isOpen: `document.getElementById('versionsModal').classList.contains('show')` },
  { name: 'statistics',     open: `var m=ensureStatsModal(); m.classList.add('show')`, bd: '#statsModal', card: '#statsModal .stx-card', title: '#statsModal .stx-h-title', x: '#stxClose', isOpen: `document.getElementById('statsModal').classList.contains('show')` },
  { name: 'support',        open: `document.getElementById('donateBtn').click()`, bd: '#donateModal', card: '#donateModal .dn-card', title: '#donateModal .dn-title', hero: true, x: '#dnClose', isOpen: `document.getElementById('donateModal').classList.contains('show')` },
  { name: 'feedback',       open: `var f=document.getElementById('feedbackModal'); f.hidden=false; f.classList.add('show')`, bd: '#feedbackModal', card: '#feedbackModal .fb-card', title: '#feedbackModal .fb-title', hero: true, x: '#fbCloseBtn', isOpen: `document.getElementById('feedbackModal').classList.contains('show')` },
  { name: 'import',         open: `openImport()`, bd: '#importBackdrop', card: '#importCard', title: '#importHeadTitle', x: '#importClose', isOpen: `document.getElementById('importCard').classList.contains('show')` },
  { name: 'universal-words',open: `openCustomWordsModal()`, bd: '#customWordsModal', card: '#customWordsModal .cw-panel', title: '#customWordsModal .cw-panel > h2', x: '#cwClose', isOpen: `!!document.getElementById('customWordsModal') && document.getElementById('customWordsModal').classList.contains('show')` },
  { name: 'ai-models',      open: `openAiModelsPanel()`, bd: '#aiModelPanel', card: '#aiModelPanel .amp-card', title: '#aiModelPanel .amp-head', x: '#aiModelPanel .amp-x', isOpen: `!!document.getElementById('aiModelPanel') && document.getElementById('aiModelPanel').classList.contains('show')` },
  { name: 'find-your-flow', open: `var o=ensureWriteIntro(); o.classList.add('show')`, bd: '#writeIntro', card: '#writeIntro .wi-card', title: '#writeIntro .wi-title', hero: true, x: '#writeIntro .wi-x', isOpen: `!!document.getElementById('writeIntro') && document.getElementById('writeIntro').classList.contains('show')` },
  { name: 'sign-in',        open: `document.getElementById('authCard').classList.add('show')`, bd: null, card: '#authCard', title: '#authTitle', x: '#authClose', isOpen: `document.getElementById('authCard').classList.contains('show')` },
  { name: 'account-nudge',  open: `var a=document.getElementById('acctNudge'); a.hidden=false; a.classList.add('show')`, bd: '#acctNudge', card: '#acctNudge .an-card', title: '#acctNudge .an-title', x: '#anClose', isOpen: `document.getElementById('acctNudge').classList.contains('show')` },
  { name: 'start-card',     open: `openStartCard()`, bd: '#startModal', card: '#startModal .sm-panel', title: '#startModal .sm-panel > h2', x: '#startModal .sm-x', isOpen: `!!document.getElementById('startModal') && document.getElementById('startModal').classList.contains('show')` },
  { name: 'goals',          open: `openGoalsEditor()`, bd: '#goalModal', card: '#goalModal .gm-panel', title: '#goalModal .gm-panel > h2', x: '#goalModal .sm-x', isOpen: `!!document.getElementById('goalModal') && document.getElementById('goalModal').classList.contains('show')` },
  { name: 'tip-jar',        open: `openTipJar()`, bd: '#tipJar', card: '#tipJar .tip-card', title: '#tipJar .tip-title', x: '#tipJar .tip-x', isOpen: `!!document.getElementById('tipJar') && document.getElementById('tipJar').classList.contains('show')` },
  { name: 'ai-consent',     open: `openAiConsent()`, bd: '#aiConsent', card: '#aiConsent .aic-card', title: '#aiConsent .aic-title', x: '#aiConsent .aic-x', isOpen: `!!document.getElementById('aiConsent') && document.getElementById('aiConsent').classList.contains('show')` },
  { name: 'character-builder', mode: 'map', open: `openCharCreator()`, bd: '#charCreatorBd', card: '#charCreator', title: '#charCreator .cc-title', x: '#charCreator .cc-x', isOpen: `document.getElementById('charCreatorBd').classList.contains('show')` },
  { name: 'place-builder',  mode: 'map', open: `(window.openSettingCreator||openSettingCreator)()`, bd: '#settingCreatorBd', card: '#settingCreator', title: '#settingCreator .sc-title', x: '#settingCreator .sc-x', isOpen: `document.getElementById('settingCreatorBd').classList.contains('show')` },
  { name: 'artifact-builder', mode: 'map', open: `(window.openObjectCreator||openObjectCreator)()`, bd: '#objectCreatorBd', card: '#objectCreator', title: '#objectCreator .oc-title', x: '#objectCreator .oc-x', isOpen: `document.getElementById('objectCreatorBd').classList.contains('show')` },
  { name: 'group-builder',  mode: 'map', open: `(window.openGroupCreator||openGroupCreator)()`, bd: '#groupCreatorBd', card: '#groupCreator', title: '#groupCreator .gc-title', x: '#groupCreator .gc-x', isOpen: `document.getElementById('groupCreatorBd').classList.contains('show')` },
  { name: 'event-builder',  mode: 'map', open: `(window.openEventCreator||openEventCreator)()`, bd: '#eventCreatorBd', card: '#eventCreator', title: '#eventCreator .gc-title', x: '#eventCreator .gc-x', isOpen: `document.getElementById('eventCreatorBd').classList.contains('show')` },
  { name: 'concept-builder', mode: 'map', open: `(window.openConceptCreator||openConceptCreator)()`, bd: '#conceptCreatorBd', card: '#conceptCreator', title: '#conceptCreator .gc-title', x: '#conceptCreator .gc-x', isOpen: `document.getElementById('conceptCreatorBd').classList.contains('show')` },
  { name: 'describe-it',    mode: 'map', open: `openDescPrompt('character')`, bd: '#descPromptBd', card: '#descPrompt', title: '#descPrompt .bd-title', x: '#descPrompt .bd-x', isOpen: `document.getElementById('descPromptBd').classList.contains('show')` },
  { name: 'book-setup',     mode: 'read', open: `openBookSetup()`, bd: '#bookSetup', card: '#bookSetup .bs-card', title: '#bookSetup .bs-h', x: '#bookSetup .bs-x', isOpen: `!!document.getElementById('bookSetup') && document.getElementById('bookSetup').classList.contains('show')` },
  { name: 'merge',          mode: 'edit', open: `orgOpenMergeDialog([0,1])`, bd: '#orgMergeModal', card: '#orgMergeModal .omm-card', title: '#orgMergeModal .omm-h', x: '#orgMergeModal .dlg-x', isOpen: `(function(){ var m=document.getElementById('orgMergeModal'); return !!m && m.isConnected && getComputedStyle(m).display!=='none'; })()` },
];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  for (const theme of ['ember', 'classic']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem('dystoria.onboarding', '0'); localStorage.setItem('dystoria.onb.overviewSeen', '1'); localStorage.setItem('dystoria.tourDone', '1'); localStorage.setItem('dystoria_writeIntroSeen', '1'); } catch (e) {} });
    await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    await page.goto('file://' + FILE, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
    await page.evaluate((t) => { const lf = document.getElementById('landingFrame'); if (lf) lf.remove(); document.querySelectorAll('[id^="tour"]:not(style),[id^="onb"]:not(style),#consentBar').forEach(e => e.remove()); const st = document.createElement('style'); st.textContent = '*{transition:none!important;animation:none!important}'; document.head.appendChild(st); document.body.classList.toggle('ember', t === 'ember'); try { ensureSession(); while ((state.frames || []).length < 2) addFrame(); } catch (e) {} }, theme);
    let cur = 'plan';
    for (const d of DIALOGS) {
      const T = theme + ' · ' + d.name;
      const mode = d.mode || 'plan';
      if (mode !== cur) { try { await page.evaluate(m => goMode(m === 'plan' ? 'notepad' : m), mode); } catch (e) {} await page.waitForTimeout(500); cur = mode; }
      const open = async () => { await page.mouse.click(4, 4); try { await Promise.race([page.evaluate('(()=>{' + d.open + ';})()'), new Promise(r => setTimeout(r, 1200))]); } catch (e) {} await page.waitForTimeout(300); };
      const isOpen = () => page.evaluate(d.isOpen).catch(() => false);
      const closeAny = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(120); if (await isOpen()) { try { await page.evaluate((s) => { const x = document.querySelector(s); if (x) x.click(); }, d.x || 'button.dlg-x'); } catch (e) {} await page.waitForTimeout(120); } if (await isOpen()) { try { await page.evaluate(sel => { const b = document.querySelector(sel); if (b) { b.classList.remove('show'); } }, d.bd || d.card); } catch (e) {} } };

      await open();
      if (!(await isOpen())) { ok(false, T + ': could not open'); continue; }
      const m = await page.evaluate((d) => {
        const card = document.querySelector(d.card), bd = d.bd ? document.querySelector(d.bd) : null, x = d.x ? document.querySelector(d.x) : null, t = d.title ? document.querySelector(d.title) : null;
        const cs = card ? getComputedStyle(card) : null, bcs = bd ? getComputedStyle(bd) : null;
        const cr = card ? card.getBoundingClientRect() : null, xr = x ? x.getBoundingClientRect() : null;
        return {
          role: card && card.getAttribute('role'), modal: card && card.getAttribute('aria-modal'),
          focusInside: !!(card && document.activeElement && card.contains(document.activeElement) && document.activeElement !== card),
          radius: cs && cs.borderTopLeftRadius, scrim: bcs && bcs.backgroundColor,
          x: xr ? { w: Math.round(xr.width), h: Math.round(xr.height), top: Math.round(xr.y - cr.y), right: Math.round(cr.right - xr.right) } : null,
          title: t ? { fam: getComputedStyle(t).fontFamily.split(',')[0].replace(/"/g, ''), fs: getComputedStyle(t).fontSize } : null,
        };
      }, d);
      ok(m.role === 'dialog' && m.modal === 'true', T + ': role=dialog + aria-modal (got ' + m.role + '/' + m.modal + ')');
      ok(m.focusInside, T + ': focus lands inside on open');
      ok(m.radius === '14px', T + ': radius 14 (got ' + m.radius + ')');
      if (d.bd) ok(m.scrim === 'rgba(20, 18, 16, 0.42)', T + ': scrim rgba(20,18,16,.42) (got ' + m.scrim + ')');
      if (d.x) ok(m.x && m.x.w === 32 && m.x.h === 32 && m.x.top <= 13 && m.x.right <= 13, T + ': × 32×32 in the corner (got ' + JSON.stringify(m.x) + ')');
      if (d.title) ok(m.title && /Cinzel/.test(m.title.fam) && m.title.fs === (d.hero ? '22px' : '19px'), T + ': title Cinzel ' + (d.hero ? 22 : 19) + ' (got ' + JSON.stringify(m.title) + ')');
      // Tab stays inside
      let inside = 0; for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(s => { const c = document.querySelector(s); return !!(c && document.activeElement && c.contains(document.activeElement)); }, d.card)) inside++; }
      ok(inside === 8, T + ': Tab stays inside (' + inside + '/8)');
      // Escape closes
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      ok(!(await isOpen()), T + ': Escape closes');
      await closeAny();
      // nested: raise a confirm over it → no second scrim, Escape closes only the confirm
      if (d.bd && d.name !== 'confirm' && d.name !== 'prompt') {
        await open();
        if (await isOpen()) {
          await page.evaluate(() => { window.__tp = siteConfirm('Nested question?', 'Yes'); }); await page.waitForTimeout(250);
          const nested = await page.evaluate(() => ({ cm: getComputedStyle(document.getElementById('confirmModal')).backgroundColor, nestedCls: document.getElementById('confirmModal').classList.contains('dlg-nested') }));
          ok(nested.cm === 'rgba(0, 0, 0, 0)', T + ': a confirm raised over it draws no second scrim (got ' + nested.cm + ')');
          await page.keyboard.press('Escape'); await page.waitForTimeout(200);
          const after = await page.evaluate(() => document.getElementById('confirmModal').classList.contains('show'));
          ok(!after && (await isOpen()), T + ': Escape closes only the confirm on top');
          await closeAny();
        }
      }
      await page.waitForTimeout(100);
    }
    ok(errs.length === 0, theme + ': 0 page errors (' + errs.slice(0, 3).join(' | ') + ')');
    await page.close();
  }
  await browser.close();
  console.log(`t_dialogs: ${pass} passed, ${fail} failed  (${path.basename(FILE)})`);
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(fail ? 1 : 0);
})();
