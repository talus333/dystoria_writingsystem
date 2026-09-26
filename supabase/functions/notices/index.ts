// ============================================================
//  DYSTORIA — email notices  (Supabase Edge Function, Deno)            v.835
//  Runs every 15 minutes (and at once when the app asks — see below). These kinds of email:
//    · "Jeremy sent you “Servant” to beta read" and "Jeremy asked to swap beta reads" (v.835) — the beta-reader
//      exchange; the first opens the reader's private #/beta/<token> link, the second opens Dystoria's Beta readers.
//      v.836: asks to read (one way) and offers to read; and "Jeremy would like you to be a beta reader" — an
//      invitation for anyone, writer or not, that opens #/beta-join/<token>.
//    · "Jeremy invited you to write on Dystoria" (v.825) — a friend invitation, with their note;
//      the button opens #/join/<token>, and joining makes the two of them writing partners.
//    · "Jeremy invited you to co-write “Servant”" (v.824) — a co-author invitation the
//      owner asked to have emailed; the button opens the invitation link. Replies go to
//      the person who invited them.
//    · "Mara sent you 3 messages" — messages from a writing partner that have waited
//      15+ minutes unread while you weren't in the app. At most one such email per
//      person every 6 hours; each message is emailed about once. People can turn these
//      off in Dystoria → Writing partners → ⚙.
//  The selection lives in the database (notice_batch_messages / notice_mark_messages,
//  migration 14; notice_batch_invites / notice_mark_invites, migration 15; notice_batch_friends /
//  notice_mark_friends, migration 16; notice_batch_beta / notice_mark_beta, migration 17), so this file
//  only formats and sends. Running it twice sends nothing twice.
//  The app calls it with {"kind":"invites"}, {"kind":"friends"} or {"kind":"beta"} right after an invitation is asked for, so the
//  email leaves in seconds; the 15-minute schedule is the safety net.
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

async function sendEmail(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.log(`[dry-run] would email ${to}: ${subject}`); return false; }
  const payload: Record<string, unknown> = { from: FROM, to, subject, html };
  if (replyTo) payload.reply_to = replyTo;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

type InviteRow = { id: string; email: string; token: string; role: string; title: string; inviter_name: string; inviter_email: string | null; resend: boolean };

async function inviteNotices(): Promise<string> {
  const { data, error } = await admin.rpc("notice_batch_invites");
  if (error) return "invites: " + error.message;
  const rows = (data ?? []) as InviteRow[];
  const done: string[] = [];
  for (const r of rows) {
    const link = `${APP_URL}/#/invite/${r.token}`;
    const role = r.role === "suggester"
      ? `as a <b>Suggester</b> — you'll propose changes for ${esc(r.inviter_name)} to accept`
      : `as an <b>Editor</b> — you'll write and revise directly`;
    const subject = (r.resend ? "Reminder: " : "") + `${r.inviter_name} invited you to co-write “${r.title}” on Dystoria`;
    const html = shell(
      `<p style="font-size:17px;color:#6f6656;margin:14px 0 4px">${esc(r.inviter_name)} invited you to co-write</p>
       <h2 style="font-weight:500;font-style:italic;font-size:28px;line-height:1.15;margin:0 0 10px">${esc(r.title)}</h2>
       <p style="font-size:16px;line-height:1.5;color:#4a4236;margin:0 0 20px">${role}.</p>
       <p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#f08c1f;color:#2b2926;text-decoration:none;font:700 12px/1 -apple-system,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:13px 22px;border-radius:999px">Open the invitation</a></p>
       <p style="font-size:14px;line-height:1.5;color:#6f6656;margin:0">Dystoria is a writing app for building a story's world and writing it, alone or together. Sign in — or create a free account — with <b>${esc(r.email)}</b> to accept; the invitation will be waiting.</p>`,
      `Sent by Dystoria on behalf of ${esc(r.inviter_name)}. Replying reaches them. If you weren't expecting this, you can ignore it — the invitation lapses in 30 days.`);
    if (await sendEmail(r.email, subject, html, r.inviter_email || undefined)) done.push(r.id);
  }
  if (done.length) await admin.rpc("notice_mark_invites", { ids: done });
  return `invites: ${done.length}/${rows.length} emailed${RESEND_API_KEY ? "" : " (dry run)"}`;
}

type FriendRow = { id: string; email: string; token: string; note: string | null; inviter_name: string; inviter_email: string | null };

async function friendNotices(): Promise<string> {
  const { data, error } = await admin.rpc("notice_batch_friends");
  if (error) return "friends: " + error.message;
  const rows = (data ?? []) as FriendRow[];
  const done: string[] = [];
  for (const r of rows) {
    const link = `${APP_URL}/#/join/${r.token}`;
    const note = r.note ? `<div style="margin:16px 0;padding:12px 16px;border-left:3px solid #c8a24a;background:#faf6ec;border-radius:0 8px 8px 0;font-size:17px;line-height:1.5;font-style:italic">“${esc(r.note)}”<div style="margin-top:6px;font:12px/1.4 -apple-system,Segoe UI,sans-serif;font-style:normal;color:#8a8276">— ${esc(r.inviter_name)}</div></div>` : "";
    const subject = `${r.inviter_name} invited you to write on Dystoria`;
    const html = shell(
      `<h2 style="font-weight:500;font-size:26px;line-height:1.2;margin:12px 0 8px">${esc(r.inviter_name)} invited you to write on Dystoria</h2>
       ${note}
       <p style="font-size:16px;line-height:1.55;color:#4a4236;margin:0 0 18px">Dystoria is a writing app for building a story's world — its places, characters and plot — and writing it, alone or together. Join, and you and ${esc(r.inviter_name)} will be writing partners: you'll see when each other is writing, can message, and can co-write a story.</p>
       <p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#f08c1f;color:#2b2926;text-decoration:none;font:700 12px/1 -apple-system,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:13px 22px;border-radius:999px">Join Dystoria</a></p>
       <p style="font-size:14px;line-height:1.5;color:#6f6656;margin:0">It's free while Dystoria is in beta.</p>`,
      `Sent by Dystoria because ${esc(r.inviter_name)} asked us to. Replying reaches them. We won't email you again unless someone invites you.`);
    if (await sendEmail(r.email, subject, html, r.inviter_email || undefined)) done.push(r.id);
  }
  if (done.length) await admin.rpc("notice_mark_friends", { ids: done });
  return `friends: ${done.length}/${rows.length} emailed${RESEND_API_KEY ? "" : " (dry run)"}`;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BetaRow = { kind: "read" | "ask" | "invite"; id: string; email: string; from_name: string; title: string | null; token: string | null; note: string | null; due: string | null };
async function betaNotices(): Promise<string> {
  const { data, error } = await admin.rpc("notice_batch_beta");
  if (error) return "beta: " + (/does not exist|could not find/i.test(error.message) ? "migration 17 not run yet" : error.message);
  const rows = (data ?? []) as BetaRow[];
  const done: string[] = [];
  const btn = (href: string, label: string) => `<p style="margin:0 0 18px"><a href="${href}" style="display:inline-block;background:#f08c1f;color:#2b2926;text-decoration:none;font:700 12px/1 -apple-system,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:13px 22px;border-radius:999px">${label}</a></p>`;
  const quote = (t: string, who: string) => `<div style="margin:16px 0;padding:12px 16px;border-left:3px solid #c8a24a;background:#faf6ec;border-radius:0 8px 8px 0;font-size:17px;line-height:1.5;font-style:italic">“${esc(t)}”<div style="margin-top:6px;font:12px/1.4 -apple-system,Segoe UI,sans-serif;font-style:normal;color:#8a8276">— ${esc(who)}</div></div>`;
  for (const r of rows) {
    let subject = "", html = "";
    if (r.kind === "read") {
      const title = r.title || "a manuscript";
      let due = "";
      try { if (r.due) due = new Date(r.due + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric" }); } catch (_) { /* no date */ }
      subject = `${r.from_name} sent you “${title}” to beta read`;
      html = shell(
        `<h2 style="font-weight:500;font-size:26px;line-height:1.2;margin:12px 0 8px">${esc(r.from_name)} sent you “${esc(title)}”</h2>
         <p style="font-size:16px;line-height:1.55;color:#4a4236;margin:0 0 14px">You're one of ${esc(r.from_name)}'s beta readers on Dystoria. Highlight any passage to leave a comment — only ${esc(r.from_name)} sees it — and when you finish, a short report tells them how it read.${due ? ` They'd love to hear back by <b>${esc(due)}</b>.` : ""}</p>
         ${r.note ? `<p style="font-size:14px;line-height:1.5;color:#6f6656;margin:0 0 16px"><b>Content notes:</b> ${esc(r.note)}</p>` : ""}
         ${btn(`${APP_URL}/#/beta/${r.token}`, "Start reading")}
         <p style="font-size:14px;line-height:1.5;color:#6f6656;margin:0">The link is yours alone: sign in to Dystoria to open it. If it isn't for you right now, you can stop reading at any time — no mark against you.</p>`,
        `Sent by Dystoria because ${esc(r.from_name)} sent you a manuscript through the beta-reader exchange. You can leave the exchange in Dystoria → Writing partners → Beta readers.`);
    } else if (r.kind === "invite") {
      subject = `${r.from_name} would like you to be a beta reader`;
      html = shell(
        `<h2 style="font-weight:500;font-size:26px;line-height:1.2;margin:12px 0 8px">${esc(r.from_name)} would like you to be a beta reader</h2>
         ${r.note ? quote(r.note, r.from_name) : ""}
         <p style="font-size:16px;line-height:1.55;color:#4a4236;margin:0 0 18px">A beta reader reads a piece of writing before anyone else and says honestly how it lands. You don't need to be a writer. Say yes on Dystoria (a free account), and you'll get an email whenever ${esc(r.from_name)} sends you something to read.</p>
         ${btn(`${APP_URL}/#/beta-join/${r.token}`, "Become a reader")}`,
        `Sent by Dystoria because ${esc(r.from_name)} asked us to. We won't email you again unless someone invites you.`);
    } else {
      const k = r.title || "swap";
      subject = k === "read" ? `${r.from_name} asked if you'd beta read for them` : k === "offer" ? `${r.from_name} offered to beta read for you` : `${r.from_name} asked to swap beta reads with you`;
      const head = k === "read" ? `${esc(r.from_name)} would like you to read for them` : k === "offer" ? `${esc(r.from_name)} would like to read your work` : `${esc(r.from_name)} would like to swap beta reads`;
      const body = k === "read" ? "You said you're happy to read for other writers. Accept, and they can send you their work — nothing is owed back."
                 : k === "offer" ? "They'd read what you send and tell you how it lands — nothing is owed back. Accept, and you can send them your work."
                 : "You're both in Dystoria's beta-reader exchange. Accept, and you can send each other manuscripts to read — a favour for a favour.";
      html = shell(
        `<h2 style="font-weight:500;font-size:26px;line-height:1.2;margin:12px 0 8px">${head}</h2>
         ${r.note ? quote(r.note, r.from_name) : ""}
         <p style="font-size:16px;line-height:1.55;color:#4a4236;margin:0 0 18px">${body}</p>
         ${btn(`${APP_URL}/#/beta`, "See the request")}`,
        `Sent by Dystoria because you joined the beta-reader exchange. We email once per request.`);
    }
    if (await sendEmail(r.email, subject, html)) done.push(r.id);
  }
  if (done.length) await admin.rpc("notice_mark_beta", { ids: done });
  return `beta: ${done.length}/${rows.length} emailed${RESEND_API_KEY ? "" : " (dry run)"}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let kind = "all";
  try { const b = await req.json(); if (b && typeof b.kind === "string") kind = b.kind; } catch (_) { /* the scheduler sends no body */ }
  const out: string[] = [];
  if (kind === "all" || kind === "invites") out.push(await inviteNotices());
  if (kind === "all" || kind === "friends") out.push(await friendNotices());
  if (kind === "all" || kind === "messages") out.push(await messageNotices());
  if (kind === "all" || kind === "beta") out.push(await betaNotices());
  return new Response(out.join("\n"), { headers: CORS });
});
