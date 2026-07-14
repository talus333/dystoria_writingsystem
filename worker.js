// Cloudflare Worker for dystoria.net
// Serves the static site via the ASSETS binding, and handles POST /ai with
// Workers AI (binding: AI). Bindings + config live in wrangler.jsonc — no
// dashboard setup needed. Deploys on git push like the rest of the site.

const ALLOWED = ['https://dystoria.net', 'https://www.dystoria.net'];
// Supabase (public values) — used to verify the caller is a signed-in Dystoria user so the
// AI endpoint can't be hit anonymously to burn Workers AI neurons.
const SUPABASE_URL = 'https://gurwhrypskhzdledxeqk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bb709imkZ55IGfwcAqVGgQ_vTLHGodY';
// Admin accounts: the only users allowed the paid Claude model + the per-model testing toggles.
// Everyone else runs the free chain only (enforced server-side in runFrontier — can't be bypassed by the client).
const ADMIN_EMAILS = ['jeremyplante7@gmail.com'];
function isAdminEmail(e) { return ADMIN_EMAILS.includes(String(e || '').toLowerCase()); }
// Set true ONCE you turn on "Confirm email" in Supabase → Auth → Providers → Email. Until then, leave false
// so brand-new signups can use the AI before they click the confirmation link.
const REQUIRE_CONFIRMED_EMAIL = false;
// Hard ceiling on total AI calls per day across ALL users — a coarse KV-backed backstop against a runaway
// bill. Set via env (a plain var in wrangler.jsonc), e.g. "5000". 0/unset = no global cap (billing alerts
// remain the true hard stop — see the deploy notes). The precise stop is the Cloudflare/Anthropic spend cap.
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
    // Reject ANONYMOUS accounts (guest commenters use these) and email-less/unconfirmed users: otherwise
    // each throwaway anon token is a fresh AI quota, so the per-user caps mean nothing. Real signups only.
    if (!u || !u.id) return null;
    if (u.is_anonymous === true) return null;
    const email = String(u.email || '').toLowerCase();
    if (!email) return null;
    if (REQUIRE_CONFIRMED_EMAIL && !(u.email_confirmed_at || u.confirmed_at)) return null;
    const user = { id: u.id, email: email };
    _tokCache.set(token, { user, t: now }); if (_tokCache.size > 600) _tokCache.clear();
    return user;
  } catch (e) { return null; }
}
// Entitlement lookup: read the user's row from the subscriptions table (migration v5) with the SERVICE ROLE key,
// which bypasses RLS. Returns 'pro' only when the row says pro AND the paid period hasn't lapsed (a one-day grace
// guards against a missed webhook); otherwise 'free'. Cached ~60s per isolate. If the service key isn't configured
// yet, everyone is 'free' here (admins still get Claude via the separate admin flag). Never throws.
const _planCache = new Map();   // userId -> { plan, t }
const _PLAN_GRACE_MS = 24 * 60 * 60 * 1000;
async function planOf(env, userId) {
  if (!userId) return 'free';
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return 'free';
  const now = Date.now();
  const c = _planCache.get(userId);
  if (c && now - c.t < 60000) return c.plan;
  let plan = 'free';
  try {
    const url = SUPABASE_URL + '/rest/v1/subscriptions?user_id=eq.' + encodeURIComponent(userId) + '&select=plan,status,current_period_end&limit=1';
    const r = await fetch(url, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
    if (r.ok) {
      const rows = await r.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row && row.plan === 'pro') {
        const end = row.current_period_end ? Date.parse(row.current_period_end) : Infinity;
        if (!isFinite(end) || end > now - _PLAN_GRACE_MS) plan = 'pro';
      }
    }
  } catch (e) { /* fail closed to free */ }
  _planCache.set(userId, { plan, t: now });
  if (_planCache.size > 2000) _planCache.clear();
  return plan;
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
// ---- KV-backed daily caps (survive isolate cycling + span all isolates, unlike the in-memory maps above) ----
// Requires a KV binding named AILIMITS in wrangler.jsonc. If it's absent (e.g. local dev), these no-op and the
// in-memory caps still apply. Note: KV is eventually-consistent with a ~1 write/sec/key ceiling, so under a
// burst the counts can lag — good enough as a BACKSTOP; the billing spend-cap is the true hard stop.
async function _kvIncr(env, key, ttlSec) {
  if (!env || !env.AILIMITS) return null;
  try {
    const cur = parseInt((await env.AILIMITS.get(key)) || '0', 10) || 0;
    const next = cur + 1;
    await env.AILIMITS.put(key, String(next), { expirationTtl: ttlSec });
    return next;
  } catch (e) { return null; }
}
function _utcDay() { return new Date().toISOString().slice(0, 10); }   // YYYY-MM-DD
async function dailyOkKV(env, user, limit) {
  const n = await _kvIncr(env, 'u:' + user + ':' + _utcDay(), 90000);
  return n == null ? true : n <= limit;   // KV unavailable → don't block (in-memory cap still guards)
}
async function globalDailyOk(env) {
  const cap = parseInt((env && env.AI_GLOBAL_DAILY_CAP) || '0', 10) || 0;
  if (!cap) return true;   // not configured → rely on billing alerts
  const n = await _kvIncr(env, 'global:' + _utcDay(), 90000);
  return n == null ? true : n <= cap;
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

// Cerebras free tier: ~1M tokens/day, no credit card, OpenAI-compatible, very fast — but an ~8K-token
// CONTEXT cap on free, so the biggest calls (full-story wiki update, large imports) overflow and fall
// through to the next provider automatically (harmless). It's a high-capacity FALLBACK (Gemini/Mistral
// stay the quality leads). Cerebras's free PUBLIC endpoint currently hosts only ONE production model:
//   • gpt-oss-120b — 120B, ~3000 t/s, used for both writing and SVG/icons.
// (Qwen-235B moved to paid Dedicated Endpoints → 404 on a free key; the preview zai-glm-4.7 is
//  reasoning-only and returns empty content for our icon/brief calls.) Verify the live catalog at
//  https://inference-docs.cerebras.ai/models/overview ; a wrong slug just errors and falls through.
const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';
const CEREBRAS_MODEL = 'gpt-oss-120b';

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
  const isFlash = /flash|lite/i.test(model);
  const genCfg = {
    temperature: isFinite(temperature) ? temperature : 0.6,
    // Pro spends output tokens on internal "thinking", so give it plenty of headroom or it returns empty.
    maxOutputTokens: isFlash ? Math.max(maxTokens, 2048) : Math.max(maxTokens * 2, 8192),
  };
  if (isFlash) genCfg.thinkingConfig = { thinkingBudget: 0 };   // Flash/Lite can skip thinking so the full SVG fits
  else genCfg.thinkingConfig = { thinkingBudget: 1024 };        // Pro: cap thinking so it leaves room for the SVG output
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
    max_tokens: Math.min(Math.max(maxTokens, 1024), 8192),   // allow the larger import reply (element list); other paths pass ≤4096
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
  if (env.GEMINI_API_KEY)     c.push({ name: 'gemini-2.5-pro',   heavy: true, run: (s, p, mt, t, j) => runGemini(env, s, p, mt, t, 'gemini-2.5-pro', j) });   // heavy = reserved for the big, rare Import extraction; kept OUT of the frequent low-token paths
  if (env.GEMINI_API_KEY)     c.push({ name: 'gemini-2.5-flash', run: (s, p, mt, t, j) => runGemini(env, s, p, mt, t, 'gemini-2.5-flash', j) });
  // Cerebras (gpt-oss-120b) — high-capacity free fallback, ranked above Groq. ctxCap skips it on calls too
  // big for its ~8K free-tier window (they fall through to a large-context model). Used for text + icons.
  if (env.CEREBRAS_API_KEY)   c.push({ name: 'cerebras', ctxCap: 8000, run: (s, p, mt, t, j) => runOpenAICompat(env.CEREBRAS_API_KEY, CEREBRAS_URL, CEREBRAS_MODEL, s, p, mt, t, null, j) });
  if (env.GROQ_API_KEY)       c.push({ name: 'groq-llama-70b',   run: (s, p, mt, t, j) => runOpenAICompat(env.GROQ_API_KEY, 'https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile', s, p, mt, t, null, j) });
  if (env.MISTRAL_API_KEY)    c.push({ name: 'mistral-large',    run: (s, p, mt, t, j) => runOpenAICompat(env.MISTRAL_API_KEY, 'https://api.mistral.ai/v1/chat/completions', 'mistral-large-latest', s, p, mt, t, null, j) });
  if (env.OPENROUTER_API_KEY) c.push({ name: 'openrouter-free',  run: (s, p, mt, t, j) => runOpenAICompat(env.OPENROUTER_API_KEY, 'https://openrouter.ai/api/v1/chat/completions', 'openrouter/free', s, p, mt, t, { 'HTTP-Referer': 'https://dystoria.net', 'X-Title': 'Dystoria' }, j) });
  if (env.AI)                 c.push({ name: 'workers-ai', last: true, run: (s, p, mt, t, j) => runWorkersChat(env, s, p, mt, t, j) });
  return c;
}
const _cooldown = new Map();   // provider name → epoch ms until which to skip it (set when it hits a DAILY quota)
function isQuotaErr(e) { return /per ?day|daily|quota|exhaust|4006|neuron|insufficient|billing|credit/i.test(String(e || '')); }

// Try the chain in quality order; skip cooled-down providers; fall through on busy/empty/quota to the next.
// opts.allowPaid=false → free tier (skip Claude); opts.allowLast=false → skip the Workers-AI llama (used for icon SVG).
async function runFrontier(env, system, prompt, maxTokens, temperature, opts) {
  opts = opts || {};
  const admin = !!opts.admin;
  let chain = modelChain(env);
  const only = admin ? opts.only : null;            // the per-model testing toggles are admin-only
  const testing = Array.isArray(only) && only.length;
  if (testing){
    chain = chain.filter(p => only.includes(p.name));   // testing override: only the explicitly enabled models, in chain order
  } else if (opts.importOnly){
    // Import = a rare, very large-context extraction. Lead with Claude (when a key is set + the caller is entitled) for the
    // richest reading of a whole worldbuilding doc, then the large-context free fallbacks. Small-window models (Cerebras 8K,
    // OpenRouter, Workers-AI) are excluded so a whole document never truncates.
    const IMPORT_MODELS = ['claude', 'gemini-2.5-pro', 'gemini-2.5-flash', 'mistral-large', 'groq-llama-70b'];
    chain = chain.filter(p => IMPORT_MODELS.includes(p.name));
    if (!opts.allowPaid) chain = chain.filter(p => !p.paid);   // Claude (paid) only for admin/Pro; free users lead with Gemini 2.5 Pro
  } else {
    chain = chain.filter(p => !p.heavy);   // reserve the heavy import model — keep it out of the frequent, low-token paths (prompts, refine, wiki, icons)
    if (!opts.allowPaid) chain = chain.filter(p => !p.paid);   // the paid model (Claude) is included ONLY when the caller is entitled (admin or Pro); allowPaid is set server-side from the verified plan, never from the request body
    if (opts.allowLast === false) chain = chain.filter(p => !p.last);
  }
  // Per-user privacy opt-out: the writer can switch OFF any provider that may train on / human-review free-tier prose
  // (set in the app's AI-model consent screen + Settings). We honor it for EVERY caller here (unlike the admin-only
  // `only` testing whitelist above). Non-training providers always remain, so the AI features still work. Filtering
  // can only ever narrow a user's own results, so it needs no entitlement check.
  if (Array.isArray(opts.exclude) && opts.exclude.length){
    chain = chain.filter(p => !opts.exclude.includes(p.name));
  }
  const now = Date.now();
  const tried = [];
  let exhausted = false;
  // Rough token estimate (~4 chars/token) so small-context providers (Cerebras free ~8K) are skipped on big calls —
  // a whole-story wiki/import then lands on a large-context model instead of truncating mid-sentence.
  const estTokens = Math.ceil(((system || '').length + (prompt || '').length) / 4) + (maxTokens || 0);
  for (const p of chain) {
    if (p.ctxCap && estTokens > p.ctxCap * 0.9){ tried.push(p.name + ': prompt too large for its ' + p.ctxCap + '-token context'); continue; }   // too big for this model's window → next provider
    if (!testing && (_cooldown.get(p.name) || 0) > now){ tried.push(p.name + ': cooling down'); continue; }   // skip recently-exhausted (but always try in testing)
    let r;
    try { r = await p.run(system, prompt, maxTokens, temperature, opts.json); }
    catch (e){ r = { text: '', error: String(e) }; }
    if (r && r.text) return { text: r.text, via: p.name };
    const e = (r && r.error) || 'empty response';
    tried.push(p.name + ': ' + e);
    if (isQuotaErr(e)){ exhausted = true; if (!testing) _cooldown.set(p.name, now + 60 * 60 * 1000); }   // daily-ish quota → rest this provider an hour
  }
  return { text: '', error: tried.join('  |  ') || 'no models configured', exhausted };
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
  // Import is the one deliberately-large task (whole worldbuilding docs / manuscripts) → allow a much bigger prompt; everything else stays lean.
  const prompt = String(body.prompt || '').slice(0, body.kind === 'import' ? 300000 : 24000);
  const image = typeof body.image === 'string' ? body.image : '';   // data URL (e.g. data:image/png;base64,...)
  if (!prompt && !image) return new Response(JSON.stringify({ error: 'no prompt' }), { status: 400, headers });
  if (image && image.length > 8_000_000) return new Response(JSON.stringify({ error: 'Image too large' }), { status: 413, headers });   // ~6MB decoded — cap the vision payload

  // Require a signed-in Dystoria user (verified Supabase token), then throttle per user.
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const user = await verifyUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Sign in to use the AI features' }), { status: 401, headers });
  const admin = isAdminEmail(user.email);
  const plan = admin ? 'pro' : await planOf(env, user.id);   // entitlement from the subscriptions table; admin is treated as Pro
  const paid = admin || plan === 'pro';                       // may use the paid Claude model + gets the higher quotas
  if (!rateOk(user.id, image ? (paid ? 30 : 12) : (paid ? 120 : 45))) return new Response(JSON.stringify({ error: 'Too many AI requests — give it a moment' }), { status: 429, headers });
  const _dailyCap = image ? (paid ? 1500 : 400) : (paid ? 6000 : 1200);
  if (!dailyOk(user.id, _dailyCap)) return new Response(JSON.stringify({ error: 'You’ve hit today’s AI limit — it resets tomorrow. Reach out if you need more.', limit: 'day' }), { status: 429, headers });
  // Cross-isolate per-user cap (KV) — closes the "each Cloudflare isolate hands out a fresh in-memory quota" gap.
  if (!(await dailyOkKV(env, user.id, _dailyCap))) return new Response(JSON.stringify({ error: 'You’ve hit today’s AI limit — it resets tomorrow. Reach out if you need more.', limit: 'day' }), { status: 429, headers });
  // Global backstop across every account — a coarse ceiling so a mass-signup attack can't run up the bill.
  if (!(await globalDailyOk(env))) return new Response(JSON.stringify({ error: 'Dystoria’s AI is at today’s capacity — please try again later.', limit: 'global' }), { status: 503, headers });

  const maxTokens = Math.min(Math.max(parseInt(body.max_tokens, 10) || 600, 64), body.kind === 'import' ? 8192 : 4096);   // import returns a big element list → allow a larger JSON reply
  const model = body.model || (image ? VISION_MODEL : MODEL);
  // Providers the user opted out of (may-train-on-free-prose toggles). Sanitized; only ever narrows the chain.
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter(x => typeof x === 'string').slice(0, 12) : [];

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
  // briefs may use it as a final resort. allowPaid (= admin || Pro) decides whether Claude leads; free users get the free chain.
  if (body.kind === 'icon' || body.kind === 'brief') {
    const fr = await runFrontier(env, system, prompt, maxTokens, temperature, { admin, allowPaid: paid, allowLast: body.kind !== 'icon', only: body.models, exclude, kind: body.kind });
    if (fr.text) return new Response(JSON.stringify({ text: fr.text, via: fr.via }), { headers });
    const err = fr.error || '';
    if (fr.exhausted) return new Response(JSON.stringify({ error: 'Free AI models at today’s limit — ' + err, limit: 'day' }), { status: 429, headers });
    return new Response(JSON.stringify({ error: 'Image model error — ' + (err || 'try again') }), { status: 502, headers });
  }

  // ---- Import extraction: dedicated large-context model (Gemini 2.5 Pro), reserved so its free quota isn't spent on frequent small calls ----
  if (body.kind === 'import'){
    const fr = await runFrontier(env, system, prompt, maxTokens, temperature, { admin, allowPaid: paid, importOnly: true, json: !!body.json, only: body.models, exclude });
    if (fr.text) return new Response(JSON.stringify({ text: fr.text, via: fr.via }), { headers });
    const err = fr.error || '';
    if (fr.exhausted) return new Response(JSON.stringify({ error: 'The import model is at today’s limit — it resets tomorrow.', limit: 'day' }), { status: 429, headers });
    return new Response(JSON.stringify({ error: 'Import model error — ' + (err || 'try again') }), { status: 502, headers });
  }

  // ---- general text tasks (writing prompts, Wiki rollups, Refine, etc.) — the frequent, low-token path; the heavy import model is excluded here ----
  // Route through the FREE model chain (Gemini → Groq → Mistral → … → Workers AI) for quality + resilience — for
  // EVERYONE, including Pro. Gemini 2.5 Pro leads and is already frontier-grade, and text is high-volume, so Claude
  // stays reserved for the premium ICON path to bound cost. (Only admins get Claude here, for testing.) To also give
  // Pro subscribers Claude for text, change `allowPaid: admin` → `allowPaid: paid`. Pass json mode through.
  const tr = await runFrontier(env, system, prompt, maxTokens, temperature, { admin, allowPaid: admin, json: !!body.json, only: body.models, exclude });
  if (tr.text) return new Response(JSON.stringify({ text: tr.text, via: tr.via }), { headers });
  const terr = tr.error || '';
  if (tr.exhausted) return new Response(JSON.stringify({ error: 'Dystoria’s free AI models are all at today’s limit — they reset tomorrow.', limit: 'day' }), { status: 429, headers });
  return new Response(JSON.stringify({ error: 'AI error: ' + terr }), { status: 502, headers });
}

// ============================================================
//  BILLING (Stripe) — Checkout to subscribe, Customer Portal to manage/cancel.
//  We never build card forms or touch card data; Stripe hosts both pages. The Worker only
//  creates the sessions and hands back a URL the client redirects to. Entitlement itself is
//  written by the webhook (next step), never here. Requires these env vars (Jeremy adds them):
//    STRIPE_SECRET_KEY     (secret)  sk_live_… / sk_test_…
//    STRIPE_PRICE_MONTHLY  (var)     price_…  — the monthly Pro price
//    STRIPE_PRICE_ANNUAL   (var)     price_…  — the annual Pro price
// ============================================================

// Minimal Stripe REST call (form-encoded, Bearer secret). Keys may use Stripe's bracket notation,
// e.g. 'line_items[0][price]'. Throws with Stripe's own message on a non-2xx.
async function stripe(env, path, params, key) {
  key = key || env.STRIPE_SECRET_KEY;   // default = subscription key (test); callers may pass the live key (tips)
  if (!key) throw new Error('billing not configured');
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) { if (v !== undefined && v !== null) form.append(k, String(v)); }
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error((data && data.error && data.error.message) || ('Stripe HTTP ' + r.status));
  return data;
}

// Read one subscriptions row (service role → bypasses RLS). Returns the row object or null.
async function subGet(env, userId, select) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const url = SUPABASE_URL + '/rest/v1/subscriptions?user_id=eq.' + encodeURIComponent(userId) + '&select=' + encodeURIComponent(select || '*') + '&limit=1';
  const r = await fetch(url, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

// Upsert subscription fields for a user (service role). Works whether or not the row exists.
async function subUpsert(env, userId, fields) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  const url = SUPABASE_URL + '/rest/v1/subscriptions?on_conflict=user_id';
  const r = await fetch(url, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(Object.assign({ user_id: userId }, fields)),
  });
  if (r.ok) _planCache.delete(userId);   // entitlement may have changed → drop the cached plan
  return r.ok;
}

// action: 'checkout' (start a subscription) | 'portal' (manage existing subscription)
async function handleBilling(request, env, action) {
  const headers = cors(request.headers.get('origin') || '');
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers });
  if (!env.STRIPE_SECRET_KEY) return new Response(JSON.stringify({ error: 'Billing isn’t set up yet.' }), { status: 503, headers });

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const user = await verifyUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Sign in to manage your subscription' }), { status: 401, headers });

  let body = {}; try { body = await request.json(); } catch (e) { /* portal needs no body */ }
  const origin = request.headers.get('origin');
  const site = (origin && (ALLOWED.includes(origin) || /\.(pages|workers)\.dev$/.test(origin))) ? origin : 'https://dystoria.net';

  try {
    // Ensure a Stripe customer exists for this user (reused across checkout + portal; avoids dupes).
    const row = await subGet(env, user.id, 'stripe_customer_id');
    let customer = row && row.stripe_customer_id;
    if (!customer) {
      const c = await stripe(env, 'customers', { email: user.email || undefined, 'metadata[user_id]': user.id });
      customer = c.id;
      await subUpsert(env, user.id, { stripe_customer_id: customer });
    }

    if (action === 'portal') {
      const ps = await stripe(env, 'billing_portal/sessions', { customer, return_url: site + '/?billing=done' });
      return new Response(JSON.stringify({ url: ps.url }), { headers });
    }

    // checkout
    const interval = (body && body.interval === 'year') ? 'year' : 'month';
    const price = interval === 'year' ? env.STRIPE_PRICE_ANNUAL : env.STRIPE_PRICE_MONTHLY;
    if (!price) return new Response(JSON.stringify({ error: 'The ' + interval + 'ly plan isn’t configured yet.' }), { status: 503, headers });
    const cs = await stripe(env, 'checkout/sessions', {
      mode: 'subscription',
      customer,
      'line_items[0][price]': price,
      'line_items[0][quantity]': 1,
      client_reference_id: user.id,
      'subscription_data[metadata][user_id]': user.id,   // so the webhook can map the subscription back to the user
      allow_promotion_codes: 'true',
      success_url: site + '/?upgraded=1',
      cancel_url: site + '/?upgrade_cancelled=1',
    });
    return new Response(JSON.stringify({ url: cs.url }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Billing error: ' + String((e && e.message) || e) }), { status: 502, headers });
  }
}

// One-time TIP via Stripe Payment Element (embedded — the card form lives inside Dystoria's popup,
// no redirect even on success). A tip grants no entitlement, so we DON'T require sign-in (max conversions).
// Amount is set+validated server-side (the client only proposes it); light per-IP throttle guards the endpoint.
async function handleTip(request, env) {
  const headers = cors(request.headers.get('origin') || '');
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers });
  // Tips run on the LIVE key (real money) if set; otherwise fall back to the default key (test). The client's
  // STRIPE_PK must be the matching mode (pk_live with STRIPE_LIVE_SECRET_KEY, pk_test otherwise).
  const tipKey = env.STRIPE_LIVE_SECRET_KEY || env.STRIPE_SECRET_KEY;
  if (!tipKey) return new Response(JSON.stringify({ error: 'Tips aren’t set up yet.' }), { status: 503, headers });

  let body = {}; try { body = await request.json(); } catch (e) { /* fall through to validation */ }
  const cents = Math.round(Number(body && body.amount_cents));
  if (!isFinite(cents) || cents < 100 || cents > 50000) {
    return new Response(JSON.stringify({ error: 'Pick a tip between $1 and $500.' }), { status: 400, headers });
  }
  const ip = request.headers.get('cf-connecting-ip') || 'anon';
  if (!rateOk('tip:' + ip, 10)) return new Response(JSON.stringify({ error: 'Too many attempts — give it a moment.' }), { status: 429, headers });

  try {
    const pi = await stripe(env, 'payment_intents', {
      amount: cents,
      currency: 'usd',
      'automatic_payment_methods[enabled]': 'true',
      description: 'Dystoria tip',
      'metadata[kind]': 'tip',
    }, tipKey);
    return new Response(JSON.stringify({ client_secret: pi.client_secret }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Tip error: ' + String((e && e.message) || e) }), { status: 502, headers });
  }
}

// ============================================================
//  STRIPE WEBHOOK — the ONLY writer of entitlement. Stripe calls this when a subscription
//  is created/updated/cancelled or a payment fails; we verify the signature, then sync the
//  current state into the subscriptions table (service role). Needs env STRIPE_WEBHOOK_SECRET
//  (whsec_…) — the signing secret shown when you register the endpoint in the Stripe dashboard.
// ============================================================

// Verify Stripe's 'Stripe-Signature' header (HMAC-SHA256 over `${t}.${rawBody}`) using Web Crypto.
// Rejects on a missing/old timestamp (>5 min) to block replay. Returns true/false; never throws.
async function verifyStripeSig(payload, sigHeader, secret) {
  try {
    if (!sigHeader || !secret) return false;
    let t = null; const sigs = [];
    for (const part of sigHeader.split(',')) { const i = part.indexOf('='); const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim(); if (k === 't') t = v; else if (k === 'v1') sigs.push(v); }
    if (!t || !sigs.length) return false;
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const buf = await crypto.subtle.sign('HMAC', key, enc.encode(t + '.' + payload));
    const expected = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    return sigs.some(s => s.length === expected.length && timingSafeEqualHex(expected, s));
  } catch (e) { return false; }
}
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// Read a Stripe object (GET). Used to pull full subscription details on checkout completion.
async function stripeGet(env, path) {
  const key = env.STRIPE_SECRET_KEY; if (!key) return null;
  const r = await fetch('https://api.stripe.com/v1/' + path, { headers: { Authorization: 'Bearer ' + key } });
  const d = await r.json().catch(() => null);
  return r.ok ? d : null;
}

// Find which user a Stripe customer belongs to (when the subscription has no user_id metadata).
async function subUserByCustomer(env, custId) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY; if (!key || !custId) return null;
  const url = SUPABASE_URL + '/rest/v1/subscriptions?stripe_customer_id=eq.' + encodeURIComponent(custId) + '&select=user_id&limit=1';
  const r = await fetch(url, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  return (Array.isArray(rows) && rows[0]) ? rows[0].user_id : null;
}

function subInterval(sub) { try { return sub.items.data[0].price.recurring.interval; } catch (e) { return null; } }
// period end moved per-item in newer Stripe API versions — read either spot.
function subPeriodEnd(sub) { if (sub && sub.current_period_end) return sub.current_period_end; try { return sub.items.data[0].current_period_end; } catch (e) { return null; } }
// active/trialing/past_due keep Pro (past_due = in grace); anything else → free.
function planFromStatus(s) { return (s === 'active' || s === 'trialing' || s === 'past_due') ? 'pro' : 'free'; }

// Write one Stripe subscription's current state into our table. forceFree=true for deletions.
async function applySubscription(env, sub, forceFree) {
  if (!sub) return false;
  let userId = sub.metadata && sub.metadata.user_id;
  if (!userId) userId = await subUserByCustomer(env, sub.customer);
  if (!userId) return false;   // can't map this subscription to a user → skip
  const status = forceFree ? 'canceled' : (sub.status || 'inactive');
  const end = subPeriodEnd(sub);
  return subUpsert(env, userId, {
    plan: forceFree ? 'free' : planFromStatus(status),
    status,
    billing_interval: subInterval(sub),
    stripe_customer_id: sub.customer || undefined,
    stripe_subscription_id: sub.id || undefined,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
  });
}

async function handleStripeWebhook(request, env) {
  if (request.method !== 'POST') return new Response('POST only', { status: 405 });
  const payload = await request.text();   // RAW body — required for signature verification
  const sig = request.headers.get('stripe-signature') || '';
  if (!(await verifyStripeSig(payload, sig, env.STRIPE_WEBHOOK_SECRET))) {
    return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  let event; try { event = JSON.parse(payload); } catch (e) { return new Response('bad json', { status: 400 }); }
  try {
    const obj = event.data && event.data.object;
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await applySubscription(env, obj, false); break;
      case 'customer.subscription.deleted':
        await applySubscription(env, obj, true); break;
      case 'checkout.session.completed':
        // flip to Pro promptly (don't wait on the subscription.* event); fetch full sub for period/interval
        if (obj && obj.subscription) { const sub = await stripeGet(env, 'subscriptions/' + obj.subscription); if (sub && sub.id) { if (!(sub.metadata && sub.metadata.user_id) && obj.client_reference_id) sub.metadata = Object.assign({}, sub.metadata, { user_id: obj.client_reference_id }); await applySubscription(env, sub, false); } }
        break;
      default: break;   // other events acknowledged but not acted on
    }
  } catch (e) {
    // transient failure → 500 so Stripe retries the delivery
    return new Response(JSON.stringify({ error: 'handler error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/version'){
      // Report the deployed app version (read once per isolate from index.html) so the client can
      // detect a new release and offer to back up + update. Never cached.
      try {
        if (!globalThis.__dystVer){
          const r = await env.ASSETS.fetch(new URL('/', request.url));
          const t = await r.text();
          const m = t.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
          globalThis.__dystVer = (m && m[1]) || 'unknown';
        }
      } catch (e){ globalThis.__dystVer = globalThis.__dystVer || 'unknown'; }
      return new Response(globalThis.__dystVer, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname === '/ai'){
      // Never let an unhandled exception become an opaque 500 — return the real reason so the client can show it.
      try { return await handleAI(request, env); }
      catch (e){
        const h = Object.assign({ 'Content-Type': 'application/json' }, cors(request.headers.get('Origin')));
        return new Response(JSON.stringify({ error: 'AI worker error: ' + String((e && e.message) || e) }), { status: 502, headers: h });
      }
    }
    if (url.pathname === '/billing/checkout') return handleBilling(request, env, 'checkout');
    if (url.pathname === '/billing/portal') return handleBilling(request, env, 'portal');
    if (url.pathname === '/billing/tip') return handleTip(request, env);
    if (url.pathname === '/stripe-webhook') return handleStripeWebhook(request, env);
    // everything else → the static site
    const res = await env.ASSETS.fetch(request);
    // Never cache the HTML documents (index.html, landing pages) at the edge or in the browser, so a
    // deploy shows up immediately. Assets (fonts, images, mp3s) keep their normal caching.
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html') || url.pathname === '/' || url.pathname.endsWith('.html')){
      const h = new Headers(res.headers);
      h.set('Cache-Control', 'no-cache, must-revalidate');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }
    return res;
  },
};
