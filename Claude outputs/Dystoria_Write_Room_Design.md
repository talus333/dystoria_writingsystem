# Dystoria — The Writing Room (Write-mode comfort, keys and questions)

_Design doc · 2026-09-17 (rulings added the same day, §11) · Roadmap **#69** · written against `index.html` `APP_VERSION 2026.07.20.641` (v.718, md5 `724ad0da…`)._

[Jeremy] _"Here are some ideas to improve the write mode of the app to make it a more comfortable place to hang out."_ Twelve ideas: a shortcuts drawer, a new click-selection model, paired quotes and brackets, keyboard text size, headers as structure, keyboard ink brightness and colour, a two-tone gutter, a matching drawer tab, a questions-only Refract with a right sidebar, and smaller type with a scale bar.

**The short version:** all twelve fit, and most are cheaper than they sound, because the app already has most of the parts: section titles (`#editor h3`), scene breaks (`.scene-mark`), Refract (`refractPhrase`, in Revise), the feedback voices (`FEEDBACK_VOICES`), the story facts (`storyFacts()`), the goal (`goalContext()`) and the Highlight-range instrument from Find & Replace. **Four need changes before they're built**, and each is explained below:

1. **Super+H can't be used.** macOS takes ⌘H to hide the app before the page ever sees it, and Windows takes the Super key itself.
2. **"Super+Shift+>" is the same keystroke as "Super+>".** On a keyboard you already need Shift to type `>`, so the two can't be told apart.
3. **A single click that selects a word would make typing replace it.** Click a word to fix one letter, and the first key you press wipes the whole word. The fix is a *soft target* (§3).
4. **Refract already exists, in Revise, with a different output.** The Write version is the same tool with a new output — questions only. [Jeremy] It keeps the name **Refract** for now (§7).

---

## 0. What the source says today

| Thing | Where it lives now | What it means for this item |
|---|---|---|
| Write text size | `body.writing.insession #editor{font-size:22px; line-height:1.9; max-width:880px}` | Revise is **19px** (`#editBody`). The gap Jeremy noticed is real: 22 vs 19. |
| Phone size | `body.mobile-min.writing.insession #editor{font-size:19px}` | Already matches Revise. Nothing to change on phones. |
| Living Page | `lpOn*`, `data-lphid`, `lpDimSoon` | **Also sets the text size itself.** The scale bar has to agree with it (§1). |
| Section title | `#editor h3` (Cormorant SC 26px, centred), named by `renameSection()` | "Main header = new Section" means **creating a section**, which goes through `__planSectionSplit`, one of the **seven** index-rewriting paths. |
| Scene break | `.scene-mark`, a non-editable centred divider | "Smaller header = new scene" already has a home. |
| Session blocks | `.session-start` (+ `.lk` when locked), `.sess-focus` gutter button | The two-tone gutter keys off these. |
| Context drawer | `#focusPanel` + `#focusTab` (fixed **left**, vertical tab) | The "Context" Jeremy wants on the right is currently here. |
| Keyboard | ⌘Z/⌘Y, ⌘F, ⌘S only | Nothing else is bound, so the new keys don't collide with anything in the app. |
| Refract | `refractPhrase(rng)` → `#rfxModal`; returns `carrying / words / angles / underplayed`; grounded on `storyFacts()` + `snippetAround()` | Revise-only, one paragraph max, modal. |
| Explore questions | `wk-q` "Questions the story raises" (goal-first, then per-element, remembers open questions in `state.session.elementQuestions`) | This is the question style Jeremy means by "like in explore". |
| Voices | `FEEDBACK_VOICES` + `feedbackSys()` + `voicePickerHTML()`; `localStorage['dystoria.feedbackVoice']` | Reuse as-is. The memory note already said: *"if a new review surface is added, reuse `feedbackSys()` + `voicePickerHTML()`."* |

---

## 1. Text size and view zoom — match Revise, then zoom the view

**Two separate things** [Jeremy, 2026-09-17: _"the size slider should be more of a zoom than something that affects the actual text size… it should scale up all the different text sizes relatively, as a view."_]:

1. **The base size is fixed:** in-session prose goes from 22px to **19px**, matching Revise (`#editBody`). This is a one-time CSS change, not a setting.
2. **The slider is a view zoom.** It enlarges the whole page proportionally — prose, section titles (`h3`, 26px), scene breaks (`.scene-mark`, 26px), the section diamond, the session markers in the gutter and the column width — the way a magnifier would. **It never changes the text's own formatting:** nothing is written into the prose, the manuscript and exports are unaffected, and a heading stays exactly 26/19 × the body size at every zoom level.

**How it's built — CSS `zoom` on the page column, not a font-size variable.** This matters because of what's already in the prose: the toolbar's **Size** menu (`#edSize` → `edFmt('size')`) writes **fixed inline pixel sizes** (14 / 18.5 / 24 / 32px) into the text. A font-size variable or `em` units would scale the body but leave those spans at their fixed size, so the relative sizes would drift apart as you zoomed. `zoom` scales everything inside the column, inline pixels included, so every size stays in proportion.
- Applied to the writing column (`#editor` in a session, `#editBody` in Revise), **not** to the header, drawers or dialogs, so the controls stay where they are.
- **One value: `--dy-view-zoom`**, default **100%**, range **70–180%**, steps of 10%. It's stored per viewer at `localStorage['dystoria.viewZoom']`. It's a display preference, so it doesn't go in `state.session` (the same reason `BUB_AT` doesn't). **Write and Revise share it**, so a passage looks the same size when you switch modes.
- **⚠ Check pointer maths under zoom.** Current Chrome and Safari (and Firefox 126+) report positions correctly inside a zoomed element, but the soft target (`caretPositionFromPoint`, §3), the Highlight ranges, the gutter `.sess-focus` buttons and any `getBoundingClientRect`-positioned popover (the Refract card, §7) must be tested at 70% and 180%. **If a browser gets this wrong, the fallback** is converting the editor's CSS sizes to `em` and making `edFmt('size')` write `em` (14/19 → `.74em`, etc.), with a one-time conversion for existing spans when a story loads. That's more work, which is why `zoom` is tried first.

**Controls:**
- **The zoom bar:** a small slider in the full-screen header (`#fsHeader`, next to `#fsToggles`), with **− · slider · +** and the zoom shown as a percentage. Clicking the number resets it to 100%. The same bar appears in Revise's header.
- **⌘+ / ⌘−** (Ctrl on Windows/Linux) step 10% and flash _"View 110%"_; **⌘0 resets it.** These keys normally zoom the whole browser, so the handler calls `preventDefault()` **only while Write or Revise is showing prose**. Everywhere else, browser zoom works as usual. The two zooms stack, which is expected.
- **Scroll position is kept:** when you zoom, the paragraph at the caret stays where it was on screen.

**Living Page is switched off for this push** [Jeremy, §11]: its text growth and its fading of earlier text are **turned off, not deleted**. The toggle is hidden and `lpOn*` is not called. _When Living Page comes back, it should change the zoom, not the text size, so both features work the same way._

**E-ink** keeps its own base size (22px) and uses the same zoom bar.

## 2. Ink — brightness and colour from the keyboard

**Reaction: good, with two guardrails.** Every option has to stay readable on the charcoal background, and every change has to say what it did.

- **Brightness:** five steps of the ink colour, from dim to bright (about 55% → 96% lightness). **Every step is checked at ≥ 4.5:1 contrast** against the writing background, and a test asserts this so a later palette change can't quietly break it.
- **Colour:** a short fixed list of tints: **Parchment** (the default), **Amber**, **Ash** (cool grey), **Sage**, **Rose** — approved as the starting five [Jeremy]. Each one is built at all five brightness steps, so the two controls don't interfere with each other.
- **Keys.** The first keystroke below is what Jeremy asked for. The second changes because `>` already needs Shift:
  - **⌘< / ⌘>** (which you type as ⌘⇧, and ⌘⇧.) → dimmer / brighter.
  - **⌘⌥< / ⌘⌥>** → previous / next colour. _(This replaces "Super+Shift+>", which can't be told apart from ⌘>.)_
- Each change flashes _"Ink · Amber · 4 of 5"_ in the same spot as the size read-out.
- Stored per viewer at `dystoria.inkTone` / `dystoria.inkStep`. **Write only.** Revise stays parchment, because it's for reading and suggestion colours depend on that background.
- **E-ink ignores both settings.** Its whole point is black on white.

## 3. Clicking — the soft target

**Reaction: the idea is right — make the word under the pointer the thing the keys act on — but it can't be a real selection.** In an editable page, a real selection is replaced by the next key you type. So "click a word to fix a typo" would delete the word. That breaks the rule that nothing the writer does should throw away their work without warning.

**The fix: a single click does two things.** It places the caret exactly where you clicked, as it does today, **and** it lights up the word under the pointer as a **soft target**. The highlight is drawn with the CSS Highlight API — the same tool Find & Replace uses — so it never changes the text.

| Gesture | Result |
|---|---|
| **Click on a word** | Caret where you clicked, plus a soft target on that word (a faint gold underlay). Typing just types; the target clears when you type or move the caret with the arrow keys. Formatting shortcuts (§4) and Questions (§7) act on the target. |
| **Click in the space between words** | Caret only, **no target.** (Jeremy's rule.) The test is whether the click lands on whitespace or a word character, using `caretPositionFromPoint`. |
| **Double-click** | Selects the **sentence** — **on by default** [Jeremy]. This is a real selection. A sentence ends at `. ! ? …` plus any closing quotes or brackets; common abbreviations (Mr., Dr., St., e.g.) don't count as endings. |
| **Triple-click** | Selects the **paragraph** (the block). It's a real selection, set explicitly so every browser behaves the same. |
| **Click the session's gutter marker** | Selects the **whole session block**. This is how Questions can work on "the entire session" without adding a fourth click. |

Double-clicking normally selects one word, so this changes a habit. The shortcuts drawer (§4) will say so plainly, and **Settings → Writing → "Click selects: word target / classic"** lets anyone switch back to normal browser behaviour. **Phones keep native touch selection**; the soft target is for mouse and trackpad only.

## 4. Keys — the shortcuts drawer and the full list

**Reaction: yes. The drawer is what makes the other ideas findable** — a shortcut you can't discover might as well not exist. It lists every key, and each row is also a button, so a mouse user can do the same thing without learning the key.

**What the keys act on, in order:** the real selection if there is one → otherwise the soft target → otherwise the current paragraph.

| Action | Mac | Windows / Linux | Note |
|---|---|---|---|
| Open / close this drawer | ⌘/ | Ctrl+/ | |
| Bold · Italic · Underline | ⌘B · ⌘I · ⌘U | Ctrl+B/I/U | Uses the app's existing `edFmt`. |
| New **Section** (main header) | ⌘⌥1 | Ctrl+Alt+1 | ⌘H can't work (see the top of this doc). Also: type `# ` at the start of a line. |
| New **Scene** (smaller header) | ⌘⌥2 | Ctrl+Alt+2 | Also: type `## ` at the start of a line. |
| View zoom | ⌘+ / ⌘− / ⌘0 | Ctrl+ / Ctrl− / Ctrl+0 | §1 — scales the view, not the text |
| Ink brightness | ⌘< / ⌘> | Ctrl+< / Ctrl+> | §2 |
| Ink colour | ⌘⌥< / ⌘⌥> | Ctrl+Alt+< / > | §2 |
| Refract the target | ⌘⌥R | Ctrl+Alt+R | §7 (✦). Plain ⌘R reloads the page, so it can't be used. |
| Toggle the right sidebar | ⌘⌥] | Ctrl+Alt+] | §6 |

**"Super" means ⌘ on a Mac and Ctrl everywhere else.** Browsers never pass the Windows key to a web page.

**Headers are structure, not formatting.** The Write/Revise rule is that a section title is structure, not prose, so these shortcuts don't make big text:
- **New Section** splits the section at the caret. The text after the caret becomes a new section, and its title (`h3`, named through `renameSection`) is focused so you can type the name straight away. **This must go through `__planSectionSplit`** so all seven index-rewriting paths — the plot cards, stakes, bubbles and the rest — follow the split. It's the only part of this item that touches section indexes. There is **no "undo into one section"** shortcut; merging stays in Organize.
- **New Scene** inserts an ordinary `.scene-mark` at the caret. Nothing is re-indexed.
- `# ` / `## ` are only recognised at the very start of an empty line, and **pressing Backspace right away turns them back into the typed characters**.

**Paired characters.** Typing an opening character inserts its closing partner and puts the caret between them.
- Pairs: `" → “”` · `( )` · `[ ]` · `{ }` · `« »` (for French). Quotes are inserted as the curly quotes the app already uses when it tidies text (`flowSettle`), so the tidy step has nothing to fix afterward.
- **With a selection or soft target, the pair wraps it** instead of replacing it.
- **Typing the closing character right before an identical one just steps over it.** Pressing **Backspace** straight after the pair was inserted removes both.
- **Single quotes are only paired after a space or at the start of a line.** Otherwise every _don't_ and _Mara's_ would sprout a stray closing quote.
- Pairing is skipped while an input method is composing text (`isComposing`) and during dictation, so neither gets extra characters.
- Setting: **Writing → Pair quotes & brackets** (on by default).

**The drawer** sits on the right and is the **Keys** tab of the right sidebar (§6), so there's one drawer and one tab colour. Its rows are grouped **Select · Shape · Look · Ask**, and it ends with one line about the click change.

## 5. Two tones — the gutter and the tab

**Reaction: yes, and it helps the page make sense.** Where you're writing is one tone, and everything else is a slightly lighter tone.

- **The block you're writing in** keeps the writing charcoal. **Every other `.session-start` block and the gutter strip** are one small step lighter, about +4% lightness: a new `--dy-room-2` next to `--dy-room-1`. Only the background changes; the text stays the same.
- **The drawer tab uses `--dy-room-1`** — the writing tone, not the chrome tone — so it reads as part of the page with a hairline edge. With the gutter on the lighter tone, the screen has **exactly two background tones.**
- **Living Page's dimming is off for this push** [Jeremy]. It's turned off, not deleted (§1), so the two background tones are the only way the page separates the current block from the rest. This settles the open question in roadmap #68.
- Both themes get the tones (Ember is a little warmer). E-ink gets neither.

## 6. The right sidebar — Context · Questions · Keys

**Reaction: one sidebar on the right with three tabs** is better than three separate drawers.

- **Context** — the session's focus elements, goals and guides. **Today these are in the left `#focusPanel`.** Moving them means following the rule "before you delete a control, check what it was the last way into": the left panel is also where **+ Add element**, **Start**, the goal and the images are reached. **Ruled [Jeremy]: the whole left panel moves to the right as the Context tab**, and `#focusTab` is retired. The test harness checks that every one of those controls can still be clicked (`elementFromPoint`) at 1100px wide, and the old tab's click handler opens the right-hand drawer rather than doing nothing. Until phase 4 ships, the left panel stays where it is.
- **Questions** — the questions you've pinned (§7).
- **Keys** — the drawer from §4.
- The sidebar can be opened, hidden or collapsed to its tabs, and remembers its open tab per viewer. It's **hidden on phones** (≤500px), where the minimal mode already decides what's shown.

## 7. Questions — Refract for Write mode

**Reaction: this is the strongest idea on the list, and it fits Dystoria's approach: the app points, it doesn't rewrite.** Refract in Revise already returns no replacement sentences. The Write version goes further and returns **only questions**, which fits the rule that Write is for writing. Nothing it produces can end up in the manuscript.

**What it's called.** [Jeremy] **Just "Refract"** for now — _"until I feel it out, the name can stay the same."_ The menu and the card both say **Refract**; the sidebar tab that holds pinned questions is **Questions**. In code it's `refractQ*` / `feature:'refract-q'` so it doesn't collide with Revise's `refractPhrase`.

**Input (the scope):** the real selection or soft target — a **word, sentence, paragraph, or the whole session** (from the gutter marker, §3). Unlike Revise's Refract, there's **no one-paragraph limit**, because questions don't get worse with longer input the way rewrites do. Long input is shortened with a note saying so.

**What the prompt is built from:** the same "stub `aiCall` and read the string" test (`t_wa.js`) checks that each of these is actually sent:
1. **The passage**, plus the prose around it in the section (`snippetAround(rng)`, widened to the section for a whole-session scope).
2. **The Context elements' story facts** — `storyFacts()`, narrowed to the session's focus elements through `npFindEl` (the shared `_resolveEl`), including their dossiers.
3. **The writer's goal** — `goalContext()`.
4. **The narrative layers and Drive** that apply to those elements (wants, obstacles, stakes).
5. **The voice** — `feedbackSys()` for the selected `FEEDBACK_VOICES` entry, with `voicePickerHTML()` chips shown in the panel. It's the same voice setting the session review uses, so there's one setting, not two.
6. **What's missing — worked out in code, not by the AI.** Before the call, the app checks which Context elements and which of their stored facts are **not mentioned** in the passage or its section, using `elTextHit()` with aliases. That list goes into the prompt as _"present in Context, absent from this passage."_ **The model is told what's missing; it isn't allowed to decide what's missing.** This keeps its "why isn't X here?" questions accurate.

**Output:** **exactly three questions**, as JSON: `{questions:[{q, kind:'passage'|'goal'|'absent', about?:elementKey}]}`. Guardrails, added to `FEEDBACK_COMMON`: questions only, never an answer, never a sentence you could paste in, never a score; nothing invented beyond the facts provided; an "absent" question has to name an element from the missing list. The voice changes the tone, not the rules — a Serious Editor asks sharper questions, but they're still questions.

**Where the questions appear:** a small card next to the target (not a modal — Write mode shouldn't be interrupted by a dialog). It shows the three questions, the voice chips, **↻ three more**, and a **Pin** button on each question. Pinned questions go to the right sidebar's **Questions** tab, where each one has **✓ answered · ✎ to Notepad · ×**.

**How pinned questions are stored:** in `npNotes` under `section:<i>||WQ:<id>`. This is the key format that the seven index paths **already carry along automatically** (the #54 trick), so pinning adds no migration work. Each record is `{q, kind, about, voice, scope, at, answered}`. `about` is an element key, so **this store must be added to both key migrators (`migrateElementKey`, `__dystMigrateKey`) on the day it's written**, and to #18's fork list.

**Access and cost:** it's an AI feature, so it wears the ✦, and `__aigateReport()` has to list it. **With AI off, it doesn't disappear** — the "what's missing" check still runs on its own and shows up to three plain prompts (_"The Lighthouse is in Context but not on this page yet."_). That's the no-AI part of the "code first, optional ✦ AI" pattern. It counts against the AI cap under `feature:'refract-q'`.

**Pinned questions in Revise** [Jeremy]: a pinned question can be **sent to Revise as a note**. It appears as an ordinary anchored note on the passage it was asked about (the same anchored-note path Refract's "Keep both" and the Review tools already use), labelled _Refract · <voice>_. The Write copy is marked **sent**, not removed. Sending is an action, not a sync: editing the note in Revise doesn't change the pinned question, and the passage's anchor follows Revise's existing rules.

**Relationship to Explore:** Explore's "Questions the story raises" works on the **whole story**. This works on **the passage you're in**. The two can share a prompt style but keep separate lists: `elementQuestions` stays Explore's, and pinned questions belong to the section.

---

## 8. Build order

| Phase | What | Risk | Mostly |
|---|---|---|---|
| **1 · The room** | **Living Page off (hidden, not deleted)** · §1 base 19px + **view zoom** (CSS `zoom` on the column, shared by Write and Revise, bar, ⌘± / ⌘0) · §5 two tones + tab colour · §2 ink brightness and colour | Low | CSS and a key handler. Visible from the first session. |
| **2 · The keys** | §4 key handler + Keys drawer (a first version of the right sidebar) · paired characters · `#`/`##` and ⌘⌥1/2 (Section **through `__planSectionSplit`**) | Medium: the section split | One keydown handler for the writing session. |
| **3 · The pointer** | §3 soft target, sentence double-click, paragraph triple-click, gutter-marker session selection, the classic-mode setting | Medium: habits and edge cases | Highlight API plus a sentence splitter. |
| **4 · The questions** | §7 Refract (questions) · §6 the full right sidebar (Context moved from the left, Questions tab) · send a pinned question to Revise as a note | Medium: moving Context | AI prompt + the "missing" check + storage in `npNotes`. |

Phases 1–3 can ship without AI. Phase 4 depends on phase 3's targets (a real selection works without it, but the "whole session" scope needs the gutter-marker selection).

## 9. How each phase gets checked

- **Size and zoom:** at 100%, in-session `#editor` prose computes to the same 19px as `#editBody`. **At 150%, every size in the column scales by exactly 1.5 relative to the others** — body, `h3`, `.scene-mark`, and a span set to *Huge* through the Size menu — and **the saved HTML is byte-identical before and after zooming** (zoom writes nothing). The soft target, highlights, gutter buttons and the Refract card land on the right word at 70% and 180%. ⌘+ calls `preventDefault` **only** while prose is showing. With Living Page off, typing speed never changes the size and earlier blocks never fade, and a story saved with Living Page on opens with it off.
- **Ink:** every tint × step clears **≥ 4.5:1** against `--dy-room-1` (an automated check that has been seen to fail at least once).
- **Clicks:** clicking a word and then typing a letter leaves the word **intact, plus the letter**. That's the data-loss check, and the most important assertion in this item. Clicking whitespace creates no target. Double-click selects exactly one sentence, including `Mr. Hale said "Go." Then…`. Triple-click selects the block.
- **Keys:** ⌘⌥1 splits the section, and a stake, a plot card and a bubble seeded in the second half **move with it** (checked against a store the split is already known to carry). `## ` + Backspace brings back the typed characters. `don't` gets no paired quote. A selection is wrapped, not replaced.
- **Refract:** a pinned question sent to Revise shows up there as a note on the right passage, and the Write copy reads *sent*. The prompt string contains the passage, the facts, the goal, the voice and the missing list. An "absent" question names an element on that list. With AI off, the card still shows the plain prompts. After a section insert, pinned questions stay with their section.
- **Photos** at 1440 and 1100 wide, in Ember and Classic, with the sidebar open and closed. **Take them with the hover and target states actually triggered.**
- **Help guide:** every key and every new control gets its line in `DYSTORIA_GUIDE` in the same session it ships.

## 10. Still open

- Should Living Page come back once the groundwork is done, and in what form? That's for after this push; nothing here removes it.
- Whether Refract in Write keeps its name after you've used it for a while.

## 11. Rulings — Jeremy, 2026-09-17

0. **The slider is a view zoom, not a text size** — it scales every size in the page proportionally and changes nothing in the text itself (§1).

1. **Living Page:** its text growth and its fading of earlier text are **turned off for this push — not deleted, just not a feature until the groundwork is done.** (Settles roadmap #68's open question for now.)
2. **Name:** the Write tool is **just "Refract"** for now.
3. **Context:** the left Context panel **moves to the right, into the drawer.**
4. **Double-click selects a sentence by default.**
5. **Ink colours:** Parchment · Amber · Ash · Sage · Rose are the starting five.
6. **Pinned questions can be added to Revise as notes.**
