// Cloudflare Worker for dystoria.net
// Serves the static site via the ASSETS binding, and handles POST /ai with
// Workers AI (binding: AI). Bindings + config live in wrangler.jsonc — no
// dashboard setup needed. Deploys on git push like the rest of the site.

const ALLOWED = ['https://dystoria.net', 'https://www.dystoria.net'];
// Supabase (public values) — used to verify the caller is a signed-in Dystoria user so the
// AI endpoint can't be hit anonymously to burn Workers AI neurons.
const SUPABASE_URL = 'https://gurwhrypskhzdledxeqk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bb709imkZ55IGfwcAqVGgQ_vTLHGodY';
const _tokCache = new Map();   // access token -> { user, t }
const _rate = new Map();       // user id -> [timestamps] (per-isolate soft limit)
async function verifyUser(token) {
  if (!token) return null;
  const now = Date.now();
  const c = _tokCache.get(token);
  if (c && now - c.t < 60000) return c.user;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_ANON_KEY } });
    if (!r.ok) return null;
    const u = await r.json();
    const user = u && u.id ? u.id : null;
    if (user) { _tokCache.set(token, { user, t: now }); if (_tokCache.size > 600) _tokCache.clear(); }
    return user;
  } catch (e) { return null; }
}
function rateOk(user, limit) {
  const now = Date.now();
  const arr = (_rate.get(user) || []).filter(t => now - t < 60000);
  if (arr.length >= limit) { _rate.set(user, arr); return false; }
  arr.push(now); _rate.set(user, arr);
  if (_rate.size > 3000) _rate.clear();
  return true;
}
// Soft per-user DAILY cap — defense-in-depth against a runaway loop quietly burning neurons.
// In-memory + per-isolate, so it's a backstop, not a hard guarantee; for a true global daily cap,
// bind a KV namespace in wrangler.jsonc and key counts there. Returns false once the cap is hit.
const _daily = new Map();   // user id -> { day, n }
function dailyOk(user, limit) {
  const day = Math.floor(Date.now() / 86400000);
  const d = _daily.get(user);
  if (!d || d.day !== day) { _daily.set(user, { day, n: 1 }); if (_daily.size > 5000) _daily.clear(); return true; }
  if (d.n >= limit) return false;
  d.n++; return true;
}
// Current Workers AI model. Lighter/cheaper alternative: '@cf/meta/llama-3.1-8b-instruct-fast'
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// Vision model — OCR + handwriting recognition. Used when the request carries an image.
const VISION_MODEL = '@cf/google/gemma-4-26b-a4b-it';
// Frontier models for ICON drawing + the description brief (kind:'icon'|'brief').
// Claude is used when ANTHROPIC_API_KEY is set (pay-per-use, far more reliable than the Gemini free tier);
// otherwise falls back to Gemini if GEMINI_API_KEY is set, otherwise to Workers AI.
const CLAUDE_MODEL = 'claude-sonnet-4-6';   // swap to 'claude-haiku-4-5-20251001' for lower cost, or 'claude-opus-4-8' for top quality
const FRONTIER_MODEL = 'gemini-2.5-flash';  // Gemini fallback model (free tier)

// data:image/png;base64,xxxx  ->  Array of byte values (Workers AI vision input)
function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function extractText(resp) {
  if (!resp) return '';
  let t = resp.response || resp.result || resp.description || resp.text || '';
  if (!t && resp.choices && resp.choices[0]) {
    t = (resp.choices[0].message && resp.choices[0].message.content) || resp.choices[0].text || '';
  }
  if (t && typeof t === 'object') t = JSON.stringify(t);
  return (t || '').toString().trim();
}
// True if the model just parroted the instruction back instead of reading the image.
function looksEchoed(text, instr) {
  const t = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return true;
  const p = (instr || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return p.length > 8 && t.includes(p.slice(0, Math.min(p.length, 28)));
}
// Vision input. Gemma (and OpenAI-compatible models) take the image as an `image_url` part
// inside the message content — NOT a top-level `image` param (which it ignores and then
// hallucinates). This is the documented schema for @cf/google/gemma-4-26b-a4b-it.
async function runVision(env, model, system, prompt, dataUrl, maxTokens) {
  const instr = prompt || 'Transcribe the text in this image.';
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: [
    { type: 'text', text: instr },
    { type: 'image_url', image_url: { url: dataUrl } },
  ] });
  let raw = null;
  try {
    const resp = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0.1 });
    raw = resp;
    const text = extractText(resp);
    if (text && !looksEchoed(text, instr)) return { text, raw: resp };
    raw = text ? { suspect: text.slice(0, 200) } : resp;
  } catch (e) { raw = { error: String(e) }; }
  return { text: '', raw };
}

// Frontier text generation via Google Gemini (AI Studio REST). Returns '' on any failure so the caller can fall back.
async function runFrontier(env, system, prompt, maxTokens, temperature) {
  const key = env.GEMINI_API_KEY;
  if (!key) return { text: '', error: 'no GEMINI_API_KEY' };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + FRONTIER_MODEL + ':generateContent?key=' + encodeURIComponent(key);
  const genCfg = {
    temperature: isFinite(temperature) ? temperature : 0.6,
    maxOutputTokens: Math.max(maxTokens, 2048),
  };
  // Flash/Lite can skip internal reasoning (thinkingBudget 0) so the full SVG fits the token budget. Pro can't disable it — leave it default there.
  if (/flash|lite/i.test(FRONTIER_MODEL)) genCfg.thinkingConfig = { thinkingBudget: 0 };
  const payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: genCfg };
  if (system) payload.system_instruction = { parts: [{ text: system }] };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { text: '', error: (data && data.error && data.error.message) || ('HTTP ' + r.status), status: r.status };
    let text = '';
    try { text = (data.candidates[0].content.parts || []).map(p => p.text || '').join(''); } catch (e) {}
    return { text: (text || '').trim(), raw: data };
  } catch (e) { return { text: '', error: String(e) }; }
}

function cors(origin) {
  const ok = !origin || ALLOWED.includes(origin) || origin.endsWith('.pages.dev') || origin.endsWith('.workers.dev');
  return {
    'Access-Control-Allow-Origin': ok ? (origin || 'https://dystoria.net') : 'https://dystoria.net',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

async function handleAI(request, env) {
  const headers = cors(request.headers.get('origin') || '');
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers });
  if (!env.AI) return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 500, headers });

  let body;
  try { body = await request.json(); }
  catch (e) { return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers }); }

  const system = String(body.system || '').slice(0, 4000);
  const prompt = String(body.prompt || '').slice(0, 24000);
  const image = typeof body.image === 'string' ? body.image : '';   // data URL (e.g. data:image/png;base64,...)
  if (!prompt && !image) return new Response(JSON.stringify({ error: 'no prompt' }), { status: 400, headers });

  // Require a signed-in Dystoria user (verified Supabase token), then throttle per user.
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const user = await verifyUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Sign in to use the AI features' }), { status: 401, headers });
  if (!rateOk(user, image ? 12 : 45)) return new Response(JSON.stringify({ error: 'Too many AI requests — give it a moment' }), { status: 429, headers });
  if (!dailyOk(user, image ? 400 : 1200)) return new Response(JSON.stringify({ error: 'You’ve hit today’s AI limit — it resets tomorrow. Reach out if you need more.' }), { status: 429, headers });

  const maxTokens = Math.min(Math.max(parseInt(body.max_tokens, 10) || 600, 64), 4096);
  const model = body.model || (image ? VISION_MODEL : MODEL);

  // ---- image (vision / OCR / handwriting) ----
  if (image) {
    try {
      const { text, raw } = await runVision(env, model, system, prompt, image, maxTokens);
      const out = { text };
      if (!text) out.debug = (() => { try { return JSON.stringify(raw).slice(0, 700); } catch (e) { return String(raw); } })();
      return new Response(JSON.stringify(out), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'AI vision error: ' + String(e) }), { status: 502, headers });
    }
  }

  // ---- text ----
  const temperature = (() => { const t = parseFloat(body.temperature); return isFinite(t) ? Math.min(Math.max(t, 0), 1.5) : 0.4; })();

  // Icon drawing + its description brief → frontier model (Gemini). When a key is set we commit to Gemini and do NOT
  // fall back to Workers AI: the free Workers-AI neuron pool is tiny and falling back just burns it / errors (4006),
  // and a llama icon would be low quality anyway. Surface the real reason so the client can retry.
  if ((body.kind === 'icon' || body.kind === 'brief') && env.GEMINI_API_KEY) {
    const fr = await runFrontier(env, system, prompt, maxTokens, temperature);
    if (fr.text) return new Response(JSON.stringify({ text: fr.text, via: 'frontier' }), { headers });
    const err = fr.error || '';
    if (/per day|PerDay|daily|quota.*exceeded|exceeded.*quota/i.test(err)) return new Response(JSON.stringify({ error: 'Dystoria’s image AI is at today’s shared free limit (Gemini) — it resets tomorrow.', limit: 'day' }), { status: 429, headers });
    if (/rate|429|RESOURCE_EXHAUSTED|quota/i.test(err)) return new Response(JSON.stringify({ error: 'The image model is busy for a moment — try again shortly.' }), { status: 429, headers });
    return new Response(JSON.stringify({ error: 'Image model error — try again.' + (err ? ' (' + err + ')' : '') }), { status: 502, headers });
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const base = { messages, max_tokens: maxTokens, temperature };

  try {
    let resp;
    if (body.json) {
      // JSON mode where the model supports it; fall back gracefully otherwise
      try { resp = await env.AI.run(model, { ...base, response_format: { type: 'json_object' } }); }
      catch (e) { resp = await env.AI.run(model, base); }
    } else {
      resp = await env.AI.run(model, base);
    }
    const text = extractText(resp);
    return new Response(JSON.stringify({ text }), { headers });
  } catch (e) {
    const em = String(e);
    // Account-wide Workers AI daily free cap (10,000 neurons). Normalise to a clear, tagged message.
    if (/4006|neuron|free allocation|exhaust/i.test(em)) return new Response(JSON.stringify({ error: 'Dystoria’s AI is at today’s shared free limit (Cloudflare Workers AI) — it resets tomorrow.', limit: 'day' }), { status: 429, headers });
    return new Response(JSON.stringify({ error: 'AI error: ' + em }), { status: 502, headers });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ai') return handleAI(request, env);
    // everything else → the static site
    return env.ASSETS.fetch(request);
  },
};
