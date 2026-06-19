/* Smoke + regression tests for the single-file app (index.html).
 * Three layers:
 *   1. Static  — every inline <script> parses; the inline CSS is brace-balanced.
 *   2. Load    — the page boots in jsdom with NO uncaught runtime errors.
 *   3. Invariants — targeted checks guarding bugs we've actually hit, so they can't silently regress.
 *
 *   run:  node tests/smoke.test.js   (jsdom resolves from devDependencies / the repo's node_modules)
 *
 * Add a check here whenever you fix a bug: pin the behaviour so it stays fixed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', exp ' + JSON.stringify(b) + ')'); }

/* ---------- 1. STATIC: parse every inline script, balance the CSS ---------- */
(function staticChecks() {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1], code = m[2];
    if (/\bsrc=/.test(attrs) && !code.trim()) continue;   // external script tag, no inline body
    n++;
    try { new vm.Script(code, { filename: 'inline-script-' + n + '.js' }); }
    catch (e) { fail++; console.log('  ✗ inline script #' + n + ' parse error: ' + e.message); }
  }
  ok(n >= 1, 'found at least one inline script (' + n + ')');

  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x => x[1]).join('\n');
  let depth = 0, bad = false;
  for (const c of css) { if (c === '{') depth++; else if (c === '}') { depth--; if (depth < 0) { bad = true; break; } } }
  ok(!bad && depth === 0, 'inline CSS braces balanced (depth ' + depth + ')');
})();

/* ---------- string-level invariants (cheap, no DOM) ---------- */
ok(/const DYSTORIA_BUILD = /.test(html), 'DYSTORIA_BUILD marker present');
eq((html.match(/\.rd-name\{[^}]*line-height:1\.5/g) || []).length, 2,
   'both .rd-name rules pin line-height:1.5 (Read/Refine title alignment)');

/* ---------- 2 + 3. LOAD in jsdom, then assert runtime invariants ---------- */
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.log('  ! jsdom not installed — run `npm install` to enable the load/runtime checks. Skipping them.');
  console.log('\nsmoke: ' + pass + ' passed, ' + fail + ' failed (runtime checks skipped)');
  process.exit(fail ? 1 : 0);
}

const runtimeErrors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://dystoria.net/',            // gives localStorage a real origin
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => ({
      fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {},
      fill() {}, save() {}, restore() {}, setTransform() {}, scale() {}, drawImage() {},
      measureText: () => ({ width: 10 }), getImageData: () => ({ data: [] }), putImageData() {},
      createLinearGradient: () => ({ addColorStop() {} }), toDataURL: () => 'data:,'
    });
    w.AudioContext = w.webkitAudioContext = function () {
      return {
        createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: {} }),
        createGain: () => ({ connect() {}, gain: { setValueAtTime() {} } }),
        destination: {}, currentTime: 0
      };
    };
    w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    w.scrollTo = () => {};
    w.fetch = () => Promise.reject(new Error('network disabled in tests'));
    w.addEventListener('error', e => runtimeErrors.push((e.error && e.error.stack) || e.message));
  }
});

const w = dom.window, d = w.document;

setTimeout(() => {
  // 2. clean boot
  eq(runtimeErrors.length, 0, 'no uncaught runtime errors during boot' +
     (runtimeErrors.length ? ': ' + runtimeErrors.slice(0, 2).join(' | ') : ''));

  // 3a. e-ink dock: the Type/Ink switch lives in the mode-bar, only the tools float, and the dock
  //     never shows in plain typing (guards the "empty pill" regression, build #126).
  const dock = d.getElementById('inkDock');
  ok(!!dock, 'inkDock element built');
  ok(!!(dock && d.getElementById('inkTools') && d.getElementById('inkTools').closest('#inkDock')),
     'inkDock holds the ink tools');
  ok(!(dock && dock.querySelector('.mode-switch')) &&
     !!(d.getElementById('deskbar') && d.getElementById('deskbar').querySelector('.mode-switch')),
     'Type/Ink switch stays in the deskbar (not the floating dock)');
  if (typeof w.inkDockVisible === 'function') {
    d.body.classList.remove('writing', 'insession'); ok(w.inkDockVisible() === false, 'dock hidden in Think + type mode');
    d.body.classList.add('writing'); ok(w.inkDockVisible() === false, 'dock hidden in Write prep + type mode');
    d.body.classList.add('insession'); ok(w.inkDockVisible() === false, 'dock hidden in Write session while typing');
    d.body.classList.remove('writing', 'insession');
  } else { ok(false, 'inkDockVisible() is defined'); }

  // 3b. guest comments: a reader only counts their OWN comment ids (guards the share-link privacy filter).
  if (typeof w.pubIsMine === 'function' && typeof w.pubAddMyId === 'function') {
    w.pubAddMyId('id-mine');
    ok(w.pubIsMine({ id: 'id-mine' }) === true, 'pubIsMine: own posted id matches');
    ok(w.pubIsMine({ id: 'id-other' }) === false, 'pubIsMine: someone else’s id does not match');
    ok(w.pubIsMine({ id: 'x', author_id: 'u1' }) === false, 'pubIsMine: no false match via author_id when signed out');
  } else { ok(false, 'pubIsMine/pubAddMyId are defined'); }

  // 3c. end-of-session transcription is async (so ink-only sessions transcribe before recap, build #122).
  ok(typeof w.endWritingSession === 'function' && w.endWritingSession.constructor.name === 'AsyncFunction',
     'endWritingSession is async');

  // 3d. dock is centred over the writing surface in JS (responsive across widths, build #130) — and
  //     never throws even with no layout (jsdom returns 0-size rects → falls back to viewport centre).
  ok(typeof w.positionInkDock === 'function', 'positionInkDock is defined');
  try { w.positionInkDock(); ok(true, 'positionInkDock runs without throwing'); }
  catch (e) { ok(false, 'positionInkDock threw: ' + e.message); }

  console.log('\nsmoke: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}, 700);
