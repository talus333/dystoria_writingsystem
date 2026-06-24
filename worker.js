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

// Gemini (AI Studio REST). Returns '' on any failure so the caller can fall back.
async function runGemini(env, system, prompt, maxTokens, temperature, model, jsonMode) {
  const key = env.GEMINI_API_KEY;
  if (!key) return { text: '', error: 'no GEMINI_API_KEY' };
  model = model || FRONTIER_MODEL;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
  const genCfg = {
    temperature: isFinite(temperature) ? temperature : 0.6,
    maxOutputTokens: Math.max(maxTokens, 2048),
  };
  // Flash/Lite can skip internal reasoning (thinkingBudget 0) so the full SVG fits the token budget. Pro can't disable it — leave it default there.
  if (/flash|lite/i.test(model)) genCfg.thinkingConfig = { thinkingBudget: 0 };
  if (jsonMode) genCfg.responseMimeType = 'application/json';
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

// Claude (Anthropic Messages API). Preferred for icons when ANTHROPIC_API_KEY is set.
async function runClaude(env, system, prompt, maxTokens, temperature) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return { text: '', error: 'no ANTHROPIC_API_KEY' };
  const payload = {
    model: CLAUDE_MODEL,
    max_tokens: Math.min(Math.max(maxTokens, 1024), 4096),
    temperature: isFinite(temperature) ? Math.min(Math.max(temperature, 0), 1) : 0.7,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) payload.system = system;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { text: '', error: (data && data.error && data.error.message) || ('HTTP ' + r.status), status: r.status };
    let text = '';
    try { text = (data.content || []).map(b => (b && b.type === 'text') ? b.text : '').join(''); } catch (e) {}
    return { text: (text || '').trim(), raw: data };
  } catch (e) { return { text: '', error: String(e) }; }
}

// OpenAI-compatible chat endpoint — covers most free providers (Groq, Mistral, OpenRouter, Together, DeepSeek, Cerebras…).
async function runOpenAICompat(key, url, model, system, prompt, maxTokens, temperature, extraHeaders, jsonMode) {
  if (!key) return { text: '', error: 'no key' };
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const payload = { model, messages, max_tokens: Math.max(maxTokens, 1024), temperature: isFinite(temperature) ? temperature : 0.6 };
  if (jsonMode) payload.response_format = { type: 'json_object' };
  try {
    const r = await fetch(url, { method: 'POST',
      headers: Object.assign({ 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, extraHeaders || {}),
      body: JSON.stringify(payload) });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { text: '', error: (data && data.error && (data.error.message || data.error)) || ('HTTP ' + r.status), status: r.status };
    let text = '';
    try { text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ''; } catch (e) {}
    return { text: (text || '').trim(), raw: data };
  } catch (e) { return { text: '', error: String(e) }; }
}
// Workers AI (the always-available last resort).
async function runWorkersChat(env, system, prompt, maxTokens, temperature, jsonMode) {
  if (!env.AI) return { text: '', error: 'no Workers AI' };
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const base = { messages, max_tokens: Math.min(maxTokens, 4096), temperature: isFinite(temperature) ? temperature : 0.4 };
  try {
    let resp;
    if (jsonMode) { try { resp = await env.AI.run(MODEL, { ...base, response_format: { type: 'json_object' } }); } catch (e) { resp = await env.AI.run(MODEL, base); } }
    else resp = await env.AI.run(MODEL, base);
    return { text: extractText(resp), raw: resp };
  } catch (e) { return { text: '', error: String(e) }; }
}

// Quality-ranked model chain (best → worst). An entry is included only when its key/binding is present.
// `paid` entries are skipped for free-tier requests; `last` (Workers AI) is skipped for icon SVG (too low quality).
// To add a free model: get its key, add it as a CF secret, and add ONE line here in the right rank slot.
function modelChain(env) {
  const c = [];
  if (env.ANTHROPIC_API_KEY)  c.push({ name: 'claude', paid: true, run: (s, p, mt, t, j) => runClaude(env, s, p, mt, t) });
  if (env.GEMINI_API_KEY)     c.push({ name: 'gemini-2.5-pro',   run: (s, p, mt, t, j) => runGemini(env, s, p, mt, t, 'gemini-2.5-pro', j) });
  if (env.GEMINI_API_KEY)     c.push({ name: 'gemini-2.5-flash', run: (s, p, mt, t, j) => runGemini(env, s, p, mt, t, 'gemini-2.5-flash', j) });
  if (env.GROQ_API_KEY)       c.push({ name: 'groq-llama-70b',   run: (s, p, mt, t, j) => runOpenAICompat(env.GROQ_API_KEY, 'https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile', s, p, mt, t, null, j) });
  if (env.MISTRAL_API_KEY)    c.push({ name: 'mistral-large',    run: (s, p, mt, t, j) => runOpenAICompat(env.MISTRAL_API_KEY, 'https://api.mistral.ai/v1/chat/completions', 'mistral-large-latest', s, p, mt, t, null, j) });
  if (env.OPENROUTER_API_KEY) c.push({ name: 'openrouter-free',  run: (s, p, mt, t, j) => runOpenAICompat(env.OPENROUTER_API_KEY, 'https://openrouter.ai/api/v1/chat/completions', 'meta-llama/llama-3.3-70b-instruct:free', s, p, mt, t, { 'HTTP-Referer': 'https://dystoria.net', 'X-Title': 'Dystoria' }, j) });
  if (env.AI)                 c.push({ name: 'workers-ai', last: true, run: (s, p, mt, t, j) => runWorkersChat(env, s, p, mt, t, j) });
  return c;
}
const _cooldown = new Map();   // provider name → epoch ms until which to skip it (set when it hits a DAILY quota)
function isQuotaErr(e) { return /per ?day|daily|quota|exhaust|4006|neuron|insufficient|billing|credit/i.test(String(e || '')); }

// Try the chain in quality order; skip cooled-down providers; fall through on busy/empty/quota to the next.
// opts.allowPaid=false → free tier (skip Claude); opts.allowLast=false → skip the Workers-AI llama (used for icon SVG).
async function runFrontier(env, system, prompt, maxTokens, temperature, opts) {
  opts = opts || {};
  let chain = modelChain(env);
  if (opts.allowPaid === false) chain = chain.filter(p => !p.paid);
  if (opts.allowLast === false) chain = chain.filter(p => !p.last);
  const now = Date.now();
  let lastErr = '';
  for (const p of chain) {
    if ((_cooldown.get(p.name) || 0) > now) continue;                       // recently used up — skip for now
    const r = await p.run(system, prompt, maxTokens, temperature, opts.json);
    if (r && r.text) return { text: r.text, via: p.name };
    lastErr = (r && r.error) || lastErr;
    if (isQuotaErr(lastErr)) _cooldown.set(p.name, now + 60 * 60 * 1000);   // daily-ish quota → rest this provider for an hour
  }
  return { text: '', error: lastErr || 'all models unavailable', exhausted: isQuotaErr(lastErr) };
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

  // Icon drawing + its description brief → quality-ranked model chain (Claude → Gemini Pro → Gemini Flash → Groq → … → Workers AI).
  // The chain auto-falls-through when a model is busy or its daily quota is used up. Icons skip the Workers-AI llama (too low quality);
  // briefs may use it as a final resort. `tier:'free'` skips the paid (Claude) model.
  if (body.kind === 'icon' || body.kind === 'brief') {
    const fr = await runFrontier(env, system, prompt, maxTokens, temperature, { allowPaid: body.tier !== 'free', allowLast: body.kind !== 'icon' });
    if (fr.text) return new Response(JSON.stringify({ text: fr.text, via: fr.via }), { headers });
    const err = fr.error || '';
    if (fr.exhausted) return new Response(JSON.stringify({ error: 'Dystoria’s free AI models are all at today’s limit — they reset tomorrow, or upgrade for the priority model.', limit: 'day' }), { status: 429, headers });
    if (/rate|429|busy|RESOURCE_EXHAUSTED/i.test(err)) return new Response(JSON.stringify({ error: 'The image models are busy for a moment — try again shortly.' }), { status: 429, headers });
    return new Response(JSON.stringify({ error: 'Image model error — try again.' + (err ? ' (' + err + ')' : '') }), { status: 502, headers });
  }

  // ---- general text tasks (writing prompts, Wiki rollups, Import extraction, Refine, etc.) ----
  // Route through the FREE model chain (Gemini → Groq → Mistral → … → Workers AI) for quality + resilience.
  // Skip the paid Claude (allowPaid:false) — Claude is reserved for the premium icon path. Pass json mode through.
  const tr = await runFrontier(env, system, prompt, maxTokens, temperature, { allowPaid: body.tier === 'pro', json: !!body.json });
  if (tr.text) return new Response(JSON.stringify({ text: tr.text, via: tr.via }), { headers });
  const terr = tr.error || '';
  if (tr.exhausted) return new Response(JSON.stringify({ error: 'Dystoria’s free AI models are all at today’s limit — they reset tomorrow.', limit: 'day' }), { status: 429, headers });
  return new Response(JSON.stringify({ error: 'AI error: ' + terr }), { status: 502, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ai') return handleAI(request, env);
    // everything else → the static site
    return env.ASSETS.fetch(request);
  },
};
