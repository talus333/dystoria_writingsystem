# Dystoria — Roadmap (what's left to do)

_The forward plan: only open work. What's already shipped lives in **`Dystoria_Shipped.md`**. Old roadmap IDs are kept in brackets [R#]. Status: ☐ planned · ◐ in progress · ✓ done (moving to Shipped)._

**App version:** v.671 (internal `APP_VERSION` still `2026.07.20.624`) · **Updated:** 2026-09-11 · _md5 `c400e1dec0de54fe08e5483c13b1a2fd`, **written to the repo folder and verified on device**. `worker.js` md5 `c2161c9674113095942e7a27a81645d8`, unchanged._

> **⚑ THIS FILE WENT FORTY-SIX VERSIONS STALE, AND THE STALENESS COST REAL WORK (caught 2026-09-07).**
> Its header still said *App version `2026.07.20.601`* and *"delivered to the conversation, NOT yet written to the repo folder"* — both untrue for a month. It carried **no entries for v.602 onward**. **#55 was not on the Board at all**, despite being seven versions of work. And it listed **#54 phase 2 as unbuilt when it had shipped in v.609–v.611** — which sent a session off to build something that already existed, caught only because the app was measured instead of the file being believed.
>
> **Two rules come out of that, and they are the reason this file was rewritten rather than patched:**
> 1. **The roadmap is for OPEN work.** It had become a 60KB history of closed items, and a file that is mostly history is a file nobody trusts for status. Closed narrative lives in `Dystoria_Shipped.md`, which is maintained every ship. **What is kept here is what a future session must not have to rediscover**: the open items, the standing traps, and the patterns.
> 2. **Update the header on every ship.** One line — version, md5, date. It is the single cheapest thing in this file and the one that misled hardest when it was wrong.
>
> _A **file** in the repo folder would make this patchable rather than retypable, which is v.586's fix for the help guide applied to planning docs. Worth doing the next time this file is touched._

---

## Launch status

**The legal item is closed** (`v2026.07.13.9`): Privacy Policy and Terms in full text inside the app (`#legalModal`), opened from sign-up, checkout and the cookie banner; an **enforced** sign-up acceptance (`.ac-agreebox`; `_su` refuses without it) reading *"I'm 13 or older and agree to the Terms and Privacy Policy"*, where the number is `dystMinAge()` and **becomes 16 in the EEA and UK**; a consent banner (`#consentBar`) gating PostHog, which is initialised `opt_out_capturing_by_default: true` and captures nothing until consent, stored at `dystoria.consent`; and the **AI sub-processor disclosure** naming all seven vendors — Anthropic, Google, Cerebras, Groq, Mistral, OpenRouter, Cloudflare — with per-provider retention and training notes at the model picker.

_A lawyer's review of the drafted policies remains recommended before scaling paid usage — not a launch blocker for an indie beta._

### RLS — what is done, and the two things left. **Jeremy's to run.**

**Phase 1 (configuration) — COMPLETE and passing, verified in the production SQL editor 2026-08-23.** RLS is on **all EIGHT tables** — `ai_usage`, `feedback`, `profiles`, `stories`, `story_collaborators`, `story_comments`, `story_impressions`, `subscriptions` — each with at least one policy. **No policy permits everything** (the sweep for a SELECT/UPDATE/DELETE with condition `true` returned zero rows). **`subscriptions` is write-locked**: one SELECT-self policy and no INSERT/UPDATE/DELETE at all, so only the service-role Stripe webhook can move anyone to Pro — the single most important line on this list, and it holds. `profiles` and `stories` are owner-or-collaborator scoped, with `with_check` on the UPDATE so a row cannot be edited into someone else's ownership.

**Grants (1.4):** `subscriptions`, `ai_usage` and `story_impressions` are SELECT-only for both roles — the paid tier is protected twice. The other five carry Supabase's default `GRANT ALL`, so **RLS is the only line** there: sound today, no defence in depth, one accidental `DISABLE ROW LEVEL SECURITY` from catastrophe. **`revoke truncate … from anon, authenticated`** has been run — TRUNCATE ignores every policy and could never do anything legitimate for those roles.

**Functions (1.5):** every `SECURITY DEFINER` function has `search_path` pinned. **`share_story` and `set_story_public` both open with `is_story_owner(sid)`** — which matters most, because with no INSERT policy on `story_collaborators` that function is the only route to becoming a collaborator. There is **no INSERT policy on `story_comments` and no public-read policy on `stories`**: both public paths run through the `SECURITY DEFINER` RPCs (`add_public_comment`, `get_public_story`), which is the right shape and means those two functions carry the whole weight of the public reader.

**Migrations applied to production and verified by read-back (2026-08-23):**
- **`overload_shims_migration_9.sql`** — **this was a real hole.** Three RPCs had two live overloads each, and the pairs were **not equivalent**: `add_public_impression(text,text,text)` was missing every guard the newer uuid form had gained — no signed-in check, **no `allow_impressions` check (it wrote marks to a link whose author had turned impressions OFF)**, no kind validation, no empty-anchor check, no 2,000-character clamp, and **no rate limit** where the uuid form caps 60/minute. **The fix is a shim, not a DROP, and the reason is on the wire:** PostgREST picks an overload from the parameter NAMES in the request body, and the client calls `get_public_link_settings` with `tok` alone — ambiguous. Dropping is a bet on which signature the wire picks; delegating is not. Each old form is now a one-line delegator, so there is ONE implementation of each rule and the old signature inherits every future check. Each carries a `comment on function` marking it a shim — _the whole failure was an overload nobody remembered, so the database says so out loud._ **Verified on a real Postgres 16, not just a parser:** libpg-query validates grammar, but **a plpgsql body is only a string literal to it — a body that cannot compile parses clean.** The harness (`tests/migration_9_scaffold.sql` + `migration_9_probe.sql`) stands up a scratch cluster and runs it for real; applied twice to prove it is re-runnable.
- **`reader_privacy_migration_7.sql`** — unpublishing now nulls `public_token`, so a revoked link is dead for good and republishing mints a new one; a visitor's SELECT on `story_comments` is scoped to `author_id = auth.uid()` while author and collaborators still see everything; readers can read back their own marks.
- **`policy_cleanup_migration_8.sql`** — the five duplicated first-generation `{public}`-role policies are retired. **`stories` is now exactly four policies, all `{authenticated}`, all collaborator-aware.** The drift trap is closed: no second, collaborator-blind copy of a rule waiting to undo a future tightening.

**Phase 3 (PostgREST, the anon key the bundle actually carries) — RUN 2026-09-03: 17 passed, 0 failed.** Anonymous reads of all eight tables return 200 with an empty array. The paid gate holds from both directions and holds *loudly*: anonymous insert and patch refused 401, a signed-in self-upgrade refused 403 — a status refusal, not a silent zero. A signed-in user reads exactly one profile row, one subscription row, and nobody else's `ai_usage`.

> **One reported PASS was withdrawn on inspection, and it is the useful part of the run.** *"anon cannot delete stories (204)"* was a sentence about the status line and not about the database: PostgREST answers a DELETE with `204 No Content` whether it removed nothing or everything, and the script only sent `Prefer: return=representation` on requests that had a body — which a DELETE does not. Both phase-3 scripts now send `Prefer` on every write, and `rls_phase3_followup.js` does the delete probe honestly: it creates a throwaway story, asks the anonymous key to delete *that*, checks whether it survived, and cleans up — so the thing being risked is never one of the writer's own rows.

**⚠ WHAT IS ACTUALLY LEFT — and it is Jeremy's, a couple of hours:**
1. **Phase 2 (impersonation).** `rls_phase2_impersonation.sql` is written and **rehearsed against a scratch PostgreSQL 16 with a Supabase-shaped fixture**; it impersonates owner / collaborator / stranger inside one transaction ending in ROLLBACK and tries reading, updating, reassigning ownership past the WITH CHECK, deleting, reading the collaborator list, reading another user's `ai_usage` and profiles, and — the one that matters most — inserting a subscription, self-upgrading, changing someone else's and deleting their row. Owner-delete is behind `TEST_DESTRUCTIVE`, off by default. **Against the correct policies it reports 19 passed, 0 failed.** Running it against production is the open item.
2. **Phase 3's two loose ends.** (a) Four stories are readable by the test account but owned by someone else — that is what a genuine collaboration looks like *and* what a leak looks like; the difference is whether a `story_collaborators` row exists, which the follow-up script checks. (b) The **cross-account** read/patch/delete probes were skipped because `OTHER_STORY_ID` was empty; they need a story id from an account that has never shared with the tester, so **a throwaway second account is required. They are the sharpest probes in the set and phase 3 is not finished without them.**
3. **One decision, not a hole:** `set_story_public(sid,false)` — settled for the token by migration 7. Re-check by unsharing a test story and trying its old public link.

_Files in the repo folder: `rls_phase2_impersonation.sql`, `rls_phase3_console.js` (browser version, no terminal needed), `rls_phase3_followup.js`, `rls_phase3_postgrest.sh`. **The trap the runbook exists to name: the Supabase SQL Editor BYPASSES RLS**, so anything checked there without impersonating proves nothing._

**The counter-test is the reason to trust phase 2.** Three policies were deliberately broken in the fixture and the first draft reported only **three of the five** resulting failures — because **a successful destructive probe was hiding the ones after it**: the broken policy let the collaborator delete the story, so the row was gone when the stranger tried to read it, and **the stranger's probe passed for the worst possible reason.** Every write is now undone the instant it is measured.

### Egress — fixed, and the ceiling is a launch decision

The project was restricted for `exceed_egress_quota` on Free's 5 GB: **10.14 GB against a 33.53 MB database with 4 monthly active users**, which was `cloudPull()` fetching every story's full document on every page load and hourly token refresh. **Fixed in v.423**, and the fix worked: eleven days into the next period, **0.205 GB of 5 GB** — the multiplier fell about **18×** (327 MB/day → 18.6 MB/day), with the heaviest day 68.8 MB against the old 400–760 MB.

**`liveDocStr()` is cleared, with a number rather than a suspicion.** The dashboard splits egress by source and **Realtime is under 0.9% of every day** (278 KB on the busiest). **PostgREST is 99.0–99.8% of every bar.** So **#11 presence is CHEAP** and the "fix `liveDocStr()` first" branch is dropped — and note that presence moves traffic INTO the Realtime column, which has all the headroom (864 messages of 2,000,000; peak 4 concurrent connections).

**⚠ The grace period is over.** Reaching 5 GB now **stops the project serving** rather than warning first. At ~12% of quota there is room, but there is no soft landing, which raises the price of the next regression.

**Headroom, worked 2026-08-23** [Jeremy: _"this seems like it can't hold many users"_ — he is right, and the honest answer is a range]:

| | egress / writer / month | writers on Free (5 GB) | writers on Pro (250 GB) |
|---|---|---|---|
| Naive — all 11 days, 1 MAU | 0.58 GB | **~9** | ~430 |
| Old period rescaled by the 18× fix (4 MAU) | 0.14 GB | **~35** | ~1,800 |

**The range is the finding.** The period has 1 MAU and ~90% of its traffic is development (15 Aug and 21–23 Aug are build days). **There is no writer-only fortnight in the data yet**, so a single number would be false precision. Database never binds (33 MB; ~8 MB a user → ~60 users against Free's 500 MB, so **egress binds ~7× earlier**), MAU never binds (50,000). On **Pro at $25/month** the marginal writer costs **1–5¢/month**. **So the economics are fine and the FREE TIER is the problem** — it is a personal-use plan for this app, not a beta plan. _A beta with more than a handful of writers goes on Pro first._

**v.483 and v.484 closed the two remaining whole-document reads** — `restoreHeavyFromCloud` asks for the missing heavy fields only, and `backupAll()` stopped doing `select('id,doc')` over the whole library (which was pulling other people's shared stories too). **No read in the app fetches a whole document speculatively any more.**

**⚠ RE-MEASURE.** v.483/v.484's saving is un-quantified — obviously large in shape, and nobody has watched the dashboard since. **Redo the headroom table after a week of ordinary use, and this time from a period WITHOUT build days in it.**

### One cloud question still open

**The phantom "changed on another device" conflict** was fixed at v.431 (four causes, all in Shipped). The one that cannot be closed from here: **if RLS permits the UPDATE but returns nothing to the following SELECT**, `cloudSave` sees zero rows on a perfectly good save. v.431 no longer raises a dialog — it keeps the work and says the cloud copy could not be confirmed — but **that message appearing repeatedly is a real signal** that the policy needs a `USING` clause letting the row be read back. Phase 2/3 settle it directly with one owner-authored `PATCH … Prefer: return=representation` that must come back with the row rather than `[]`.

---

## Board

| # | Item | Status |
|---|------|--------|
| 11 | **Co-Author presence & roles** — presence ✓ v.486; **roles + invite (a migration + RLS changes, its own session) and the section soft-lock remain** | ◐ |
| 14 | **Beta-reader loop** — reader display-name without an account; threaded reply + resolve; unread badge / email digest; access + spam guard | ☐ |
| 15 | **Feedback + community** — throttled #crashes forwarding; public community/roadmap channels; Supabase attachment polish | ◐ |
| 18 | **Series continuity** — a frozen canon snapshot a new book inherits | ☐ |
| 27 | **Map sectioning ("Spaces")** — **superseded by #48's zones (v.622+)**: many canvases with labelled boundaries inside each answered spatial containment with a fraction of the regression a 3×3 pane grid would carry. Closed with #48's bring-from (v.666); the reasoning stays in the Places design doc §8 | ☒ |
| 30 | **Modelling — flowcharts-with-rules** *(uncertain future; held at arm's length)* | ☐ |
| 35 | **Prose ↔ element links** — aliases ✓ v.458, read-only links ✓ v.459; **the anchored model needs design first, and the first question is whether it is needed at all** | ◐ |
| 45 | **The landing hero** (`welcome_undaunted.html`, not the app) — package A ✓ 2026-08-27; **package B and the polish items remain** | ◐ |
| 46 | **Stakes as one object** — 1a ✓ v.562 · 1a′ ✓ v.564 · **1b ✓ CLOSED v.567–v.571, v.667** (roster, offer, key identity, the grid surfaces, and v.667: Stakes a Story Elements row read with bearers, the layer card retired into a read + ✎ carry, pill as typed, a Conflict word is an axis — three rulings [Jeremy 2026-09-09]). **Left: phase 2 — portents + `COL_KINDS.stake`; phase 3 — movement (ladder / clock)** | ◐ |
| 47 | **Conflict axes** ✓ CLOSED v.669 — derived rather than typed. Phases 1–3 ✓ v.668 (the driver — story-level, optional; the Conflict row's sentence naming the things; the strip in Plan under the row, collapsed, ⚔ bonds as a lighter mark; the three findings in Checks) [four rulings, Jeremy 2026-09-09] · phase 4 ✓ v.669 (the **Battle lines** lens on Bonds — only the ⚔ bonds; **▸ by axis** on the Conflict row — stakes grouped by axis, + stake with the axis pre-filled, + another axis). *Left by design:* colour on the grid's stake columns (with #46 phase 2), a per-Part driver (when a story needs it) | ✓ |
| 48 | **Places** ✓ CLOSED v.666 — phase 0 ✓ v.602–v.606 (one editor: the map's Edit dialog is a route to the card; inline rename is the fast path) · phase 1 ✓ v.617 (Places, Scenes/Maps) · phase 2 ✓ v.618 (a board per scene, the carry-over offer) · phase 3 ✓ v.619–v.621 (maps as objects, nesting by pin) · zones ✓ v.622–v.632 · **zones offered into a new section ✓ v.664** · **the At Stake hook ✓ v.665** (an *At Stake* / *At risk* zone offers, under its pill, to name what each unanswered member stands to lose; the answer is a stake element with bearer + the containing Place as threat — offer, never apply). · **§6 bring-from ✓ v.666** (both directions, copies with provenance `w.fromMap` / `w.fromScene`, from the ⋯ menu; §6's optional map-crop backdrop not built). **CLOSED — see Shipped v.617–v.666.** *Named, not built:* changing an element's category has no door since the dialog retired (v.606). Supersedes #27 | ✓ |
| 49 | **Drama** — situations built from parts. Phase 0 ✓ (v.565–566, v.572); the rest depends on #46 1b | ◐ |
| 50 | **Events that move** — **CLOSED v.659.** phase 1 ✓ v.656 (`eventShift[key]={from,to}` — What changes on the Event Builder, the card, the Scene Context row) · phase 2 ✓ v.657 (`eventLinks=[{a,b,rel}]`, two verbs; *Because of* on the builder; *Because of* / *Leads to* on the card; Gap & Chekhov's certain finding for a cause that first appears after its effect, and for a circle — ordering read live; the certain findings render with the AI down) · phase 3 (`eventKnown`, the who-knows ledger) shipped v.658 and **retired v.659 by Jeremy** — _"this should be in the prose, or mapped out in a scene through connections"_ · phase 4 ✓ v.659 (the sweep — What changed? across every event on ‹ › and the arrow keys; the domino walk building the chain backwards, new events made in the effect's section). Builder order [Jeremy]: characteristics first. Note: two unnamed-kind events share one key (`0|event|Event`); the walk gives a collision an `iid`, the builder still does not. | ✓ |
| 53 | **Shape, colour and line on the Bonds map** — phases 1, 2 and 4 ✓ (v.583, v.587–v.590, v.592–v.593). **Left: phase 3, the per-element style picker**, and the dash/colour overrides that depend on it | ◐ |
| 68 | **The writing session's start** — Continue brings the prose in cleanly and editable ✓ v.648; the Continue/Begin prompt indented with the paragraphs so the words land where it stood ✓ v.649; the prose on the page while the card asks, Start a new section clears it, and the `keepPrior` hold no longer leaks across sessions ✓ v.652. **Left:** the Living Page still DIMS earlier prose (its own effect, not the retired lock) — Jeremy has not asked for that to go, so ask before touching it | ◐ |
| 54 | **Speech and thought bubbles** — **phase 1 ✓ v.607–v.610, phase 2 ✓ v.609–v.611** (the stepper, dots per side), **scene-scoping enforced ✓ v.646**. **Left: phase 3** — the double-game finding, and whether the pair reaches the manuscript export | ◐ |

**Closed since the last update of this file, and in `Dystoria_Shipped.md`:**

- **#55 · A group is present when its members are — phases 1–3 CLOSED (v.641, v.647, v.645), 2026-09-06/07.** Design: `claude/Dystoria_Groups_Presence_Design.md`. [Jeremy] _"I think I want to dissolve the concept of the Party with the expand and contract… having a Group created as an element with it's members, and then in a scene if multiple members of a group are in the scene then the Group element is automatically added to the context sidebar."_ **Phase 1 (v.641):** presence is DERIVED and stored nowhere — `groupsPresentNow()` asks the board which members are standing on it, and the row, the header count, the dimming and the web all read that one answer. A group with **two or more** members here gets a row keyed `data-gid`, selecting as side `'G'`; the pill reads `Name · k of n here`; **nothing is written**. **Phase 2 (v.647):** membership is timeless — the scope row leaves the builder, a new group gets no range, an old record's range is left exactly as found (v.646 had been silently *moving* it), and *Party size* becomes *Group size*. **Phase 3 (v.645):** **a group has no node** — every member is drawn, no cluster, the group's name off the leader's forehead, `dystSyncParties` stops minting and placing, and explode/combine is retired in all three homes. **Phase 4 CLOSED: 4a ✓ v.653** (the real remainder of "one editor" was two STORES — a Group Builder group lives in the Bonds store and was never present through its members; one read, `groupRecordsAll`, covers both) **· 4b ✓ v.655** (the leader is a character; the group's CARD holds the whole-group ◎ and Disband on both editors; the chip reads the row's `groupActsInto`; "party" out of every UI string; `caps.scope` swept). _Note only: the Group Builder declares no `count` beyond its named members; the map-side card still does. Nobody has asked._
- **v.642–v.644, v.646** — the Context pencil opens the element's **card** rather than a creator; the party's explode leaves that row; the group icon leaves a character's ring; the say/think control becomes a drawn speech bubble; the member picker's skin stops living inside the Bonds stylesheet; and **a line of dialogue belongs to a scene** (a map drew the last scene's bubbles and would have written new ones into it).
- **#52 Groups beyond beings — CLOSED v.600** (v.580–v.600): the cast is the bucket, the kind is the sub-type, the lens is the structure. **Left deliberately unbuilt, Jeremy's ruling:** per-kind FEATURES wait until the openness has been used in anger — _"leave rules for specific types of groups until later"_.
- **#51** the builders' level control (v.573–v.575) · **#44** the whole-app style pass (v.509–v.516) · **#43** the pop-up pass (v.487–v.494) · **#31** the AI cap policy (v.482) · reader-link revoke and reader privacy (v.481 + migrations 7–8) · the Bonds picture rework (v.474–v.478) · **#29** the visual style pass (v.445–v.473) · **#6** element deepening (v.465–468) · **#7** notepad rich formatting (v.460–463) · **#33** Reader Impression (v.457) · **#12** version history (v.456) · **#32** Patterns (v.455) · **#2** the Write-mode router (v.454) · **#17 + 17b** the wiki as the reference document (v.433–v.444) · **#25** Arcs as a Plot Grid column (v.418–v.424) · **#24 Bonds** and its family (#37–#40) · and everything earlier — #3, #8, #9, #10, #13, #16, #19–#23, #26, #28, #34, #36, #41, #42.

_Two docs carry the closed detail rather than this file: **`Dystoria_Shipped.md`** (every version, newest first) and **`claude/Dystoria_Style_System.md`** (#29's live rules, kept so they survived that item's closure)._

---

## The open items, in detail

**11 · Co-Author presence & roles** ◐
Version-guarded save ✓ v.371. **Presence ✓ v.486** — "Aria is writing §3" in the centre of the mode bar with a coloured initial disc, computed on the peer's own device (`liveMyAction()`), travelling as `act` on the presence payload, **polled every 3s and re-tracked only on change** so no list of hooks can go stale. The per-mode guide sentences are retired and **`#deskStatus` now has exactly one writer**.
**Remaining:** real Viewer/Suggester/Editor roles and invite-by-email — **a migration + RLS changes, its own session** — and the **section soft-lock**, deliberately deferred until the visible half has been used in anger.
_Two things to carry in. **There is no avatar anywhere in Dystoria**: the disc is a hashed-colour initial, and a real profile picture is a one-line swap in `liveRenderPresence`. And **`liveFitPresence()` measures the free gap in the bar rather than reserving a fixed width**, because `calc(100% - 320px)` suited Ember's icon buttons and put the line through Classic's labelled pills — anything added to that bar must keep `t_presence.js`'s geometry assertions green._
_`liveDocStr()` broadcasts the full document on every save: fine for one collaborator, the wrong shape for several. **Not an egress problem** (Realtime is under 0.9% of every day), so it is a design chore for whenever several collaborators are real._

**14 · Beta-reader loop** ☐
Reader display-name without an account; threaded reply + resolve; unread badge / email digest; access + spam guard. _Most of the reader side already exists — #33 (v.457) shipped public links, impressions, marks and a reader with no account — so this is largely built on plumbing that is there._
**⚠ It owns one open RLS question:** comments on a public story are readable by any visitor (`comments_select_public` grants SELECT to `anon` wherever `story_is_public`) — right for a visible thread, a leak if reader feedback is meant for the author alone.

**15 · Feedback + community** ◐
Throttled **#crashes** forwarding; public community/roadmap channels; Supabase-side attachment polish.

**18 · Series continuity** ☐
A new book inherits a **frozen canon snapshot**; the author curates which elements re-enter as living copies. The one rule: **editing the fork never mutates canon.**
**⚠ The fork list is the whole cost, and it grows every time a store is added.** `state.session.bonds` is story-level and must fork — **and so must every store added since**: `elAliases`, `customDims`, `customDimWords`, `npPages`' fold-back migration, `plotDefs`, `exploreLog` (v.485), `stakeData` (v.562), the Bonds side stores (v.596), `beingGroups`, and **`elStyle`/`bondStyle` when #53 phase 3 writes them**. _Each new store is another thing the fork has to know about, which is an argument for building this later rather than sooner — and an argument for the fork list living beside the stores rather than in a doc._

**27 · Map sectioning ("Spaces")** ☐
Up to a **3×3** grid of infinite-scroll panes; ship a 2-split first; high regression. _Spatial containment — distinct from Bonds, which is topology._
**⚠ Read #48 before starting.** #48 attacks the same problem from the other end — many maps with labelled zones inside each, rather than one canvas divided into panes — with far less regression risk, because **a zone is a shape in an existing `prompt` while a pane grid is a rewrite of the canvas's viewport model.** **The recommendation is to close #27 as superseded when #48's zones ship**, which also frees the word *Spaces* for the zones themselves.

**30 · Modelling — flowcharts-with-rules** ☐ *(uncertain future)*
**Held at arm's length** (§Vision). _Bonds is the sanctioned relational canvas and is complete._

**35 · Prose ↔ element links + name-sync** ◐
**Phase 1 ✓ v.372. Aliases ✓ v.458** — `state.session.elAliases[key]` (one canonical map), `elTextHit()` (the one mention predicate, shared by the recap scan, wiki woven/gather, section-presence and phase 1's link/replace-all), dossier "Also known as" chips. **Read-only links ✓ v.459** — `elMentionLinkify()` wraps mentions in Read's manuscript view and the wiki (render copies, safe to wrap); beings link on name+aliases only, because their word is a TYPE; book view and guests skipped.
**Remaining: the anchored model** — mentions carrying `data-el-key` in the LIVE prose. **The invasive piece:** undo, copy/paste, dictation, exports and the importer all touch stored spans. **Design before building — and ask first whether v.458 + v.459 already deliver enough of the value to leave live-prose anchors unbuilt.**

**45 · The landing hero** ◐ *(`welcome_undaunted.html`, not the app)*
**Package A shipped 2026-08-27**: the canvas port + lit path, bow-wave, arrival ring, thread from the visitor, lantern cursor (7 → 40/58 fps).
**Left:** package B — the thread drawing down the page between the three sections (5), the headline lifting out of the maze (8) — and the polish items: sources on hover (7), depth layers (9), a daily seed (10), the maze's typography (11).
**⚠ The page is generated by `patch_landing.py`, not hand-edited.** Build notes and traps in `claude/Dystoria_Landing_Hero_Plan.md` §0.

**46 · Stakes as one object** ◐
Design doc: `claude/Dystoria_Stakes_And_Events_Design.md`, **rewritten against source 2026-09-01** because its first draft was wrong in ways worth knowing about.
**Shipped:** **1a (v.562)** a Stakes element carries a **Bearer** and a **Threat** (`state.session.stakeData[<elementKey>]`, section-free), and `resolveCardStake` gained a step in front of its existing four — **additive by construction**, so with no bearer set anywhere every pill resolves exactly as before. **1a′ (v.564) the Axis** — `stakeData.axis`, one of the ten words in the category's own **Conflict** subcategory, with `__stakeAxis(key)` answering **declared, else derived** from the threat's category (and `bearer === threat` reading as *against themselves*). **A field, not a category** [Jeremy]: the vocabulary is closed at ten, so grouping works against a string. **1b so far:** the roster (v.567), the offer (v.568–569) — which **offers and never applies** — key identity (v.570), and the grid's stake system put on the page (v.571).
**1b closed v.667:** the surfaces resolve to the element by NAME (v.571's `__stakeElByText` — no key migration); the Stakes layer card is retired into a derived read with its words offered and its prose carried by ✎; Stakes is a Story Elements row read with bearers; the start card keeps its four (its Stakes step mints stake elements; `+ roll` draws At Stake only) and the Help Guide says so. **Remaining:** **portents + `COL_KINDS.stake`** (phase 2), and **movement** (phase 3, the ladder / the clock).

_**Five things the source said that no design doc did.** `stakes` is **already** an element category with a pool, so 1b is a **promotion between `LIB_GROUPS` groups, not a registration**. Its second subcategory is **Conflict**, ten authored words — **which is #47's whole taxonomy, already in the data**. Stakes already cascade card → thread → **part** → story through `resolveCardStake`, and **part-level stakes appear in no other doc**. There are **eight** stake surfaces, not five. And two field names in the first draft were wrong: the card store is `data.plotCardStakes[colId|i]`, the thread stake is `threadStake(colId)`._

**⚑ v.571 — the Plot grid's stake system was DEAD CODE and is now on the page.** `stakePill` was called only from `storyStakeBanner` and `buildCardStakeRow`; **neither had a caller**, so `resolveCardStake` — and with it v.562's phase 1a — was never reached. **Proved dynamically before building:** five functions instrumented, four modes × four Plan views plus a card popup and a thread popup fired **none** of them, with a live chip maker as the control.
_Four independently finished layers, none connected: the two builders (no caller), their containers (**no CSS at all**), `onFeather` (option + icon + both-theme CSS, never passed), and `.pl-stake-lvl` (**`display:none`** — the slot v.562 wrote the bearer's name into for eight days). **The style passes sweep surfaces that are ON SCREEN**, so a container that never rendered was never styled and looked unfinished only once drawn. Dead code does not decay loudly; it gets skipped by every later pass and looks finished the whole time._

**⚠ Still open here:** a photograph of the two halves together — a card popup whose level slot reads the **bearer's name** rather than the scale. Both halves are asserted separately; joining them needs a fixture that opens a seeded card's popup through its click plumbing.
**Ruled v.667 [Jeremy]:** the pill shows the name **as typed** (the lowercase went); a *Conflict* word is an **axis, not a stake** — the picker sets the axis with it, the Add card and the roster never mint it, a misfiled one is offered a conversion on its card.
**⚠ A standing rule this item made concrete:** **a store keyed by element key must join BOTH migrators the day it is written** (`migrateElementKey` and `__dystMigrateKey`), exactly as an index-keyed store must join the seven `__planSection*` paths. v.570 found **eight** stores that had never joined, including `stakeData`, added eight days earlier.
**⚠ And:** anything appended that needs `state` must use the bare identifier — **`window.state` is undefined**, because `state` is a script-scoped `let`. Reaching for it silently stores nothing.

**47 · Conflict axes** ☐
Design doc: `claude/Dystoria_Conflict_Axes_Design.md`. **Depends on #46**, and is **cheaper than that doc assumes**: the `stakes` category's **Conflict** subcategory already ships the ten axis words, so the *declared* half needs no new dropdown and no seventh narrative layer. The *derived* half stays as designed: `axisOf()` reads the threat's element category, and **bearer === threat means against themselves**. One field (`data.conflict`), one function, no new store.
**⚠ Do not build the three-lane strip until #46 has been in use for a while** — its quality is entirely hostage to whether writers actually fill in threats, and that cannot be known yet. _And the doc's own guard: **the picture lives in Plan, the finding lives in Checks. Plan may not have opinions.**_

**48 · Places — Map ⇄ Scene, and the boundaries between them** ☐
Design doc: `claude/Dystoria_Places_Design.md`. **Supersedes #27.** Plan's fourth tab becomes **Places**, two views under one toggle. The observation the whole item rests on: **today's map is per-section and holds the cast present in that section — that is a scene board, mislabelled since it shipped.** So today's maps *become* the Scene view with no migration, and **Map view is net-new and section-free**, keeping it clear of the `__planSection*` hooks. Then **zones**: a drawn shape plus a label, membership derived from geometry, where the label may be an element (the Forest's extent) or a free pill (*Off-stage · At Stake · Internal Thoughts*) — which is what turns a scene board from a floor plan into a stage.
**Phase 0 is independent and has the best ratio:** retire the map's small Edit dialog into the element card [Jeremy, 2026-09-01], which also closes a known drift path — `applyElemEdit` leaving the library record's `libKey` stale and spawning a duplicate orphan. Its precondition is that the card learns the icon; **its hard part is the appearance-scope control (*this section / forward / all*)**, which is section-flavoured and must survive the move. _v.642 walked part of the way already: the Context pencil now opens the element's card._
_Two unknowns to settle before phase 2, neither of which fell out of the obvious greps: **where a word's position is stored**, and **where map drawings live** (`inkPages` is the notepad's handwriting, not the map)._
**⚠ Already true and worth knowing:** the section-free Map view **exists** (v.619 maps, `state.placesView === 'maps'`), and v.646 had to teach the bubbles about it. **Anything section-scoped that reads `state.frameIdx` is wrong on a map** — ask `libSurfaceWord()`, the app's own which-board-is-this.

**49 · Drama — dramatic situations, built from parts** ◐
Design doc: `claude/Dystoria_Drama_Design.md`. **Depends on #46 phase 1b.** A card of six slots with a pool behind each — **who wants · what they want · what opposes · what is in the way · what is at risk · the axis** — where naming someone who does not exist mints them through the ordinary creator. **[Jeremy] No menu of situations:** they emerge from the combinations, and Polti's 36 become a mirror the card holds up afterward rather than a list it opens with.
**The card stores keys and nothing else** — `{who, against, third, stakeKey, note}` — and reads `want`, `obstacles`, `axis`, `bearer` and `threat` live from the elements, so there is nothing to keep in sync and it cannot drift. **Its edits land on the element they belong to**, not on a copy.
**[Jeremy] The Stake is the apex**, and this is the idea that pays for the item: a thread or arc pointing at a Stake is saying **the prose is attempting to address that dramatic situation** — which gives #46's cascade a meaning it never had, and is **the hinge between configuration and sequence**, two halves of the app with nothing connecting them. Gap & Chekhov gains *a Drama nothing points at*.
**Phase 0 ✓ v.565–566, v.572 — the Drive section.** [Jeremy] _"the whole Drive as a separate section from the traits… Motivations, Obstacles, Stakes, with the ability to add more than one of each."_ Wants and stakes are lists now (`motWants`/`motStakes` normalise; writers mirror `[0]` into `m.want`/`m.stake`, so no reader changed). **`set` replaces and `add` appends** — the notepad's ✎ means "change", and one writer doing both would turn every edit affordance into an add.
**Left in this area:** the **motivator** (`motivation.motivator` + its connector word) is not in the Drive section — a fourth part of the same object, and Jeremy named three. And **`addObstacleElement(i, j)`** still takes two section indices, so Drive adds obstacles as words only.
**⚠ One genuine gap to author:** `motivation.obstacles[]` is a free list with no vocabulary — eight families proposed in §3.1. **Recognition (phase 4) needs the BONDS graph** and must not be built until there are real dramas to test it on.
_**v.566's duplication is still owed:** `buildMotivationSentence` and the npCard's own copy are 60 intricate lines each and both emit the same DOM. Collapsing them is the real fix; v.579 is a way to not make it worse._

**50 · Events that move — the causal chain** ☐
Design doc: `claude/Dystoria_Events_Design.md`. **Split out of #46 on 2026-09-02** [Jeremy: _"let's leave events as the causal chain system, its own element"_] — and **NOT merged into Drama**: an Event is a point in a **sequence**, a Drama is a **configuration**; Dystoria has always had sequences and never had configurations, and merging them collapses the distinction #49 exists to add. The relationship is that **a Drama produces Events**.
`cat:'event'` is a first-class element with **nothing inside it**. Three section-free stores keyed by element key — `eventShift` (`from`→`to`), `eventLinks` (`causes`/`enables`), `eventKnown` (who acted · was there · heard later, with **who still does not know DERIVED**). **The causal chain's payoff is a validator, not a diagram:** an event whose cause appears later in the book than its effect is a deterministic Gap & Chekhov finding, ordered live from `sectionMapElements(section)` so it stores no index.
_**Schedulable whenever: it depends on nothing.**_ **The UI rule is the whole risk:** nobody fills a six-field form — show **one field across every event** on the importer's existing card-deck mechanism, never one event with every field.

**53 · Shape, colour and line on the Bonds map** ◐
Design doc: `claude/Dystoria_Bonds_Node_Style_Design.md`, plus a published specimen page.
**The finding that shaped the item: three of the four channels were already taken.** Node colour was the element category; edge colour is valence; edge width AND opacity are intensity; a dashed edge means **secret**; the arrowhead is direction. **Shape carried nothing at all.** **The hinge: give the category to the SHAPE, and the colour is freed to be the writer's** — nothing stops being said, the category is said louder in a channel that survives any size, greyscale and `body.eink`.
**Shipped: phases 1, 2 and 4.** Silhouettes per cast and `border()` asking the node for its outline (v.583); the category palette adopted as defaults (v.583); the **curve** (v.587, extended to every line at v.593 — the elbow is the one exception, on meaning: a cladogram's square corners say *these two descend from the same point*); the **face and hub** rule (v.588, threshold corrected v.589); the **branch** (v.590); and the **wrap** so a rank may be more than one line (v.592).
**⚠ WHAT IS LEFT IS PHASE 3 — the per-element style picker**, `state.session.elStyle[<key>]`, **joining both key migrators AND #18's fork list on the day it is written** — and the **dash and colour overrides**, which have nowhere to live until it exists. **Dash offers `5 4` reserved for secret. Colour is offered as an override that ANNOUNCES itself** in the tooltip (*"colour set by you; warm · intensity 3"*), and note the sixteen pre-built `bnArrow<ci>_<wi>` markers become per-edge markers minted on demand, which is the real cost. **Width and arrowhead are not offered — they are stored facts wearing a costume.**
**The general rule: a style control may override a DERIVED value if it announces the override, and may never override a STORED fact.**
**⚑ Ruling [Jeremy] — what the two levels are FOR:** _"At one level, the standards are there so that the author doesn't have to do too much redesign, but the ability to change the pills and lines per element gives that extra little bit of exploration."_ **The defaults are the product.** A writer who never opens a picker must get a map that already reads — so phases 1–2 had to stand up with **no picker at all**, and the picker must never become a step: nothing may be un-styled, nothing may nag, and a story with no overrides is a finished story. _Phase 4 shipped whole under the same rule._
**⚑ And [Jeremy]: "node style is just visual, no facts."** The writer's override is presentation only: nothing may read it, it never enters `storyFacts`, and no Check may derive a finding from it. _One consequence worth stating before it is discovered: with the category on the shape, a writer who changes one node's shape has made that node stop announcing its category. That is allowed — which is why the **defaults** carry the signal and **nothing downstream may ever infer a category from a silhouette**._

**54 · Speech and thought bubbles** ◐
Design doc: `claude/Dystoria_Speech_Bubbles_Design.md`. [Jeremy, with a mockup] _"add speech and thought bubbles above the selected characters on the map and in scenes. You should be able to add one of each to start off with, but later be able to add more and cycle through them intuitively."_
**⚑ The whole item turned on one storage choice, and it was already made for us.** A bubble is section-scoped by nature, which normally means joining the **seven** `__planSection*` paths — the most error-prone commitment in this file. **`npNotes` is the one store immune by construction**: `_orgSectionKeyInfo`'s catch-all `^section:(\d+)([\s\S]*)$` rebuilds any tail, so `section:4||TRAIT||SAY:0:<elKey>` is swept by every insert, delete, merge, split and all three reorders **with no new code in any of them**. That is the difference between a weekend and a migration.
**Phases 1 and 2 SHIPPED (v.607–v.611)**, which this file previously did not say: one of each, stored as a list from day one; then many, with a **stacked stepper and dot row per side** — speech and thought are two voices, not one sequence, so each plate walks its own list and neither knows where the other stands. **Which line you are on is view state** (`BUB_AT` on `state`, never on `state.session`): a per-viewer cursor has no business in a file that syncs, forks and exports.
**Scene-scoping enforced ✓ v.646** [Jeremy: _"speech and thought bubbles stick to the scene"_]. The store always believed it; the DRAWING did not ask — `bubDraw` took `state.frameIdx` unconditionally, which keeps its value on a **map**, so every map drew the last scene's dialogue and the control there would have written into it. `bubSceneNow()` answers *which scene this board is, or null*, through `libSurfaceWord()`.
**Left — phase 3:** the **double-game finding** (a character with both a speech and a thought in one section is playing a double game — a deterministic Gap & Chekhov finding, **never a Plan opinion, and no AI: a line of dialogue is something the writer asserts**), and **whether the pair reaches the manuscript export.**
**⚑ Why it is a drama feature and not an ornament** — the mockup says it: _"I may be thinking something that contradicts what I am saying."_ Dystoria can hold what a character wants, what blocks them and what is at risk, and had **nowhere to hold what they are saying while they want it**. The gap between the two lines is the scene. It also gives #49 a surface it lacks: a Drama **as performed**, at one moment, by one person.
**Still open for Jeremy:** visible when unselected, in a smaller form? Beings only, or can a Group speak with one voice? Does the pair belong in the export? _(Answered: **a bubble belongs to the SCENE**, not the character — 2026-09-07.)_

---

## What Bonds left open (no longer roadmap items; pick up if they bite)

**A party is now a group ELEMENT** (v.559–v.560), read into Bonds through `sourced()` as a `type:'social'` group, keeping v.410's property: **read, never copied**. **⚠ v.645 retired the minting** — a group is no longer given an element or carried onto every active section, per #55 phase 3; `dystSyncParties()` still reconciles the name and `partyOf` of an element that already exists, and still removes an orphan it made. **`DYSTGROUPS.partyOf` is the seam** if the party record ever moves out of `state.session.beingGroups`.

_**One trap it exposed, and it will recur: `source.kind` had exactly two values ever.** Three places said "chart, else concept map" — the group button's tooltip, its provenance glyph and the delete confirm — so a third kind arrives described to the writer as a concept map. **Anything new that adds a `source.kind` must grep for the other two.**_

**A saved arrangement is a fourth per-slot bag** (v.561): `saved[slot] = {pos, view, n, at}` beside `layouts`, `hide` and `views`, keyed the same way (group × lens). **Anything new that sweeps those bags must sweep this one** — `dropGroup` and `__dystMigrateKey` are the two that exist today. _Save reads the PICTURE off the DOM and settles the drawing first, because a drag does not re-render; storing the uncorrected picture would mean Restore never matched Save. The fixed point is that both passes are idempotent on a compliant arrangement — `tests/arrangement.js` asserts it rather than trusting it._

**Two of the five relationship stores are READ-ONLY since v.601.** The group-chart and concept-map **editors** are retired — the Organize dialog opens the group on the Bonds map instead, and `openGroupTree` / `openConceptMap` redirect there rather than 404ing. **Their data is untouched and still read.** _Nothing was migrated and nothing needs to be — Bonds has read both stores since v.397._

**No mark on the Map for standing bonds** (decided v.413). A page can only show what is on it.

**The relationship card can be revived** (deleted v.414) — the source is in git history. _So can `firstSetOffer` (deleted v.428)._

**Still open from the v.417 audit: whether a group needs its own time dimension.** _#55 phase 2 (v.647) answers it for MEMBERSHIP — membership is timeless, change is an arc — but a group's own existence over time is a separate question and this one is still open._

**Three things to watch.** `lensCount()` builds a graph per applicable lens per render. The group row is a flat list — **no type filter since v.428** — so fifty groups would leave the search as the only instrument. And **`TYPE_CAST` must gain an entry whenever `SET_CATS` does**; so must `STRUCT_USE` whenever `BONDS.KINDS` does, and `MINI` whenever a new **layout** appears. **A kind with no example silently shows a card with no picture, and since v.428 the creation step is the only place the kinds are named.**

**One cosmetic thing left standing.** When a pair has both a Map link and a member-chart edge, both are drawn. _Since v.478 the two are pushed apart rather than overlapping, so it reads as a duplicate rather than as one thick line — more honest, still not right._

**And the relaxation is a shape, not a solution.** `relaxWeb` guarantees no line rests across a pill and that every bond has room for its word; it does **not** eliminate edge CROSSINGS, which are unavoidable in a general graph and legible as long as nothing is occluded. If crossings ever become the complaint, that is a different algorithm and a much bigger one.

## What Arcs left open (#25 audit)

**`arcRunAI` reads its own last answer.** It feeds `storyFacts()` into the prompt, and `storyFacts()` emits each arc's *previous* `aiPct` and `completeAt`. **Should be cut regardless of #25.**

**The `@arcdim:` and `@arcfacet:` notes are a statement of INTENT and must not reach `arcRunAI`.**

**`renderPlot()` is a full teardown and `scheduleReplot()` runs it twice per call** — and an arc column's header calls `arcMomentum()` once per render, which walks every section's prose. **The first thing to memoise if the grid feels heavy.**

**The notepad's Plot and Thread rails mirror the grid's first column and assume it is a thread.**

**The `col.id === 'main'` branches are still in the source.** `plotColumns()` cannot produce them. **They look like precedent and are not.**

**`arcOpenInNotepad()` is a third route to an arc's writing**, alongside the arc card's box and v.424's notes section. All three edit the same note — **if one retires, check the other two first.**

**The arc's beats are ONE list — `arc.goalposts` — and OPTIONAL and EMPTY BY DEFAULT since v.502** (`arc.scale` is dead data). A row is `{ id, key, label, hint, note, land, sec }`; a loaded structure contributes keyed rows and sets `arc.arcType`; the writer's own rows are keyed `g_<id>`; every `persist()` mirrors keyed rows into `arc.beats[key]`. **Read `arc.goalposts` for anything the writer sees; read `arc.beats` only where the game bridge and the AI beat pass always have** — both still work because of the mirror, not because they are the source. **Nothing ever fills the list unasked** (Jeremy: "it should be empty").

---

## Patterns worth reusing

**The findability pass.** Revise's Find & Replace is the template — but **reuse the instrument, not the rules**. _Two instruments: **highlight ranges** decorate text you cannot copy; **the `#rfOverlay` clone** replaces the page with a disposable copy. Rules from the harder one: swap atomically and key repaints on what is finished; two features writing the same property are fighting, so set `Highlight.priority`; a Range whose text node is replaced **collapses rather than breaking**; read once and cache by the text; and **strip capability from the clone at the point of cloning**, because `innerHTML` carries `contenteditable` across with it._

**The relationship systems — read this before touching anything relational.** **Five stores:** map links (`state.prompt.links`, per-section, **array indices**), the webs overlay, member charts (`data.groupTrees`), concept maps, and **standing bonds** (`state.session.bonds`, keyed by element key, no section). **`window.relInverse` is the one inverse table**; **`BONDS.graph()` is the one read model** over all five; **`BONDSVIEW` is the one canvas**; **`wikiRelations()` is the one function that prints a character's relationships**. Survey in `claude/Dystoria_Bonds_Design.md` §1.

_**Ten standing traps:** `relPool`/`relSubFor` take indices into the CURRENT SECTION · `BONDS.graph()` builds every edge from a whitelist · `Parent of` and `Child of` are one fact from two ends · everything a view prints must come from the fact it is drawing · direction lives on the SIDE, not in `e.type` · a standing bond has no `sections` · a layout must rank by relation, not by section · **a lens is filtered by the CAST, never by the group's type** · **`peerBetween(g,a,b)` does NOT test peer-ness** (it returns true for ANY edge between two nodes — `levelPair()` is the real peer test, and `symmetricRel(word)` is the single predicate behind both the arrow and the level-row rule) · and **`DOWN`/`UP` were the layout's PRIVATE copy of the inverse table and had drifted from it**, which cost five builds: `UP` is derived from `DOWN` through `relInverse` at load now, and **anything that reads a relation word needs both faces of it.**_

**The Bonds PICTURE — nine invariants, all display-only, none writing to the position store.**

1. **A bond whose word is asymmetric carries an arrow, pointing from `headFrom`** — decided by `symmetricRel`, never by which aspect happens to be filled.
2. **No three elements share a height, and a shared height must be a peer run** — `deRow`, segmenting each row at the `levelPair` boundaries and staggering the SEGMENTS. The step comes from `NH`, never from a live measurement.
3. **A peer run of 3+ draws as a chain, with one label carrying the count** — the view may choose what to draw but not what to hide.
4. **Spacing is chosen for the words and the CAMERA absorbs the size.** **Never reintroduce a fit-to-width squeeze: it is what strips bonds of the room their labels need.**
5. **A label sits on its own line and nobody else's** — `place` costs candidates against the pills, the other labels AND every other edge.
6. **No line comes to rest across an element** — `relaxWeb` for the web, `unblock` everywhere, applied in `V.render` as well as `autoLayout`. On a RANKED layout `unblock` may only move an element **sideways**: rank is meaning there.
7. **A chart is arranged from the bonds it DRAWS, and everything else goes on a shelf** — **nothing is hidden**; a shelved element is dimmed to `.42`, not removed, and is on no line, which is why `deRow` and `unblock` skip the shelf.
8. **A source, a word and a face shared by two or more bonds draw as ONE branch** — automatic, **because a fork asserts something the separate lines do not**: one act with several objects. The whole fork is abandoned if trunk or limb fails `pathClear`, because half a branch reads as a missing bond.
9. **A rank may be more than one line, and the target is a picture as wide as it is tall** — a rank too wide wraps, each line centred on the same axis; the target is `sqrt(total run × row step)`, floored by the natural height so a genuinely deep tree is never squeezed sideways.

_Two things that will break it silently. **`autoLayout` also draws the group-creation miniatures**, so anything done to it changes those pictures too. And **`V.render` merges `stored[key] || auto[key]`**: a rule placed inside `autoLayout` reaches only maps nobody has ever opened. **That mistake was made three times in five builds; if a layout fix "works" and the report repeats, check this first.**_

**The Plot grid's columns — read before adding a kind.** `data.plotCols` is a list of `{kind, id}`; **`COL_KINDS`** declares what a kind is. Every cell store is keyed `"<colId>|<sectionIdx>"`; column-level data goes to `data.plotDefs[id]`; a fresh card inherits `colKeyEls(col)`. Two kinds: **thread** and **arc**.
_**There are TWO column lists.** `plotColumns()` is every column — for anything that REASONS about the grid. `plotColumnsShown()` applies the filter — for DRAWING only. **A filter that reaches the reasoning side loses a column's content on the next section merge.**_
_**An arc column's id IS the arc id**, which is why anything keyed by column id is already arc-ready and **anything keyed by *thread* is not.**_
_Five rules: the kind is **stored, never read off the id**; `live()` returns TRUE when it cannot tell; an unknown kind is kept as stored and not drawn; `remove` is the kind's own decision; `offer` exists for any kind whose subjects can outlive their column. **And one maker per control that both kinds share** — two copies drift the first time one changes._

**The section systems — read before storing a section index.** Sections are `state.frames`, and **nothing about an index is stable**. **There are SEVEN index-rewriting call sites, not five:** `__planSectionInserted`, `__planSectionDeleted`, `__planSectionMerged`, `__planSectionSplit`, and **three separate hand-rolled reorder implementations** — `reorderSection`, `applyPlotReorder` and `__planSectionReorder`. _That is why "is this store handled?" once had three different answers and one of them was no: `plotCardStakes` was remapped in `reorderSection` alone, so every other path left the card's stake behind on its old index while its note and title moved._ **Anything new that stores a section index must join all seven on the day it is written** — and a single `remapSectionIndices(mapFn, opts)` is what would stop this recurring.

_**And two counterparts.** **`npNotes` keys are safe by construction**: `_orgSectionKeyInfo`'s catch-all `^section:(\d+)([\s\S]*)$` rebuilds any tail, so any key of that shape is swept by all seven with no new code — **that is the shape to copy**, and it is what made #54 cheap. **`elIndexByKey(key)` searches the CURRENT SECTION's words only**, so anything guarding an affordance on `bi>=0` disappears on every section the element is not placed in — **a fact about an element is not a fact about a section.**_

_A section's NAME is `state.frames[i].stageName`, and **`renameSection(i, v)` is its one writer**. `syncSectionTitlesFromEditor()` is the reverse direction, and it treats "Section N", "Prologue" and "Epilogue" as placeholders rather than names._

**⚠ AND THERE ARE TWO KEY-MIGRATION LISTS, which go stale the same way.** Sections have the seven paths; ELEMENT keys have **`migrateElementKey`** (session half) and **`__dystMigrateKey`** (Plan half). **A rename changes `wordKey`, so anything keyed by an element key is index-keyed data's twin.** v.570 found eight stores that had never joined. _When auditing either list, **seed a store the migrator DOES carry as a control** — failures with nothing passing beside them are as likely to be a broken harness as a broken app._

**The three copies of a story — read before writing anything that talks to the cloud.** The **cloud** row holds the full document; the **local** copy is trimmed by `stripHeavyForLocal`; the **open** story in memory is full, restored by `restoreHeavyFromCloud`.
_Four rules: **`_localTrim` means "this copy is incomplete"**; **`_cloudUpdatedAt` is the base a guarded write checks**; **`cloudPull` asks a light question first**, and anything needing the whole library goes and gets it deliberately; and **the sync runs on arrival, never on a timer**. The cost of getting this wrong, measured: **10.14 GB of egress in one month from a 33.53 MB database with four users.**_

**Bundled datasets.** Six plain-text tables, **fetched on demand**, parsed once, cached, with the old heuristic left in place so a failed fetch degrades accuracy and never function — and the UI **says which source it used**. `/data/*` is `immutable`; **a false entry costs more than a missing one**.

**Deterministic core + optional ✦ pass.** The computed half renders on open and costs nothing; beneath it one opt-in button answers what computation cannot. **The deterministic half must stand alone** — and **the gating must never take it**: the star sweep tags containers, so anything that merely *opens* an AI reading is denied and its star tagged instead. _A door may WEAR the star without becoming the feature._

**What each AI surface is grounded on.** `storyFacts()` — the one bounded ground truth — is sent by Refract, Continuity, Craft, the Research sidebar, Explore's `qaGround`, the session-prompt generator and the end-of-session recap. The last two also carry the focus elements and their dossiers, and they frame the facts as **recognition material, never as a checklist**.
_Three rules: **a focus key is resolved through `npFindEl`**, never through the open section's `words` — the shared `_resolveEl` is the only correct reader; **`storyFacts()` announces every cap it applies**, so a truncated block cannot read as a finished story; and **the only way to know what a surface is grounded on is to stub `aiCall` and read the string** — `t_wa.js` is the template._

**The export family.** **.docx is the submission manuscript. PDF and ePub are the book. The Plot grid's .xls writes what the grid is showing.** All three take a FILTERED root: `partExportChoices()` says what a part can be, `storyPartRoot(secs)` assembles it, `exportStoryPart(choice, fmt)` hands it on.
_Three rules, each about honesty rather than format. **"Appears in" is two different questions**: a thread or arc happens where its column has a CARD; a character appears where they are **on the map OR named in the prose** — map-only loses a character present and unnamed, prose-only loses one named in a section they are not placed in. **The section numbers are never renumbered**, because a filtered manuscript that counts 1, 2, 3 lies about where its parts sit in the book. **And the omitted sections are named in the file itself.**_

**The dialog primitive — read before adding a pop-up.** One card, three sizes, two skins: `--dlg-*` tokens in `<style id="dyst-dialog">`, behaviour in `DystDialog`. A new dialog takes the tokens rather than writing its own radius/shadow/scrim, and opens through `DystDialog.open(...)` — or `DystDialog.adopt(...)` for markup that toggles a `show` class. **Escape is handled once, at document capture, for the TOP dialog only.** **A dialog raised over an open scrim draws none of its own.** `window.__dlgAudit()` lists what is adopted; **`tests/t_dialogs.js` asserts the behaviours and tokens on every dialog** — run it after touching any. **A popover that opens ABOVE a dialog must be adopted too**, or Escape closes the dialog under it. **A popover with no scrim takes the pixels but NOT the stack** — the Tab trap would pull focus out of the editor.
_The skin rule: **chrome is dark in both themes; material is parchment in both; guidance is parchment with a 3px gold rule.** Ember's parchment is `#faf7ef`, ink `#3a3126`, line `rgba(120,92,40,.22)`, gold `#b9822e` — every Ember material card is listed in the v.499 block, which redefines the palette **on the card**; add a new card's selector there, never a colour by hand. Primaries: ink on parchment, gold on chrome; **gold-on-parchment is reserved for ✦**. On the chrome, type goes a rung up, because light-on-dark reads smaller._

**The `.dyst-fp` picker skin** (tabs · filter · rows · hint) lives in the **static** style block beside `.gb-who-pop`, **not** inside `#bnCSS` — v.643 moved it, because that sheet is only injected when the Bonds panel first renders and the Group builder's member picker was skinless in any session that had not opened Bonds. **Rules a second feature depends on cannot live behind the first feature's render.** _`#npAddMenu` still carries its own hand-copy of the same rules and the two have already drifted (`--gold` vs `--gold-ochre`, 240px vs 252px). Collapse them when one of them next bites._

---

**The mode bars are five hand-copied rows of the same buttons** (the deskbar, plus the heads of Revise, Review, Wiki and the Game board). v.594 is the standing evidence: the `title` sentences had been written into **one** of the five, so hovering a mode outside Plan had never said anything. **They are read off the deskbar now** by an idempotent pass at boot and on every mode change. **Anything else those rows should carry belongs in that same pass, not in five copies.**

**Never run `git` through the device bridge on Jeremy's repo.** Even `git status` refreshes the index and writes `.git/index.lock`; the bridge cannot delete files, so the lock stays and GitHub Desktop refuses the next commit. **It has happened twice.** Read the repo state from the working tree (`grep`, `md5sum`), and if a lock is ever left, `mv .git/index.lock _to_delete/`.

**Game mode ships inside `index.html`, and the build script is where it lives.** The ten `dyst-gamemode-*` blocks are appended by `splice.js` in a fixed order. **Any build that does not run that splice drops the game silently** — which is exactly what happened between v.125 and v.126 — so **a delivery checklist item is `grep -c 'id="dyst-gamemode-' index.html` → 10.** The app's mode buttons do not call `goMode`, so anything that must react to a mode change hooks the buttons, never `goMode` alone. `DystGame._selftest()` (dry, writes nothing) is the compatibility check after any change to the writing system's bridges.

**The ? guide's source of truth is `DYSTORIA_GUIDE` in `index.html`**; `claude/Dystoria_Help_Guide.md` is **exported from it**, stamped with the md5 it came from, because the two had drifted. **Rule: a feature that ships with a new name, tab or control gets its line in the guide the same session.** _And test it the reader's way: the constant sits inside an IIFE and is unreachable from the console, so an assertion presses **?**, presses **Read the full guide**, and reads what came out. A guide that JSON-parses and then throws in `mdLite` is a guide nobody can open._

---

## Vision boundaries (the standing scope check)

The *architecture* is general — but **that does not mean the product should be presented as general.** Domain-neutral in the bones, **sharply fiction-specific on the surface.** **Vocabulary tell:** if generality forces warm words cold, stop and check. **Win the fiction beachhead, then generalize from strength — never launch general.**

**Write is for writing. Revise is for looking.** _A section title is structure, not prose._

**Plan is for structure, and it may not have opinions.** A filter on a list is not a filter on a thing · an ordering is not a filter at all · a default is not a filter either · **when there IS a filter, it filters what is drawn, never what is there — and says so while it is on** · **a filter that narrows by a property already printed on every item is organising information you can already see.**

**Call a thing what the writer called it** — and the writer must be able to give it one from wherever they are standing.

**Say what a choice will do before it is made.** _An explanation generated by the thing it explains cannot drift from it._

**A control belongs beside the thing it acts on** [Jeremy]. _One slot may show two things — a reading at rest, its controls on hover — provided both are built and the swap is a repaint, not a rebuild._

**Bonds is conceptual** [Jeremy]. **Before a surface refuses something, check whether the rule belongs to that surface or to the one its data model came from.**

**A picture has to say which two things a mark belongs to** [Jeremy]. _A bond you cannot see is the fault; keeping a saved position is not worth it._

**Surfaced, never scored against a target** — not satisfied by a disclaimer. _If the plan enters the prompt, the reading becomes a grade._

**When a label carries a judgement, print its definition beside it; print the evidence; and when the app has quietly reordered — or hidden — something, say so.**

**Suggest and never apply.** Strongest form: **where one surface can own the data, the other reads it and there is nothing to propose.**

**Nothing the writer types may land in a copy that gets thrown away.** If a surface is disposable, it must not accept work.

**Fewer things to say makes more things get said** [Jeremy]. _Four siblings are six bonds and one fact — draw the chain, say the count._

**A signal must not average away the thing worth seeing; the view may choose what to draw, but not what to hide.** _And a chart of nothing should not draw a line._

**Never hide the last way into a page; before you delete a page — or a control — check what it was the last way into; and give anything you can open more than one way out.** _Its other form: **check what it was the last place a vocabulary was named.**_

**Let the interface say what kind of thing a surface is before it is opened.**

**Ask the question the writer can answer.**

**Tell the writer where what they just made has gone, and a retired route should answer, not 404.**

**Look at the picture.** The screenshots showed a stolen click target, a family tree reading upward, a general hanging under his own captains, an Arcs page with every arc invisible, a "Betrays" with no arrow on it, an "Ancestor of" rendered as "Ance", **a picker with no styling at all because its stylesheet belonged to another panel** (v.643), and **one pawn wearing a group's name with five people hidden behind it** (v.645). _Its complement: **when the change is a request that no longer happens, count requests.** Its traps: **a photograph taken signed out is a different photograph** · **a picture at 1440px cannot show a control that is off the screen at 1100px** — for reachability the instrument is `elementFromPoint` · **a picture cannot show a hover state you did not actually trigger** · and **a picture taken from an empty fixture is a picture of a code path no user is on.**_

**A door that goes nowhere is worse than no door; a door with nothing behind it yet is still a door; a room with no door at all is worse than both; and a thing with no affordance drawn is a room whose door is invisible.**

**A gesture you cannot predict is worse than one you have to aim** [Jeremy]. _Nothing may move under the pointer as it arrives — hide with `visibility` where the space must be held. And nothing may move on its own between one opening and the next._

**A feature can be drawing something it never let you set; when you remove the surface that WROTE a field, ask who is still drawing it; when a field has no writer, grep for a writer that has no caller; and when you remove the surface that SET a field, the field is dead state.**

**If the app puts a word in a sentence, it has to know how that word reads — and how it POINTS.**

**When you add a second candidate to a record, audit every reader that assumed there was one — and when you add a second version of a LIST, classify every caller first.**

**A z-index only competes inside its own stacking context, and "auto" loses to anything that named a number.**

**A constraint written for one case becomes a refusal in the next; when a helper gains a second caller, re-read its filter — and its NAME — as that caller.**

**Rank by relation, not by position. A stored index into a reorderable list is a reference nobody is maintaining.**

**Filter by what a thing IS, never by what it CALLS ITSELF — and never read what a thing is off its id.**

**A control that OPENS a feature is not that feature — but it may say so.**

**Do not convert what you do not understand into something you do.**

**When a surface retires, its tests move to whatever inherited the risk. And when a RULE changes, the assertion that guarded the old one is RE-AIMED, not deleted.** _Twenty-odd assertions have been re-aimed this way; the practice is what keeps a green suite meaningful across a change of mind._

**Ask for the fields you are going to read, not the row — and make a handler ask which event it got.**

**A query that fails is handled; a query that succeeds differently is not.**

**"The same as X" is only a specification if you can point at X, and only satisfied if the COMPUTED values agree.**

**A control is only as reachable as its worst window.** "Is it visible" is not the same question as "can it be clicked" — and **a listener bound once at boot is the one control that will stop working while its neighbours keep going.**

**A hover that changes the paper must change the ink — and an assertion that has never been seen to fail has not been tested.** _Its cheapest instance: assertions passing on `every([])` because the fixture rendered nothing. **Assert there is something to measure before measuring it.**_

**Fix it on the path the writer is standing on.** A green suite and a repeating report mean the fix is on a branch the session never reaches.

**What a feature is grounded on is the string it sends, not the code around it.** Stub the call and keep the argument.

---

## Lessons that cost a build (newest first)

_These are here because each one was paid for. They are the reason this file is worth reading before touching anything._

**A shared style that only one of its two owners guarantees is not shared; it is borrowed** (v.643). Every `.fp-*` rule the Group builder's member picker needed lived inside the **Bonds** panel's injected stylesheet, under a comment claiming it was in "one place" so both could take it. One place it was — but that sheet is written by an `ensureCSS()` that only runs from Bonds' own render, so the picker was **skinless in any session that had not opened Bonds**, which is most of them. **Open Bonds once and the bug vanishes for the rest of the session**, which is how it survived so long.

**A store's shape is not the same as the drawing asking about it** (v.646). Bubbles were section-keyed from day one — and `bubDraw` was handed `state.frameIdx` unconditionally, which keeps its value on a section-free **map**. Nothing failed; a map simply had a conversation on it that was happening somewhere else. **When a surface becomes section-free, grep for everything that reads `state.frameIdx`.**

**Re-deriving a stored decision MOVES it, which is quieter than voiding it** (v.647). The rule was "old records keep their range" — and saving one from the builder re-derived `from`/`until` from wherever the writer happened to be standing, so a range scoped to section 2 came back scoped to section 1. **A record you are editing should keep what you did not touch.**

**Before you delete a control, check what it was the last way into — and press it, do not read it** (v.642). Hiding the party's explode from the Context row looked safe, because the node ring had one. **It did not, once the party was exploded**: the ring's party controls are built only for a COMBINED party, and above 768px there is no mobile chip — so an already-exploded party would have been stranded with its members scattered. **The harness caught it by pressing the real ring**; an assertion that said "the control stays where it was pressed" turned red.

**A control can be finished in four layers and connected in none** (v.571). The Plot grid's stake pill had builders, CSS, an icon option with both-theme hovers, and two named destinations — **and not one line that put any of it on the page.** Three consequences: **the style passes sweep what is ON SCREEN**, so a container that never rendered was never styled; **a `display:none` on a sub-element silently voids anything written into it**; and **a green assertion on a function proves the function, never its reachability** — the only instrument is instrumenting the suspects and driving the real UI, **with a known-live function as the control.**

**Two copies of a decision will disagree** (v.588, and again at v.641). The word a lens draws, the end it reads from and the arrow are one decision — lifted into one maker when a second reader needed it. And in v.641 the derived-row loop had recomputed its own copy of "which groups get a row" instead of reading the list the header had counted: **it would have disagreed with itself the moment the rule gained its second clause, which it did an hour later.**

**A test whose side effects survive into the next test can pass for the worst possible reason** (RLS phase 2). A **successful** attack removed the row the next probe was supposed to fail to read, so the stranger's read came back empty and scored as a pass. **Undo each write at the moment it is measured — and prove the harness can fail before trusting that it passed.**

**A status line is not a result.** PostgREST returns 204 for a DELETE that removed nothing and for one that removed everything. **If a probe cannot distinguish success from refusal, it is worse than no probe — because it reports a pass.**

**A durability test that never serialises is testing the wrong copy** (v.597). A store riding on an array as non-index properties passed every in-memory assertion and **`JSON.stringify` silently dropped it**. If the claim is "it travels", the assertion has to round-trip.

**A read-time upgrade is the only migration that runs** (v.596). **A migration with a door in front of it is a migration some stories never take.**

**A store that is half-saved by coincidence looks like a store that is saved** (v.596). One column reached the cloud because it happened to route through session data; the rest went to `localStorage` alone. **The half that worked is what made the half that did not invisible.** The instrument is not a grep for the save function — it is **wiping the browser-local keys and asking the app what it still holds.**

**A test that pokes the copy the fix just demoted is testing the old build** (v.596). Seed **before** the app runs (`page.addInitScript`) — that is the state every existing writer's browser is actually in.

**Reaching past the app's own door produces a failure the app does not have** (v.597). **Drive the door a writer presses**, or the harness is testing a state nobody is in.

**A capability nobody reads is a rule dressed up as data** (v.598). Every flag must be read somewhere in the build that introduces it. _Where a flag's reader is not yet reachable through the UI, the harness proves the mechanism directly and **the entry says it is not reachable**, rather than letting a green assertion imply a feature._ **⚠ `KIND_CAPS.scope` became exactly this at v.647** and is marked in the table.

**In a system built on openness, a capability is an offer and never a requirement** (v.598, from Jeremy's rulings). `leader:false` means the app will not ask and will not fall over; it never means a writer may not.

**A maker that dedupes will hand you somebody else's record and look like it worked** (v.598). **A harness that reuses subjects has to clear them between steps.**

**When the writer has already answered the question, do not ask the data to guess it** (v.600). The Kind picker derived its cast by searching the word pools for the chosen word — survivable while every word lives in one pool, wrong the moment they do not.

**A variable fetched and never read is a decision nobody made** (v.600).

**Naming a bucket after the cast it holds is the tell** (v.591, v.599). A bucket with one kind in it is a placeholder wearing a taxonomy's clothes. **The proof a split is owed is usually already in the word pool.**

**A name that was stored is a name you must go on answering to** (v.599). **A rename is free only if the old name still resolves.**

**A new class name has to be checked against the FILE, not against the design** (v.580). `.bn-band` already existed, so every new row rendered on a white slab with padding it never asked for — **every DOM assertion green, and the screenshot is what caught it.** In an 8MB single file, grep the class before you name it. _Its sibling one level up (v.597): **a session field is a name in the same namespace as every other session field.**_

**When the DOM gains a level, every assertion that read `children` is now measuring the wrapper** (v.580, v.582). **Query by class, not by position in the tree.**

**Test what a thing MEANS, not what its glyph looks like** (v.580). Deciding emptiness by comparing text to `'—'` breaks the day the placeholder changes. **Ask the app what it means.**

**A number is not a regression until the previous build disagrees with it** (v.583). **The instrument that settles "is this mine?" is the previous build**, and it is cheap, because the harness already runs against a file path.

**One silhouette, written once** (v.583). **Anything a drawing and a measurement must agree about is one table with two readers.**

**Draw it one way and measure it another and the difference is where the bugs live** (v.588). A pill painted as a stadium and measured as a rectangle was honest across its middle and lying at both ends — **and the lie only showed at the one place a line ever touches it.**

**A rule that can still say no after the alternative was thrown away is not a rule, it is a leak** (v.590). **Decide the whole thing before anything is drawn.**

**A path that is checked and then re-derived is a path nobody has checked** (v.590). The clearance test and the drawn curve must be the **same control points**.

**Not hiding it is not the same as not letting it shape the picture** (v.589).

**Ask the question the drawing is actually asking** (v.589). **A mark answering the adjacent question looks like the right mark and does none of the work.**

**A threshold guessed in round numbers will be wrong at the boundary** (v.589). **Measure the threshold from the things it is about.**

**A change that makes everything visible makes every layout wider** (v.592). **A fix lands where the pressure moved to, not where the code changed.**

**When a report names a state rather than a control, ask which one** (v.593 → v.594). "The hover states no longer show up" cost a whole build spent on the wrong thing. **A build aimed at the wrong half of an ambiguous noun passes all its own tests.**

**An absent affordance is the hardest kind of bug to see** (v.585). A feature that silently declines to render reads as a design decision. **Assert presence, not just correctness.**

**A refusal is rarely alone** (v.584). **When a complaint is about a refusal, walk the whole path the thing has to travel** — offered, stored, drawn, and reachable from the other room.

**A save may only replace the list it was SHOWN** (v.584). **A replace is honest only when the writer saw what it is replacing.**

**Half a bridge is easy to mistake for none** (v.584). **Before designing a link between two things, grep for the one somebody already built.**

**Two lists with the same names are one table that has not been written yet** (v.582). **Declare the structure on the data and have both surfaces read it.** _A hand-kept copy lasts about two versions._

**Anything that must agree with the app is generated from the app** (v.586). **A copy kept in step by discipline is a copy that will be out of step.** _This file is the standing counter-example, and v.647 is what that cost._

**Test content the reader's way, not the parser's** (v.586).

**A sort is a claim the reader has to take on trust** (v.585). **When a rule is loose on purpose, the loose part still has to be visible.**

**An appended layer can only wrap what the app EXPORTED** (v.574). **Check `typeof window.X` before trusting a wrapper**; when there is nothing to wrap, a `MutationObserver` on the node that gets rebuilt is the honest trigger.

**A synchronous flag cannot guard a MutationObserver** (v.574). **The guard is idempotence, not a flag.**

**An AI button has to be safe to press twice** (v.581). **Idempotence is what makes a generate button pressable again**, and it is worth asserting rather than assuming.

**A re-open that means "keep what is on the card" has to keep what the card IS** (v.581).

**When a limitation's stated cause is fixed, re-check the limitation** (v.572). **A confidently-written reason in a comment is a hypothesis, not a finding.**

**When a fix's premise was a symptom, revisit the fix** (v.577).

**Anything that "clears and rebuilds" a compound object throws away every part it does not rebuild** (v.579). It survived seven versions because **the card only showed ONE want**: there was nothing on screen for the loss to contradict. **A shallow view hides a deep bug** — and the way it surfaced was building the fuller view, not auditing the writer.

**Moving a control in the DOM does not move it on the page** (v.577). **Set the neighbour's flex, then MEASURE `getBoundingClientRect()`**; "looks slightly off" is not a diagnosis, and x685 vs x693 is.

**A flex item's own `flex:1` decides where everything after it lands** (v.575).

**Two gaps that must stay equal should be ONE property, not two numbers** (v.580). _Symmetric by construction rather than by arithmetic._

**A rule can reach your element through a word in its class name** (v.572). **Not matching a rule you cannot find beats winning a specificity war with it.**

**Each builder has its OWN class prefix** (v.575). **Read the app's own state rather than guessing at markup, and run the same probe against the previous build before believing a regression.**

**When one pass removes the evidence another pass reads, the second one needs a different question** (v.576). **Two idempotent passes over the same node can still disagree about the state.**

**A control should start where it finishes** (v.576, Jeremy).

**A second editor for facts one surface already draws is the thing to retire, not the data behind it** (v.601).

**A migration with no caller is a migration that never runs** (v.601). **When a function is removed, grep what it CALLED as well as what called it.**

**A store with a mirror has as many readers to fix as it has readers** (v.601). **Grep for the KEY, not for the function's name.**

**A store nobody remembers is a store nobody is remapping** (v.563). **When a rule says "join the list on the day it is written", the list has to be findable; three hand-rolled copies of the same loop is not a list.**

---

_When an item ships: add its entry to `Dystoria_Shipped.md`, **update this file's header line**, and delete the item here if it is closed._
