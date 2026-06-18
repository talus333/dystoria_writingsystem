# Daily comment-digest email — step-by-step (deferred / do later)

Goal: once a day, Supabase gathers the comments left on your stories that day and emails
you a summary. Three pieces: an email provider, the function that builds the email, and a
scheduler that runs it daily. All doable in the Supabase dashboard — no command line.

The function code already exists at `supabase/functions/comment-digest/index.ts`.

## Step 1 — Get an email sender (Resend)
1. Sign up at https://resend.com (free tier).
2. Verify a sender — your own domain, or for quick testing use their built-in
   `onboarding@resend.dev` address.
3. **API Keys → Create API Key**, copy it (starts with `re_…`).

## Step 2 — Create the function in Supabase
1. Dashboard → **Edge Functions** → **Create a function**.
2. Name it exactly `comment-digest`.
3. Copy the entire contents of `supabase/functions/comment-digest/index.ts` and paste it
   into the dashboard editor (replace the sample code).
4. **Deploy**.

## Step 3 — Give the function its secrets
1. Dashboard → **Edge Functions → Manage secrets** (or Project Settings → Edge Functions).
2. Add:
   - `RESEND_API_KEY` = the `re_…` key from Step 1
   - `DIGEST_FROM` = e.g. `Dystoria <onboarding@resend.dev>` (or your verified address)
3. Save. (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — don't add them.)

## Step 4 — Schedule it daily
1. Dashboard → **Integrations → Cron** (newer projects) or **Database → Cron Jobs**.
2. **Create a job**, name `dystoria-comment-digest`.
3. Schedule `0 1 * * *` (01:00 UTC daily — adjust for your timezone).
4. Target: choose **Edge Function** → `comment-digest`. If only a SQL/HTTP option is
   offered, use the pg_cron + pg_net snippet below (enable `pg_cron` and `pg_net` first
   under Database → Extensions):
   ```sql
   select cron.schedule(
     'dystoria-comment-digest', '0 1 * * *',
     $$ select net.http_post(
          url := 'https://<PROJECT-REF>.supabase.co/functions/v1/comment-digest',
          headers := jsonb_build_object('Authorization','Bearer <SUPABASE_ANON_KEY>')
        ); $$
   );
   ```

## Step 5 — Test now (don't wait a day)
1. Leave a test comment on a published story.
2. Dashboard → **Edge Functions → comment-digest → Invoke** (Run) to trigger manually.
3. Check your inbox. With no `RESEND_API_KEY` set, it runs "dry-run" and just logs who
   *would* be emailed (in the function logs) — handy to confirm it finds comments first.

## Notes
- Only emails when there were comments in the last 24h (no comments → no email).
- Each owner gets only their own stories' comments.
- To use Gmail/Postmark/SendGrid/SES instead of Resend, only the `sendEmail()` function in
  `index.ts` changes — ask and it'll be rewritten for that provider.
