# Dystoria as an installable app (PWA) — sketch

Nothing here is live until `index.html` references it. What's in the repo now is inert:

| file | what it is | live? |
|---|---|---|
| `/manifest.webmanifest` | name, icons, colours, `display: standalone` — what the OS shows when Dystoria is installed | not until linked from `<head>` |
| `/sw.js` | the service worker: offline launch, cached fonts/SDK/datasets, network-first for the app itself | not until registered |
| `/icons/*` | the ember quill, rendered from the favicon SVG at 192/512, a maskable 512 for Android, a 180 apple-touch-icon, and a 1024 source | referenced by the manifest |
| `/_headers` | two added rules so `sw.js` and the manifest are never stale | live (harmless) |
| `tests/pwa/pwa_head_snippet.html` | the eight `<head>` lines | to be spliced |
| `tests/pwa/pwa_layer.html` | `<style id="dyst-pwa">` + `<script id="dyst-pwa-js">`: registers the worker, catches the install prompt, adds Settings → Data → **This device → Install Dystoria**, sets `body.dyst-standalone` | to be spliced |
| `tests/pwa/apply_pwa.js` | splices both into a copy of `index.html` (head after `<title>`, layer before the FINAL `</body></html>`); refuses to double-apply | tool |
| `tests/pwa/verify.js` | Playwright run against the real app: install → precache → API bypass → network-first → offline reload, `?home`, `#/read/…`, datasets → first-visit offline page → standalone class → screenshot | tool |

## To ship it

1. `node tests/pwa/apply_pwa.js index.html /tmp/index_pwa.html` then review and copy over `index.html`
   (or just paste the two snippets by hand — the head bit after `<title>Dystoria</title>`, the layer with the other `dyst-*` layers at the bottom).
2. Bump `APP_VERSION`, add the changelog entry ("Dystoria can now be installed as an app — Settings → Data → This device. It opens offline too.").
3. `sudo node tests/pwa/verify.js` (sudo only so the fake CDN can bind :443; without it the third-party cache checks are skipped, everything else still runs). Expect all PASS.
4. Deploy with wrangler as usual. Then in Chrome: DevTools → Application → Manifest should show no warnings and an **Install** link; Lighthouse's PWA audit should be green.
5. Try it: install on the Mac (Chrome: address-bar icon; Safari: File → Add to Dock), quit Wi-Fi, launch from the Dock.

## Design decisions (short version — the long one is in the project doc)

- **The app stays network-first.** Deploys still show up on the next load and the existing "New version available → Back up & update" banner works unchanged. The cache is only for when the network is gone or slower than 8 s — and a late response still lands in the cache so the next launch is current.
- **Nothing with user data or money is touched**: `/ai`, `/version`, `/billing/*`, `/hooks/*`, Supabase, Stripe, PostHog are not handled by the worker at all.
- **Sounds are not cached** (Range requests). Ambience needs the network; everything else works offline.
- **The worker's own version (`SW_VERSION`) is separate from `APP_VERSION`.** Bump it only when `sw.js` changes — that purges old caches.

## Gotchas to know before telling writers about it

- **Safari/iOS installs start empty.** A Home-Screen / Dock web app on Apple platforms gets its own storage, separate from Safari's — so local-only stories don't carry across; signing in restores everything from the cloud. Chrome/Edge desktop installs share the browser profile, so they carry over.
- **Stripe checkout** navigates out of scope; Chrome shows it in an in-app browser bar and returns on `success_url`. Fine, just looks different from a tab.
- Headless Chromium never fires `beforeinstallprompt`, so the Settings row shows the per-browser hint there — that is the expected fallback, not a bug.
