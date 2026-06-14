# Dystoria — AI wiki (Cloudflare Workers AI) setup

The AI summaries run through a Cloudflare Pages Function (`functions/ai.js`) that uses
**Cloudflare Workers AI** — no API key, no Google account. You just bind Workers AI to the
Pages project once.

## 1. Add the Workers AI binding
- Cloudflare dashboard → **Workers & Pages** → your `dystoria` Pages project.
- **Settings → Functions** (or **Bindings**) → **Add binding** → choose **Workers AI**.
- Set the **Variable name** to exactly **`AI`** → Save.
- Add it for **Production** (and Preview if you use preview deploys).

## 2. Deploy
- Commit & push (`functions/ai.js` + the updated `index.html`) in GitHub Desktop.
- Cloudflare redeploys and exposes `functions/ai.js` as the `/ai` endpoint.
- Bindings take effect on the next deploy — if you added the binding after your last push,
  push again or trigger a redeploy.

## 3. Test
- Open dystoria.net → **Story Wiki** (hamburger menu) → expand an element →
  **Summarize with AI ✦**. You should get a short, grounded summary.
- Or use **AI overview of the story ✦** at the top of the panel.

### If it errors
- *"AI isn’t set up yet"* → the `AI` binding is missing or the deploy predates it.
  Re-check step 1 (variable name must be exactly `AI`), then redeploy.
- *"AI endpoint unreachable"* → the function didn’t deploy. Confirm `functions/` is at the
  repo root and the push succeeded. Only works on the live site, not a local file.

## Notes
- Free tier is **10,000 "neurons"/day**, plenty for summarizing elements. Summaries are
  **cached** in the story and only offer a refresh when the prose changes.
- Each summary sends **only that element’s prose excerpts** (or, for the overview, the story
  text) to Workers AI. The UI discloses this; mention it to beta users.
- Model is `@cf/meta/llama-3.1-8b-instruct`. To change it, edit `MODEL` in `functions/ai.js`
  (any Workers AI text-generation model id works).
