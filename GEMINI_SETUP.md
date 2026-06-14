# Dystoria — AI wiki (Gemini) setup

The AI summaries run through a Cloudflare Pages Function (`functions/ai.js`) that holds your
Gemini key server-side, so the key is never in the browser. One-time setup:

## 1. Get a free Gemini API key
- Go to **Google AI Studio** → https://aistudio.google.com/apikey
- Sign in → **Create API key** → copy it. (Free tier, no card.)

## 2. Add the key to your Cloudflare Pages project
- Cloudflare dashboard → **Workers & Pages** → your `dystoria` Pages project → **Settings** → **Variables and Secrets** (Environment variables).
- Add a variable named exactly **`GEMINI_KEY`**, paste the key as the value.
- Add it to **both Production and Preview** environments → Save.

## 3. Deploy
- Commit & push (`functions/ai.js` + the updated `index.html`) in GitHub Desktop.
- Cloudflare redeploys; Pages automatically turns `functions/ai.js` into the `/ai` endpoint.
- (Environment variables only take effect on a deploy made *after* they're added — if you added the key after the last push, just push again or re-deploy.)

## 4. Test
- Open dystoria.net → **Story Wiki** (hamburger menu) → expand an element → **Summarize with AI ✦**.
- You should get a short grounded summary. Or use **AI overview of the story ✦** at the top.

### If it errors
- *"AI isn’t set up yet"* → `GEMINI_KEY` missing or the deploy predates it. Re-check step 2, redeploy.
- *"AI endpoint unreachable"* → the function didn’t deploy. Confirm `functions/` is at the repo root and the push succeeded; only works on the live site (not a local file).
- *"Gemini free limit reached"* → you hit the daily free quota; try later.

## Notes
- Summaries are **cached** in the story (per element, and the story overview), and only offer a
  refresh when the prose changes — so you stay well inside the free daily limit.
- Each summary sends **only that element’s prose excerpts** (or, for the overview, the story
  text) to Google Gemini. The UI discloses this; mention it to beta users.
- Model is `gemini-2.5-flash`. To change it, edit the `model` default in `functions/ai.js`.
