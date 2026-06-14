# Dystoria — AI wiki (Cloudflare Workers AI) setup

Your `dystoria` deploy is a **Cloudflare Worker with static assets** (not a Pages project),
so the AI lives in `worker.js`, configured by `wrangler.jsonc`. The Worker:
- serves the whole site through the `ASSETS` binding, and
- handles `POST /ai` using **Workers AI** (binding `AI`) — no API key, no Google account.

## Setup: just push
The AI binding and assets config are declared in `wrangler.jsonc`, so there is **no dashboard
step**. Commit & push these files in GitHub Desktop:
- `worker.js` (new)
- `wrangler.jsonc` (new)
- `.assetsignore` (new — keeps `.git`, docs, etc. out of the public site)
- deletion of `functions/ai.js`

Cloudflare builds and deploys on push, the same way your other changes have been going live.

## Test
- dystoria.net → **Story Wiki** → expand an element → **Summarize with AI ✦**
  (or **AI overview of the story ✦** at the top).
- Direct check: visiting **https://dystoria.net/ai** in a browser should now show
  `{"error":"POST only"}` (405) instead of a 404 — that means the route is live.

## If it still 404s after deploying
The build's deploy command is `npx wrangler versions upload`, which uploads a version. If your
production traffic isn't picking up new versions automatically:
- Cloudflare → your `dystoria` Worker → **Settings → Build** → set the **Deploy command** to
  `npx wrangler deploy` → save → redeploy. (`wrangler deploy` pushes straight to production.)

## Notes
- Free tier: **10,000 "neurons"/day** — ample, and summaries are cached in the story (refresh
  only offered when the prose changes).
- Each summary sends only that element's prose excerpts (or, for the overview, the story text)
  to Workers AI. The UI discloses this.
- Model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (current, good quality). For lower
  neuron cost, swap `MODEL` in `worker.js` to `@cf/meta/llama-3.1-8b-instruct-fast`.
  See the live catalog: https://developers.cloudflare.com/workers-ai/models/
