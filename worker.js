// Cloudflare Worker for dystoria.net
// Serves the static site via the ASSETS binding, and handles POST /ai with
// Workers AI (binding: AI). Bindings + config live in wrangler.jsonc — no
// dashboard setup needed. Deploys on git push like the rest of the site.

const ALLOWED = ['https://dystoria.net', 'https://www.dystoria.net'];
// Current Workers AI model. Lighter/cheaper alternative: '@cf/meta/llama-3.1-8b-instruct-fast'
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// Vision model — OCR + handwriting recognition. Used when the request carries an image.
const VISION_MODEL = '@cf/google/gemma-4-26b-a4b-it';

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

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  if (image) {
    const content = [];
    if (prompt) content.push({ type: 'text', text: prompt });
    content.push({ type: 'image_url', image_url: { url: image } });
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const maxTokens = Math.min(Math.max(parseInt(body.max_tokens, 10) || 600, 64), 4096);
  const base = { messages, max_tokens: maxTokens, temperature: image ? 0.1 : 0.4 };
  const model = body.model || (image ? VISION_MODEL : MODEL);

  try {
    let resp;
    if (body.json) {
      // JSON mode where the model supports it; fall back gracefully otherwise
      try { resp = await env.AI.run(model, { ...base, response_format: { type: 'json_object' } }); }
      catch (e) { resp = await env.AI.run(model, base); }
    } else {
      resp = await env.AI.run(model, base);
    }
    let text = (resp && (resp.response || resp.result)) || '';
    if (text && typeof text === 'object') text = JSON.stringify(text); // json mode can return an object
    text = (text || '').toString().trim();
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
