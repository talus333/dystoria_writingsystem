// ============================================================
//  DYSTORIA — email notices  (Supabase Edge Function, Deno)            v.823
//  Runs every 15 minutes. Today it sends one kind of email:
//    · "Mara sent you 3 messages" — messages from a writing partner that have waited
//      15+ minutes unread while you weren't in the app. At most one such email per
//      person every 6 hours; each message is emailed about once. People can turn these
//      off in Dystoria → Writing partners → ⚙.
//  The selection lives in the database (notice_batch_messages / notice_mark_messages,
//  migration 14), so this file only formats and sends.
//
//  Deploy:   Dashboard → Edge Functions → Create "notices" → paste this file → Deploy
//            (or: supabase functions deploy notices --no-verify-jwt)
//  Secrets:  RESEND_API_KEY, NOTICE_FROM (e.g. "Dystoria <hello@dystoria.net>"),
//            APP_URL (default https://dystoria.net)
//            SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//  Without RESEND_API_KEY it runs dry: it logs who WOULD be emailed and marks nothing.
//  Setup:    NOTICES_EMAIL_SETUP.md
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("NOTICE_FROM") ?? Deno.env.get("DIGEST_FROM") ?? "Dystoria <onboarding@resend.dev>";
const APP_URL = (Deno.env.get("APP_URL") ?? "https://dystoria.net").replace(/\/+$/, "");

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.log(`[dry-run] would email ${to}: ${subject}`); return false; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) { console.error("resend error", to, await res.text()); return false; }
  return true;
}

function shell(inner: string, footer: string): string {
  return `<div style="background:#f4efe6;padding:28px 12px">
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:540px;margin:auto;background:#fffdf8;border:1px solid #e6dcc8;border-radius:14px;padding:26px 28px;color:#2a2620">
    <div style="font:600 11px/1.4 -apple-system,Segoe UI,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#a0916f">Dystoria</div>
    ${inner}
    <p style="font:12px/1.5 -apple-system,Segoe UI,sans-serif;color:#9a9082;margin:22px 0 0">${footer}</p>
  </div></div>`;
}

type MsgRow = { recipient: string; email: string; username: string; n: number; senders: string; snippets: { from: string; body: string }[]; ids: string[] };

async function messageNotices(): Promise<string> {
  const { data, error } = await admin.rpc("notice_batch_messages");
  if (error) return "messages: " + error.message;
  const rows = (data ?? []) as MsgRow[];
  let sent = 0;
  for (const r of rows) {
    const who = r.senders || "A writing partner";
    const subject = r.n === 1 ? `${who} sent you a message on Dystoria` : `${r.n} messages waiting from ${who}`;
    const items = (r.snippets || []).map((s) =>
      `<div style="margin:0 0 10px;padding:9px 13px;border-left:3px solid #c8a24a;background:#faf6ec;border-radius:0 8px 8px 0">
         <div style="font:12px/1.4 -apple-system,Segoe UI,sans-serif;color:#8a8276">${esc(s.from)}</div>
         <div style="font-size:16px;line-height:1.45">${esc(s.body)}</div></div>`).join("");
    const more = r.n > (r.snippets || []).length ? `<p style="font-style:italic;color:#8a8276">…and ${r.n - r.snippets.length} more.</p>` : "";
    const html = shell(
      `<h2 style="font-weight:500;font-size:24px;margin:10px 0 16px">${esc(who)} wrote to you</h2>${items}${more}
       <p style="margin:20px 0 0"><a href="${APP_URL}/#/partners" style="display:inline-block;background:#f08c1f;color:#2b2926;text-decoration:none;font:700 12px/1 -apple-system,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:12px 20px;border-radius:999px">Reply in Dystoria</a></p>`,
      `You get this because a writing partner messaged you while you were away. Turn these emails off in Dystoria → Writing partners → ⚙.`);
    if (await sendEmail(r.email, subject, html)) {
      await admin.rpc("notice_mark_messages", { ids: r.ids, recips: [r.recipient] });
      sent++;
    }
  }
  return `messages: ${sent}/${rows.length} emailed${RESEND_API_KEY ? "" : " (dry run)"}`;
}

Deno.serve(async () => {
  const out = [await messageNotices()];
  return new Response(out.join("\n"));
});
