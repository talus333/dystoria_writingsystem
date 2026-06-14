// Cloudflare Pages Function — POST /ai
// Uses Cloudflare Workers AI (no API key). Requires an AI binding on the Pages project:
//   dashboard → your Pages project → Settings → Functions → Bindings → add
//   "Workers AI", variable name exactly AI. Then redeploy.

const ALLOWED = ['https://dystoria.net', 'https://www.dystoria.net'];
const MODEL = '@cf/meta/llama-3.1-8b-instruct';

function corsHeaders(origin) {
  const ok = !origin || ALLOWED.includes(origin) || origin.endsWith('.pages.dev');
  return {
    'Access-Control-Allow-Origin': ok ? (origin || 'https://dystoria.net') : 'https://dystoria.net',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { headers: corsHeaders(context.request.headers.get('origin') || '') });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = corsHeaders(request.headers.get('origin') || '');

  if (!env.AI) {
    return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 500, headers: cors });
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: cors }); }

  const system = String(body.system || '').slice(0, 4000);
  const prompt = String(body.prompt || '').slice(0, 24000);
  if (!prompt) return new Response(JSON.stringify({ error: 'no prompt' }), { status: 400, headers: cors });

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  try {
    const resp = await env.AI.run(body.model || MODEL, { messages, max_tokens: 600, temperature: 0.4 });
    const text = ((resp && (resp.response || resp.result || '')) || '').toString().trim();
    return new Response(JSON.stringify({ text }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'AI error: ' + String(e) }), { status: 502, headers: cors });
  }
}
