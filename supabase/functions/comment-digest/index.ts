// ============================================================
//  DYSTORIA — daily comment digest email
//  Supabase Edge Function (Deno). Runs once a day, emails each story
//  owner a roll-up of the comments left on their stories that day.
//
//  Deploy:   supabase functions deploy comment-digest --no-verify-jwt
//  Secrets:  supabase secrets set RESEND_API_KEY=...  DIGEST_FROM="Dystoria <hello@yourdomain>"
//            (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)
//  Schedule: see public_sharing_migration_3 notes / the setup README (pg_cron → pg_net,
//            or Dashboard → Database → Cron Jobs, daily e.g. "0 1 * * *").
//
//  Uses Resend (https://resend.com) for delivery — swap the sendEmail() body for
//  Postmark/SendGrid/SES if you prefer; only that one function changes.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const DIGEST_FROM = Deno.env.get("DIGEST_FROM") ?? "Dystoria <onboarding@resend.dev>";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const esc = (s: string) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.log(`[dry-run] would email ${to}: ${subject}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: DIGEST_FROM, to, subject, html }),
  });
  if (!res.ok) console.error("resend error", to, await res.text());
}

Deno.serve(async () => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // comments from the last 24h
  const { data: comments, error } = await admin
    .from("story_comments")
    .select("id, story_id, author_name, body, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error) return new Response("query error: " + error.message, { status: 500 });
  if (!comments || comments.length === 0) return new Response("no comments today");

  // resolve story → title + owner
  const storyIds = [...new Set(comments.map((c) => c.story_id))];
  const { data: stories } = await admin
    .from("stories")
    .select("id, title, owner")
    .in("id", storyIds);
  const storyMap = new Map((stories ?? []).map((s) => [s.id, s]));

  // group comments by owner → story
  type Group = { title: string; items: { author: string; body: string }[] };
  const byOwner = new Map<string, Map<string, Group>>();
  for (const c of comments) {
    const s = storyMap.get(c.story_id);
    if (!s) continue;
    if (!byOwner.has(s.owner)) byOwner.set(s.owner, new Map());
    const stories2 = byOwner.get(s.owner)!;
    if (!stories2.has(s.id)) stories2.set(s.id, { title: s.title || "Untitled story", items: [] });
    stories2.get(s.id)!.items.push({ author: c.author_name || "Guest", body: c.body });
  }

  let sent = 0;
  for (const [ownerId, stories2] of byOwner) {
    // owner email via admin auth
    const { data: u } = await admin.auth.admin.getUserById(ownerId);
    const to = u?.user?.email;
    if (!to) continue;

    let total = 0;
    let html = `<div style="font-family:Georgia,serif;max-width:560px;margin:auto;color:#2a2620">
      <h2 style="font-weight:500">New comments on your stories</h2>`;
    for (const [, g] of stories2) {
      html += `<h3 style="margin:18px 0 6px">${esc(g.title)}</h3>`;
      for (const it of g.items) {
        total++;
        html += `<div style="margin:0 0 10px;padding:8px 12px;border-left:3px solid #c8a24a;background:#faf7f0">
          <div style="font-size:13px;color:#8a8276">${esc(it.author)}</div>
          <div>${esc(it.body)}</div></div>`;
      }
    }
    html += `<p style="font-size:13px;color:#8a8276;margin-top:20px">
      Open Dystoria and switch a story to <b>Refine</b> to reply or manage these.</p></div>`;

    const subject = `${total} new comment${total === 1 ? "" : "s"} on your Dystoria stories`;
    await sendEmail(to, subject, html);
    sent++;
  }

  return new Response(`digest sent to ${sent} owner(s)`);
});
