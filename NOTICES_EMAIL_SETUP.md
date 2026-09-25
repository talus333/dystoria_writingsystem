# Email notices — step by step

The `notices` function sends two kinds of email:
- **Co-author invitations** (v.824). When a story's owner ticks "Email the invitation", the person invited gets an email whose button opens the invitation. Replies go to the owner. The app asks the function to run straight away, so it arrives in seconds.
- **Messages that waited** (v.823). When a writing partner's messages have gone unread while you were away, one email goes out, at most every six hours.

Three pieces, all in the Supabase dashboard:
- an email sender (Resend);
- the `notices` Edge Function;
- a timer that runs it every 15 minutes.

**Before you start:** migrations 12, 13, 14 and 15 must already have been run.

## 1 · An email sender (Resend)
If you set up Resend for the comment digest, reuse that key.
1. Sign up at https://resend.com (the free tier is plenty for the beta).
2. Verify a sender. Your own domain (e.g. `dystoria.net`) is best. `onboarding@resend.dev` works for testing, but can only send to your own address.
3. **API Keys → Create API Key**, and copy it (it starts with `re_`).

## 2 · The function
1. Dashboard → **Edge Functions → Create a function**, named exactly `notices`.
2. Paste the whole of `supabase/functions/notices/index.ts` over the sample, then press **Deploy**.
3. **Edge Functions → Manage secrets** and add:
   - `RESEND_API_KEY` — the `re_…` key
   - `NOTICE_FROM` — e.g. `Dystoria <hello@dystoria.net>` (a verified sender)
   - `APP_URL` — `https://dystoria.net` (the address the email buttons open)

## 3 · Every 15 minutes
Dashboard → **Integrations → Cron** (or **Database → Cron Jobs**) → **Create job**:
- name `dystoria-notices`
- schedule `*/15 * * * *`
- target: Edge Function → `notices`

If only SQL is offered, enable `pg_cron` and `pg_net` under Database → Extensions, then run:
```sql
select cron.schedule('dystoria-notices', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://gurwhrypskhzdledxeqk.supabase.co/functions/v1/notices',
    headers := jsonb_build_object('Authorization', 'Bearer <YOUR ANON (publishable) KEY>')
  ); $$);
```

## 4 · Test it
**An invitation:**
1. In a story's People panel, invite an address you can read, with **Email the invitation** ticked.
2. The email should arrive within seconds, with the story's title and an **Open the invitation** button.
3. Its panel row then reads "emailed just now".

**A waiting message:**
1. From a second account that is your writing partner, send yourself a message and don't open it.
2. Wait 15 minutes, and stay out of the app for 10 of them.
3. **Edge Functions → notices → Invoke.** The response says `invites: 0/0 emailed` and `messages: 1/1 emailed`.
   - Without `RESEND_API_KEY` it answers `(dry run)`, logs who it would email, and marks nothing, so the real run still sends later.

## What stops an invitation email
- The invitation is revoked, accepted, declined or expired.
- It has already been emailed three times.
- The last email went out less than 10 minutes ago.
- The owner has asked for 40 or more invitation emails today.

## What stops a message email
- The message has been read.
- It's under 15 minutes old.
- The writer was in the app in the last 10 minutes.
- They already had one of these emails in the last 6 hours.
- Their email address isn't confirmed.
- They turned "Email me when messages wait" off.
- One of the two has blocked the other.
