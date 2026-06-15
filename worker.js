// Cloudflare Worker for dystoria.net
// Serves the static site via the ASSETS binding, and handles POST /ai with
// Workers AI (binding: AI). Bindings + config live in wrangler.jsonc — no
// dashboard setup needed. Deploys on git push like the rest of the site.

const ALLOWED = ['https://dystoria.net', 'https://www.dystoria.net'];
// Current Workers AI model. Lighter/cheaper alternative: '@cf/meta/llama-3.1-8b-instruct-fast'
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// Vision model — OCR + handwriting recognition. Used when the request carries an image.
const VISION_MODEL = '@cf/google/gemma-4-26b-a4b-it';

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
// Vision input. Use the chat-template (messages) form first so the instruction is followed,
// not echoed, with the image attached as a byte array; then try OpenAI image_url; raw last.
async function runVision(env, model, system, prompt, dataUrl, maxTokens) {
  const instr = prompt || 'Transcribe the text in this image.';
  let bytes = null;
  try { bytes = dataUrlToBytes(dataUrl); } catch (e) {}
  const img = bytes ? Array.from(bytes) : null;
  const sysMsg = system ? [{ role: 'system', content: system }] : [];
  const attempts = [];
  if (img) attempts.push(() => env.AI.run(model, { messages: [...sysMsg, { role: 'user', content: instr }], image: img, max_tokens: maxTokens }));
  attempts.push(() => env.AI.run(model, {
    messages: [...sysMsg, { role: 'user', content: [
      { type: 'text', text: instr },
      { type: 'image_url', image_url: { url: dataUrl } },
    ] }],
    max_tokens: maxTokens,
  }));
  if (img) attempts.push(() => env.AI.run(model, { prompt: (system ? system + '\n\n' : '') + instr, image: img, max_tokens: maxTokens }));
  let raw = null;
  for (const run of attempts) {
    try {
      const resp = await run();
      const text = extractText(resp);
      if (text && !looksEchoed(text, instr)) return { text, raw: resp };
      raw = text ? { echoed: text.slice(0, 160) } : resp;
    } catch (e) { raw = { error: String(e) }; }
  }
  return { text: '', raw };
}

function cors(origin) {
  const ok = !origin || ALLOWED.includes(origin) || origin.endsWith('.pages.dev') || origin.endsWith('.workers.dev');
  return {
    'Access-Control-Allow-Origin': ok ? (origin || 'https://dystoria.net') : 'https://dystoria.net',
    'Access-Control-Allow-Headers': 'content-type',
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
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const base = { messages, max_tokens: maxTokens, temperature: 0.4 };

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
    return new Response(JSON.stringify({ error: 'AI error: ' + String(e) }), { status: 502, headers });
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
