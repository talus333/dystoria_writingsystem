# Public reader link + reader comments — setup

The client code is already in `index.html`. It needs **two backend steps** before it works,
plus an **optional** step for the daily comment-digest email.

## 1. Run the SQL migration (required)
Supabase dashboard → **SQL Editor** → New query → paste all of
`public_sharing_migration_3.sql` → **Run**. (Idempotent — safe to re-run.)

This adds: `stories.is_public` + `stories.public_token`, the `story_comments` table,
RLS so anonymous readers can read/leave comments on a *public* story only, and the
RPCs `set_story_public`, `get_public_story`, `add_public_comment`.

## 2. Enable anonymous sign-ins (required)
Dashboard → **Authentication → Sign In / Providers → Anonymous sign-ins → Enable**.
This lets a reader leave a comment under a name without creating an account.
(Comments are still attributed and the owner can delete any of them.)

Then **hard-reload** the app (Cmd+Shift+R).

## How it works
- Open a story you own → menu (☰) → **Public reader link** toggles it on and copies a
  link like `https://dystoria.net/#/read/<token>`. **Copy reader link** copies it again.
- Anyone who opens that link sees a clean, read-only view of the story — no other modes,
  no map, no editing. A **© Year Author — All rights reserved** notice sits at the foot,
  asserting your ownership ("shared for reading only, do not copy/redistribute").
- Readers select a paragraph and leave a comment. With no account they pick a name
  (anonymous); if they sign in / create an account it uses that name. Comments appear
  live for everyone with the link.
- **You** see those comments in **Refine mode** (keeps Read clean): a "Reader comments"
  panel with **Hide comments** (hide them all) and a **×** on each to remove it.
- CTAs in the reader: **Comment as yourself** (sign in / create account) and
  **Try Dystoria →** (opens the full app fresh).

## 3. Daily comment-digest email (optional)
Emails each owner a roll-up of the day's comments on their stories.

1. Install the Supabase CLI and link the project.
2. Get an email provider key — e.g. [Resend](https://resend.com) — and set secrets:
   ```
   supabase secrets set RESEND_API_KEY=re_xxx DIGEST_FROM="Dystoria <hello@yourdomain.com>"
   ```
   (Without a key the function runs in dry-run and just logs who *would* be emailed.)
3. Deploy: `supabase functions deploy comment-digest --no-verify-jwt`
4. Schedule it daily. Dashboard → **Database → Cron Jobs** (or SQL with pg_cron + pg_net):
   ```sql
   select cron.schedule(
     'dystoria-comment-digest', '0 1 * * *',   -- 01:00 UTC daily
     $$ select net.http_post(
          url := 'https://<PROJECT-REF>.supabase.co/functions/v1/comment-digest',
          headers := jsonb_build_object('Authorization','Bearer <SUPABASE_ANON_KEY>')
        ); $$
   );
   ```
   (Enable the `pg_cron` and `pg_net` extensions first, under Database → Extensions.)

The function code is in `supabase/functions/comment-digest/index.ts`. To use Postmark/
SendGrid/SES instead of Resend, change only the `sendEmail()` function.

## Notes
- AI features stay disabled for anonymous readers (the worker already rejects unsigned
  requests) — nothing changes there.
- The reader link is read-only and scoped to one story; turning the toggle off makes the
  link stop working immediately.
- I couldn't end-to-end test against the live database from here, so do a first run
  together: publish a story, open the link in a private window, post a comment, and
  confirm it shows up in your Refine panel.
