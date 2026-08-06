# Dystoria — ✦ Research setup (worker route)

The Research drawer (v.351) sends `kind:'research'` to the same `/ai` endpoint. The
route is already wired into `worker.js`:

- **Pro / admin** → **Perplexity Sonar** (real retrieved sources; needs a paid key)
- **Free tier, or any Sonar failure** → **Gemini + Google-Search grounding** (free
  allowance; grounding metadata carries really-retrieved URLs)

The app renders sources ONLY from the returned array and refuses to stage an answer
that comes back without sources — so this route never has to fake a citation.

## Deploy: just push
`worker.js` is deployed by Cloudflare on push, same as everything else. Commit &
push in GitHub Desktop and the route is live.

**Gemini-grounded research works immediately** — `GEMINI_API_KEY` is already set.

## Optional: enable Sonar (better citations, Pro/admin only)
1. Create an API key at https://www.perplexity.ai/settings/api (requires a payment
   method; the base `sonar` model costs ~$0.20 per million tokens + $5 per 1,000
   searches — a research question is roughly half a cent).
2. Add it as a secret to the `dystoria` Worker — either:
   - Cloudflare dashboard → Workers & Pages → `dystoria` → **Settings →
     Variables & Secrets** → Add → type **Secret**, name `PERPLEXITY_API_KEY`, or
   - terminal, from this folder: `npx wrangler secret put PERPLEXITY_API_KEY`
3. Nothing else — the route detects the key and starts leading with Sonar for
   Pro/admin accounts. Remove the key and it falls back to Gemini seamlessly.

## Test
1. Push, wait for the deploy, hard-refresh dystoria.net.
2. Revise → **Research** tab (right rail, under Checks) → ask something like
   “How were Victorian séances staged?”
3. The answer should show inline [1] [2] markers and a **Sources** list of real
   links, with `via gemini-grounded` (or `via perplexity-sonar`) in the header.
4. If it shows the “No live sources” warning instead, the route isn’t deployed
   yet (or both providers failed) — check the Worker logs.

## Quotas
Research shares the existing per-user rate + daily caps (it runs through the same
gates in `handleAI`). No separate limit is needed at current volumes; if research
grows heavy, add a distinct KV day-bucket like the global one, keyed
`research:<userId>`.
