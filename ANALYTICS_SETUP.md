# Analytics Setup (PostHog)

User tracking is wired into `index.html` but **disabled until you paste a key**. With no key, every analytics call is a silent no-op — nothing is sent, nothing breaks.

## Turn it on (5 minutes)

1. Create a free account/project at https://posthog.com (the free tier is generous — ample for launch).
2. Project Settings → **Project API Key** (starts with `phc_`). Copy it.
3. In `index.html`, find the `Analytics (PostHog)` block in `<head>` and set:
   ```js
   var POSTHOG_KEY  = 'phc_your_key_here';
   var POSTHOG_HOST = 'https://us.i.posthog.com';   // use eu.i.posthog.com if you chose EU at signup
   ```
4. Push as usual. Open dystoria.net, do a few actions, and confirm events land under **Activity** in PostHog.

That's it — pageviews + traffic analytics come for free from the same setup, so no second tool to maintain.

## What's tracked

Identity: signed-in writers are identified by their Supabase user id (with email + username as properties). **Anonymous comment sessions stay anonymous** — `person_profiles: 'identified_only'` means casual visitors never create a profile, which keeps cost down and the privacy story clean.

Events (fired from `index.html`):

| Event | Fires when | Useful for |
|---|---|---|
| `$pageview` | any page load (automatic) | traffic, referrers, geography |
| `signed_up` | account created (`from_anon` flag) | top-of-funnel conversion |
| `signed_in` | sign-in succeeds | returning users |
| `story_started` | new blank story begun | activation |
| `writing_session_started` | a focus session begins (`fullscreen`, `ink`) | core engagement |
| `writing_session_ended` | session ends (`words` written, `wrote`) | did they actually produce prose |
| `mode_opened` | switching Map/Write/Refine/Read/Wiki (`mode`) | which of the 5 modes get used |
| `wiki_updated` | AI wiki rebuild run | feature usage |
| `story_shared` | a story is shared to another writer | virality / collaboration |

## First dashboards to build in PostHog

- **Activation funnel:** `$pageview` → `signed_up` → `story_started` → `writing_session_ended (wrote=true)`. This is the single most important view — where do new people drop off before writing real prose.
- **Mode usage:** bar chart of `mode_opened` broken down by `mode`. Tells you if Refine/Wiki/Read earn their place.
- **Retention:** PostHog's Retention view on `writing_session_started` — do writers come back.
- A few **session replays** of real first-time sessions (PostHog includes this) — worth more than any chart for spotting confusion in the writing pad.

## Privacy note (you chose per-user tracking)

Because events are tied to accounts, add a short line to your terms/footer, e.g. *"Dystoria uses PostHog to understand how the app is used. Usage is tied to your account; we don't sell data."* PostHog supports EU hosting and is GDPR-friendly. If you later want a consent toggle, the code already exposes `posthog.opt_out_capturing()` / `opt_in_capturing()`.

## Adding more events later

Anywhere in the app JS, just call:
```js
track('event_name', { any: 'properties' });
```
It's safe to call even with no key set.
