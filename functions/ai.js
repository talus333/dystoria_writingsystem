// Cloudflare Pages Function — POST /ai
// Holds the Gemini key server-side (never in the browser) and proxies one request.
// Set GEMINI_KEY in: Cloudflare dashboard → your Pages project → Settings →
// Environment variables (Production + Preview), then redeploy.

const ALLOWED = ['https://dystoria.net', 'https://www.dystoria.net'];

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

  if (!env.GEMINI_KEY) {
    return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 500, headers: cors });
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: cors }); }

  const system = String(body.system || '').slice(0, 4000);
  const prompt = String(body.prompt || '').slice(0, 24000);
  if (!prompt) return new Response(JSON.stringify({ error: 'no prompt' }), { status: 400, headers: cors });

  const model = body.model || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + env.GEMINI_KEY;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };

  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: (data.error && data.error.message) || ('Gemini HTTP ' + r.status) }), { status: 502, headers: cors });
    }
    const cand = (data.candidates || [])[0] || {};
    const parts = (cand.content && cand.content.parts) || [];
    const text = parts.map(p => p.text || '').join('').trim();
    return new Response(JSON.stringify({ text }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: cors });
  }
}
