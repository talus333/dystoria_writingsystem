// Headless verification of the PWA sketch against the real index.html.
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
// Usage: node tests/pwa/verify.js            (from the repo root; sudo lets it bind :443 for the fake CDN)
// Builds a PWA-applied copy of index.html in a temp dir and drives it through Playwright:
// install, precache, API bypass, network-first, offline boot + deep links, standalone class.
const os = require('os'), cp = require('child_process');
const REPO = path.resolve(__dirname, '..', '..');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dyst-pwa-'));
for (const f of ['welcome_undaunted.html', 'manifest.webmanifest', 'sw.js']) fs.copyFileSync(path.join(REPO, f), path.join(ROOT, f));
fs.mkdirSync(path.join(ROOT, 'icons')); for (const f of fs.readdirSync(path.join(REPO, 'icons'))) fs.copyFileSync(path.join(REPO, 'icons', f), path.join(ROOT, 'icons', f));
cp.execFileSync('node', [path.join(__dirname, 'apply_pwa.js'), path.join(REPO, 'index.html'), path.join(ROOT, 'index_pwa.html')], { stdio: 'inherit' });
const TLS = path.join(ROOT, 'tls'); fs.mkdirSync(TLS);
cp.execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(TLS, 'key.pem'), '-out', path.join(TLS, 'cert.pem'), '-days', '2', '-subj', '/CN=localhost',
  '-addext', 'subjectAltName=DNS:cdn.jsdelivr.net,DNS:fonts.googleapis.com,DNS:fonts.gstatic.com'], { stdio: 'ignore' });
const CHROME = process.env.CHROME || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const PORT = 8765;
const hits = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  hits.push(u.pathname);
  const send = (file, type, extra) => {
    const b = fs.readFileSync(file);
    res.writeHead(200, Object.assign({ 'Content-Type': type, 'Content-Length': b.length }, extra || {}));
    res.end(b);
  };
  if (u.pathname === '/') return send(path.join(ROOT, 'index_pwa.html'), 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache, must-revalidate' });
  if (u.pathname === '/index.html') { res.writeHead(301, { Location: '/' }); return res.end(); }
  if (u.pathname === '/version') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('2026.07.20.498'); }
  if (u.pathname === '/ai') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
  const f = path.join(ROOT, u.pathname);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) {
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.webmanifest') ? 'application/manifest+json'
      : f.endsWith('.png') ? 'image/png' : f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain';
    return send(f, type, u.pathname.startsWith('/data/') ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {});
  }
  res.writeHead(404); res.end('nf');
});

const cdnHits = [];
const STUB_SDK = `window.supabase = { createClient: function(){
  var chain = { then: function(res){ return Promise.resolve({ data: [], error: null }).then(res); } };
  ['select','eq','neq','in','order','limit','single','maybeSingle','upsert','insert','update','delete','match','is','gte','lte','range','textSearch'].forEach(function(k){ chain[k] = function(){ return chain; }; });
  return { auth: { getSession: function(){ return Promise.resolve({ data: { session: null }, error: null }); },
                   getUser: function(){ return Promise.resolve({ data: { user: null }, error: null }); },
                   onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
                   signOut: function(){ return Promise.resolve({}); } },
           from: function(){ return chain; }, rpc: function(){ return chain; },
           channel: function(){ var c = { on: function(){ return c; }, subscribe: function(){ return c; } }; return c; } };
} };`;
const cdn = https.createServer({ key: fs.readFileSync(path.join(TLS, 'key.pem')), cert: fs.readFileSync(path.join(TLS, 'cert.pem')) }, (req, res) => {
  const host = req.headers.host; const u = new URL(req.url, 'https://' + host);
  cdnHits.push(host + u.pathname);
  if (host.startsWith('cdn.jsdelivr.net')) { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Access-Control-Allow-Origin': '*' }); return res.end(STUB_SDK); }
  if (host.startsWith('fonts.googleapis.com')) { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end("@font-face{font-family:'Cinzel';src:url(https://fonts.gstatic.com/s/cinzel.woff2) format('woff2')}"); }
  if (host.startsWith('fonts.gstatic.com')) { res.writeHead(200, { 'Content-Type': 'font/woff2', 'Access-Control-Allow-Origin': '*' }); return res.end(Buffer.from('wOF2fake')); }
  res.writeHead(404); res.end();
});

(async () => {
  let fakeCdn = true;
  await new Promise(r => { cdn.once('error', () => { fakeCdn = false; r(); }); cdn.listen(443, r); });
  if (!fakeCdn) console.warn('could not bind :443 — run with sudo to exercise the fake CDN; third-party cache checks will be SKIPPED');
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'probe.txt'), 'dataset-bytes');
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: CHROME,
    args: !fakeCdn ? [] : ['--host-resolver-rules=MAP cdn.jsdelivr.net 127.0.0.1, MAP fonts.googleapis.com 127.0.0.1, MAP fonts.gstatic.com 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server'] });
  const ctxOpts = { viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true };
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
  const results = {};
  const ok = (k, v, note) => { results[k] = v ? 'PASS' : 'FAIL' + (note ? ' — ' + note : ''); };
  const okCdn = (k, v, note) => { results[k] = fakeCdn ? (v ? 'PASS' : 'FAIL' + (note ? ' — ' + note : '')) : 'SKIPPED (no fake CDN)'; };

  // 1. online boot, SW installs and precaches
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => {
    const names = await caches.keys(); if (!names.length) return false;
    const c = await caches.open('dyst-sw-1:shell');
    return !!(await c.match('/')) && !!(await c.match('/welcome_undaunted.html'));
  }, null, { timeout: 30000 });
  const cacheState = await page.evaluate(async () => {
    const out = {};
    for (const n of await caches.keys()) out[n] = (await (await caches.open(n)).keys()).map(r => r.url);
    return out;
  });
  ok('precache_shell', cacheState['dyst-sw-1:shell'].some(u => u.endsWith('/')) && cacheState['dyst-sw-1:shell'].some(u => u.endsWith('/welcome_undaunted.html')));
  okCdn('precache_supabase_js', (cacheState['dyst-sw-1:runtime'] || []).some(u => u.includes('cdn.jsdelivr.net')), JSON.stringify(cacheState['dyst-sw-1:runtime']));
  ok('manifest_link', await page.evaluate(() => !!document.querySelector('link[rel="manifest"]')));
  ok('settings_row_present', await page.evaluate(() => !!document.querySelector('#setInstallGrp #installAppBtn')));
  ok('body_not_standalone_in_browser', await page.evaluate(() => !document.body.classList.contains('dyst-standalone')));
  okCdn('app_booted_online', await page.evaluate(() => !!document.getElementById('deskbar') && typeof goMode === 'function' && !!window.supabase));
  results.cdn_requests_seen_by_fake_cdn = cdnHits.slice();
  results.page_errors_online = errors.slice();

  // 2. API bypass: /version and /ai must reach the server (SW does not handle them)
  const before = hits.length;
  await page.evaluate(() => fetch('/version?t=1', { cache: 'no-store' }).then(r => r.text()));
  await page.evaluate(() => fetch('/ai', { method: 'GET' }).then(r => r.status));
  ok('api_bypass_to_server', hits.slice(before).includes('/version') && hits.slice(before).includes('/ai'));
  // data cache-first primes on first use
  await page.evaluate(() => fetch('/data/probe.txt').then(r => r.text()));

  // 3. network-first: an online reload must hit the server for '/'
  const b2 = hits.length;
  await page.reload({ waitUntil: 'load' });
  ok('network_first_online_reload_hits_server', hits.slice(b2).includes('/'));
  await page.waitForFunction(async () => { const ks = (await (await caches.open('dyst-sw-1:runtime')).keys()).map(r => r.url); return ks.some(u => u.includes('fonts.googleapis.com')) && ks.some(u => u.includes('fonts.gstatic.com')); }, null, { timeout: 15000 }).catch(() => {});
  const rt = await page.evaluate(async () => (await (await caches.open('dyst-sw-1:runtime')).keys()).map(r => r.url));
  okCdn('runtime_cache_fonts', rt.some(u => u.includes('fonts.googleapis.com')) && rt.some(u => u.includes('fonts.gstatic.com')), JSON.stringify(rt));

  // 4. offline: reload, deep links, data, and APIs
  await ctx.setOffline(true);
  errors.length = 0;
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url()));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  okCdn('offline_no_failed_font_or_sdk_requests', !failed.some(u => /fonts\.g|jsdelivr/.test(u)), failed.filter(u => /fonts\.g|jsdelivr/.test(u)).join(', '));
  results.offline_failed_requests = failed.slice(0, 12);
  ok('offline_reload_boots', await page.evaluate(() => !!document.getElementById('deskbar') && typeof goMode === 'function'));
  results.page_errors_offline = errors.slice();
  okCdn('offline_sdk_from_cache', await page.evaluate(() => !!(window.supabase && window.supabase.createClient)));
  await page.goto(`http://127.0.0.1:${PORT}/?home`, { waitUntil: 'load' });
  ok('offline_query_route', await page.evaluate(() => typeof goMode === 'function'));
  await page.goto(`http://127.0.0.1:${PORT}/#/read/0123456789ab`, { waitUntil: 'load' });
  ok('offline_hash_route', await page.evaluate(() => typeof goMode === 'function'));
  ok('offline_data_cached', await page.evaluate(() => fetch('/data/probe.txt').then(r => r.text()).then(t => t === 'dataset-bytes').catch(() => false)));
  ok('offline_version_not_faked', await page.evaluate(() => fetch('/version?t=2', { cache: 'no-store' }).then(() => false).catch(() => true)));
  ok('offline_welcome_iframe', await page.evaluate(() => new Promise(res => { const f = document.createElement('iframe'); f.src = '/welcome_undaunted.html'; f.onload = () => { try { res(f.contentDocument && f.contentDocument.documentElement.outerHTML.length > 1000); } catch(e){ res(false); } }; f.onerror = () => res(false); document.body.appendChild(f); setTimeout(() => res(false), 8000); })));
  // first-ever visit with no cache → the offline page (simulate by wiping the shell cache)
  await page.evaluate(async () => { await caches.delete('dyst-sw-1:shell'); });
  const r = await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  ok('offline_page_when_nothing_cached', r.status() === 503 && (await page.content()).includes('You’re offline'));
  await ctx.setOffline(false);

  // 5. back online → the app comes back and re-caches
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  ok('online_again', await page.evaluate(() => typeof goMode === 'function'));
  await page.waitForFunction(async () => !!(await (await caches.open('dyst-sw-1:shell')).match('/')), null, { timeout: 15000 });
  ok('recached_after_reconnect', true);

  // 6. standalone class when launched as an installed app
  const ctx2 = await browser.newContext(ctxOpts);
  const p2 = await ctx2.newPage();
  await p2.emulateMedia({ media: 'screen' });
  await p2.addInitScript(() => {
    const orig = window.matchMedia;
    window.matchMedia = q => q.includes('display-mode: standalone') ? { matches: true, addEventListener(){}, removeEventListener(){} } : orig.call(window, q);
  });
  await p2.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  ok('standalone_body_class', await p2.evaluate(() => document.body.classList.contains('dyst-standalone') && !document.getElementById('installAppBtn') && !!document.querySelector('#setInstallGrp .pwa-hint')));

  // 7. screenshot of the Settings → Data panel with the new row
  await page.evaluate(() => { const l = document.getElementById('landingFrame'); if (l) l.remove(); document.querySelectorAll('[id^="tour"],[id^="onb"]').forEach(n => n.remove()); });
  await page.evaluate(() => { const sm = document.getElementById('settingsModal'); sm.classList.add('show'); const t = sm.querySelector('[data-tab="data"],[data-panel-btn="data"]'); if (t) t.click(); sm.querySelectorAll('.set-panel').forEach(p => p.style.display = p.dataset.panel === 'data' ? 'block' : 'none'); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ROOT, 'settings_install_row.png') });
  results.screenshot = path.join(ROOT, 'settings_install_row.png');

  console.log(JSON.stringify(results, null, 2));
  const bad = Object.values(results).filter(v => typeof v === 'string' && v.startsWith('FAIL')).length;
  await browser.close(); server.close(); if (fakeCdn) cdn.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('VERIFY CRASH', e); process.exit(1); });
