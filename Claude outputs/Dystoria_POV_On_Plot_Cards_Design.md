# Dystoria — POV on the plot cards

_Design doc. From Jeremy's brainstorm of 2026-09-22 and his answers to §10 the same day.
Status: **phase 1 SHIPPED as v.766** (`2026.07.20.689`, 2026-09-23) — **§13 records how the card surface changed in building and one refinement to §3.2; where §4 and §13 disagree, §13 is what shipped.** Phases 2–5 not started._

> **Revised twice after Jeremy's answers** (2026-09-22, and again the same day on the filter's three
> remaining questions — §12 is now empty). The card carries **one field** — who the viewpoint is —
> rather than a four-field delta; weight is deferred; the narrator gets a visible mark in three
> places; ~~thread cards can each carry their own viewpoint~~ **a viewpoint belongs to the section or scene, shared by every column — §13.1**; the Plot grid gains a real multi-select
> filter; and per-card POV feeds Continuity. Everything cut is listed in §8, not deleted, because
> "start lean and see if we need more later" is a decision about *sequence*, not about what is wrong.

---

## 0 · The one-paragraph version

The book already has a POV — `data.pov` holds person, scope, tense, reliability and narrators, and
composes them into a sentence on the POV row. This adds **one field to each plot card — whose eyes
this one is through — and stores it only when it differs from the book.** A card with no record
inherits and shows the book's POV as a quiet tag; a card with a record is, by construction, **a
departure the author chose to make.** That single rule delivers all three of Jeremy's cases: a
first-person book tags every card identically at zero storage cost; changing one scene *is* the act
of signification, because the data cannot say it any other way; and a multiple-POV book asks every
card whose eyes, because that is the one shape where the book-level answer is deliberately
incomplete. Downstream, the planner, Explore, Checks and Continuity get a viewpoint they currently do
not have, and every viewpoint character gets a mark on the map and in the elements list.

---

## 1 · What already exists

More than you would expect, and **scattered under four names** — which is the first thing this design
has to not make worse.

| name | what it is | where |
|---|---|---|
| `data.pov` | the book's POV record (`state.session.plan.pov`) | `ensurePov()`, `povSentence()` |
| `narration` | the element **category** id — Person · Scope · Reliability · Device | `DYSTORIA_DATA.categories` |
| `Narrator` | a **bucket** on a `being` element (`w.bucket`) | `BUCKET_SETS.being` |
| `POV` | the user-facing label on the rail row | `NARR_LAYER_CATS` |

The book-level record:

```
state.session.plan.pov = {
  person: '' | 'First Person' | 'Second Person' | 'Third Person',
  scope:  '' | 'Limited' | 'Omniscient' | 'Objective' | 'Deep / Close' | 'Multiple POVs',
  tense:  '' | 'Past' | 'Present',
  reliability: '' | 'Reliable' | 'Unreliable',
  narrators: [ elementKey ],   // two-way synced with the Narrator bucket
  note: '', aiDesc: ''
}
```

`povSentence()` composes _"Past tense, third person, limited — narrated by Delphia."_ **Nothing below
the book level exists at all.**

### Three things the survey turned up that change the plan

**1 · The map icon Jeremy wants is already written, and turned off.** In the pawn renderer:

```js
const SHOW_ROLE_ICONS = false;   // roles now live in the notepad (expanded role set) — hide the map icons for now
if (SHOW_ROLE_ICONS){
  addRole(nd.narrator,   'scroll',        'Narrator',        0,  -18);   // directly above the head
  addRole(nd.mainChar,   'star',          'Main Character', -17,  -4);
  addRole(nd.antagonist, 'venetian-mask', 'Antagonist',      17,  -4);
}
```

A **scroll, gold `#fa9a31`, directly above the head** — the exact placement asked for, with its
geometry already decided (`HEAD_Y = -43`, `dy = -18`, `scale 0.52`). It is off because it reads
`nd.narrator`, the **retired** boolean, while roles moved to the notepad. So this is not a new
feature; it is a flag and a repointing. **It must read the live source, not resurrect `nd.narrator`.**

**2 · The Plot grid already has a filter, and a law for how to hide safely.** `#plotFilterBadge` /
`setPlotColFilter()` filter columns to threads-only or arcs-only, and the code carries its own rule:

> _"a **badge on the bar** says when it is on. A filter you cannot see is indistinguishable from
> columns that have gone missing."_

and a second one, `plotFilterWorthIt()`:

> _"Only worth offering when the grid actually holds more than one kind — otherwise every option but
> one empties the page, which is the door-to-nowhere rule again."_

Both apply verbatim to §6. **The standing rule _the view may choose what to draw, but not what to
hide_ is about defaults, not about author-invoked filters** — and this pair is how the app has
already settled the difference. A card filter is a second axis on machinery that exists.

**3 · Three live gaps this feature closes.**
- **The planner never sees POV except by accident.** `context()` names the section, card, plot stage,
  note, elements and neighbours — no person, no narrator, no tense. POV arrives only if
  `storyFacts()` has room left under its 1800-character cap.
- **The Craft review's POV line never reads `data.pov`.** It reports "POV / narration constraints"
  from category words and buckets, so the person, scope and tense the author set are invisible to the
  one review claiming to assess "consistency of the narrating voice". **This is a bug, not a gap.**
- **No POV check.** Continuity's deterministic pre-pass compares exactly one invariant: `sex`.

And one constraint to keep: **the importer cannot propose POV**, by design (v.712 — _the narrative
frame is a statement of the AUTHOR'S INTENT, not a feature of the prose_). Nothing here changes that.

---

## 2 · The observation this is built on

Jeremy's three examples are not three features. They are **one rule seen from three angles**:

> _"first person, singular pov would be easy, and would automatically be added to each card as a POV
> tag."_ → nothing is stored; the tag is the book's, rendered.
>
> _"If the author chooses to change it for one of the scenes, then it would signify something about
> the story getting another perspective."_ → a stored value **is** the signification. There is no
> separate "mark this as a departure" step, because departing is the only reason to store anything.
>
> _"if it's a multiple pov all third person then the author would specify in each plot card who the
> perspective is."_ → the book's scope has declared the per-card answer to be the open one.

So: **a card stores a difference, never a copy.** Inheritance is not an optimisation, it is the
semantics. An empty record and a record that happens to match the book are different facts, and only
the first is representable — which is what makes "this scene is different" legible without a flag, a
colour, or an author remembering to say so.

And the organising principle for the interface:

> **The book's scope decides what the card asks.**

| book-level scope | the card shows | the card asks |
|---|---|---|
| _(unset)_ | nothing | nothing — the POV row invites the book's answer first |
| **First Person**, one narrator | that narrator's name, quiet | nothing, until you depart |
| **Third Person · Limited**, one narrator | that narrator's name, quiet | nothing, until you depart |
| **Third Person · Omniscient** | _"omniscient"_ | **nothing, ever** |
| **Objective** | _"camera"_ | nothing |
| **Second Person** | _"you"_ | nothing, until you depart |
| **Multiple POVs** | the card's viewpoint, or blank | **whose eyes?** — the one shape where the card carries a real question |

The omniscient row is the one that matters most. **Asking "whose eyes is this section?" of an
omniscient story is a category error**, and a design that asks it anyway has misunderstood the mode
it claims to support. The control must be able to have nothing to say.

---

## 3 · The model

### 3.1 The record — one field

```
cardPov = { who: <elementKey> | '' }
```

Stored on the card only when it differs from the book's viewpoint; absent means inherit.

Three laws.

**A card stores only what differs.** Setting a card's viewpoint to the book's own narrator clears the
record rather than writing it. This keeps "is this a departure?" a property of the data rather than a
comparison someone has to remember to run — and it means changing the book's narrator re-tags every
inheriting card for free.

**`who` is an element key, never a name.** It joins the existing `being` elements, survives
`__dystMigrateKey` renames, and is the same currency `data.pov.narrators` already uses.

**A card's `who` does NOT write the `Narrator` bucket.** The bucket means _narrates the book_, and a
character who carries one chapter is not that. **This is exactly where a fifth "who narrates" store
would otherwise be born**, and there are four already.

> **The shape is deliberately forward-compatible.** A record of `{who}` extends to
> `{who, person, scope, tense}` without migrating anything: absent fields already mean *inherit*. So
> the leaner start costs nothing later. §8 lists what is being left out and what it would cost to add.

### 3.2 Where it is stored

The app's own warning about the established per-card pattern: a store keyed `col.id + '|' + i` must
be re-keyed in **seven** separate remap paths when sections move, and `plotCardStakes` is named in
the file's comments as _"v.563's fault by construction"_.

POV does not have to repeat that, because **the section card already has a record that moves with
it**:

```
state.frames[i] = { gap, prompt, stage, stageName, partId?, plotWord?, secType?,  pov? }
```

`pov` on the frame needs **no reindex hook at all** — insert, delete, merge, split and reorder carry
it automatically, as `stageName` and `partId` already do. The one line needed is `keepMeta` on merge,
which already enumerates exactly these fields.

- **Scene cards** → `data.sceneData[colId|sid]`, which exists with `{title, text, els, elNotes,
  stakeNotes}` and is keyed by a stable `sid`, not an index. Add `pov` to `_scnEnsure`'s literal and
  a getter/setter pair. The card's storage router already switches section-vs-scene for stake notes
  (`_stkGet` / `_stkSet`); `_povGet` / `_povSet` go in beside them.
- **Thread and arc cards** → **they carry their own `who` too.** [Jeremy] _"there may be cases where
  a thread is conceptual, tracking a theme for example, and the POV characters are tracked on the
  cards of that Thread."_ That settles the structural question from the first draft, and settles it
  the simplest way: **every card kind can carry a viewpoint, and they all inherit from the book.**
  There is no section→thread or thread→section chain, so there is no rule needed for which wins.

### 3.3 The read

A module matching `window.__conflict`'s shape, so the planner, Checks and the map can reach it from
their own IIFEs:

```
window.__pov = {
  book()             → data.pov
  card(i, col, sid)  → the stored viewpoint, or ''
  resolve(i,col,sid) → { who, person, scope, tense, source:'book'|'card' }
  cast()             → [ {key, name} ]   every viewpoint in the story, first appearance first
  isViewpoint(key)   → bool              // drives the marks in §5
  departures()       → [ {i, col, sid, from, to} ]
  sentence()         → the composed reading
}
```

`cast()` is the union of the book's declared narrators and every character carrying a card, in order
of first appearance. **No counts, no shares, no percentages** — [Jeremy] _"Weight is not important
for now."_ §8 keeps the design for when it is.

**The row shows multiplicity; it never rewrites the author's declaration.** If the book says _Third
Person · Limited_ and a **second** character carries a card, the row says so and offers **"make it
Multiple POVs"** as a one-tap action — at two, not at three [Jeremy]. Two viewpoints is already a
different book from one, and an offer that waits for a third is a diagnosis withheld. It does not quietly change the field. _Structure the manuscript doesn't
state is the author's_ — and a declared scope is exactly a statement.

---

## 4 · How it lives on the plot cards

The card header is already full: scene tabs · **Write about** · **Where next** · **Explore** ·
(Summarize) · kebab. A sixth pill would crowd it and — worse — give a usually-silent control the same
weight as three that always do something. So, two states.

### 4.1 Inherited — a quiet tag, not a pill

In the `.pl-cardpop-sub` line under the title, beside the plot stage, in `--ink-faint`:

```
   Act II · The Descent            ·  Delphia
```

No border, no background, no ✦. It is a fact about the card, rendered. Clicking opens the chooser;
hovering says _"From the book's point of view — click to change it for this section only."_

### 4.2 A departure — it becomes a pill

The moment a card stores a viewpoint, the tag promotes to the header row as a real pill,
`class="pl-cardpop-writeabout pl-cardpop-pov"`, matching the three already there:

```
   [ ◉ Feo ]   [ Write about ]   [ ✦ Where next ]   [ ✧ Explore ]   ⋯
```

with a tooltip naming what changed: _"This section is through Feo — the book is Delphia's. Click to
change or clear."_

**That asymmetry is the whole design in the interface.** Inheriting is quiet because it is the norm;
departing is loud because it is a decision — and Jeremy's own framing is that a change "would signify
something about the story getting another perspective". The interface should agree.

### 4.3 On the collapsed grid cell

A collapsed card shows the viewpoint character's first name in the corner **only where the story has
more than one viewpoint** (`cast().length > 1`). A single-POV book gets nothing: a label repeated on
forty cards is noise, not information. This is `plotFilterWorthIt()`'s rule applied to a label.

### 4.4 The chooser

A small popover, and its contents are decided by §2's table. In the lean version it holds one thing:

- **Whose eyes** — a searchable list of `being` elements: the book's declared narrators first, then
  everyone on this card's own element list, then the rest. (The Stakes Builder's picker, v.761, is
  the pattern — it already has a search box and offers groups.)
- **Clear** — returns the card to inheriting. One tap, present whenever anything is set.

---

## 5 · The narrator mark

[Jeremy] _"In the map and elements list, the Narrator or Narrators when they are characters should be
listed in the Narrative layers POV section, and have a simple icon beside their name in the
Characters section. On the map, the little icon could be above the head."_

**One icon, one source, three placements.** The source is `__pov.isViewpoint(key)` — the union in
`cast()` — so a character marked here is one the reader actually sees through, whether that is
declared at book level or earned by carrying cards.

| where | what |
|---|---|
| **The POV row** (Narrative Layers) | the viewpoint characters as pills, beside the composed sentence |
| **The Characters list** (elements) | a small scroll glyph before the name, at `--ink-faint` weight |
| **The map** | the gold scroll above the pawn's head — `addRole(…, 'scroll', 'Narrator', 0, -18)` |

**The map icon is a flag and a repointing, not a build.** `SHOW_ROLE_ICONS` goes true, and
`addRole`'s first argument changes from the retired `nd.narrator` boolean to
`__pov.isViewpoint(wordKey(nd))`. The other two role icons — Main Character and Antagonist — **stay
off.** They were turned off together for a stated reason ("roles now live in the notepad"), and that
reason still holds for them; the narrator is different because it is the one role that answers *whose
eyes am I reading through*, which is a fact about the page rather than a label about the person.

> **Watch this one on a crowded map.** Three role icons in an arc around a head is what was turned
> off; one icon above one head is a different proposition, but only a photograph will say whether it
> reads as a mark or as clutter at the density a real story reaches. If it crowds, the fallback is
> the elements list and the POV row alone — both of which are unambiguous wins.

---

## 6 · The Plot grid filter — moved

**Now its own doc: `Dystoria_Plot_Grid_Filter_Design.md`** (split out 2026-09-23, building as v.765).
It filters the grid by any element linked to a card, AND only, hiding what does not match; POV is one
group in its list, not its point.

What this doc owes it: once phase 1 lands and cards carry a viewpoint, the filter gains a
**Viewpoint** group (that doc, §6). Nothing else here depends on it, and it depends on nothing here.

---

## 7 · What it feeds

### 7.1 The Where Next planner

POV joins the `pre` array — the block that already carries the author's standing instruction for the
whole book, which the module's own comment calls _"how the book is told"_. POV is precisely that:

```
HOW THIS BOOK IS TOLD: Past tense, third person, limited — narrated by Delphia.
THIS SECTION'S VIEWPOINT: Feo.  (The book is Delphia's; this section departs.)
Offers must be things FEO can see, hear, infer or feel. Nothing may be offered that
he is not present for, and nothing from inside another character's head.
```

That last sentence is the part that changes the output, and it is only truthful when a viewpoint is
known — so it is emitted **only for limited and close scopes**, never for omniscient or objective.

**No POV lens.** The lens list says what a step is *made of*; POV constrains every step rather than
being a material one step can be built from.

### 7.2 Explore

The vocabulary exists — `QC_NARR` carries `['narration','POV','point of view']` and
`qaCatNoun.narration = 'point of view'`. What is missing is the *card's* viewpoint: opening Explore
from a card should carry the resolved viewpoint into the focus line.

### 7.3 The perspective check

A fourth entry in `CHECKS`, `id:'perspective'` — _"Perspective — sections that read against the point
of view they are set in."_ Two passes, in the app's established order.

**Deterministic first, and cheap.** Pronoun density per section against the resolved person:

- a section resolved **third** whose prose carries first-person singular pronouns outside dialogue
- a section resolved **first** that never uses one
- a section resolved **first · limited** reporting another character's interiority in the telltale
  forms — _"she realised", "he had never told anyone", "they wondered"_

**Then the opt-in ✦ pass**, for the one a regex cannot see: **head-hopping inside a limited scene** —
the paragraph that slips from Feo's head into Delphia's and back. That is a real, common,
hard-to-self-spot fault, and the best single argument for this whole feature.

Findings are pinned as notes beside the passage and **never applied**, like every other check. And
the rule that keeps this from becoming a grade: **the check reports the mismatch; it never changes
the card.** If §7 was written in first person on purpose and the card says third, the fix might be
the card, not the prose, and only the author knows which.

### 7.4 Continuity — yes, as an invariant

[Jeremy, answering §10.7] _"yes."_

`INVARIANT` today is `{sex:1}`. Per-card POV adds a second, and — usefully — **half of it is
deterministic**, because the app already knows who is on a section's map:

- **Deterministic:** the card's viewpoint character is **not among `sectionMapElements(i)`**. A
  section told through someone who is not in it is either a mistake or a missing map placement, and
  either way it is worth saying. Runs with AI off.
- **The ✦ pass:** the section reports something the viewpoint character could not have witnessed or
  known. This is the case Jeremy named, and it needs a model.

Phrased as observations, in the register Continuity already uses.

### 7.5 The Craft review's POV line — fix it while we are here

It reads `guideEls('narration')` plus buckets and never touches `data.pov`. A few lines, in the
feature that already claims to assess the narrating voice, and currently cannot see the author's own
answer.

---

## 8 · Deliberately not now, and what it would cost

Everything here was in the first draft and is deferred rather than rejected. The record shape in
§3.1 means none of it needs a migration.

| deferred | why | cost to add later |
|---|---|---|
| **Per-card person, scope, tense** | [Jeremy] lean first. Covers a third-person book with one first-person chapter, and a present-tense flashback. | three more fields in the record; three more rows in the chooser behind _"…also change how it's told"_ |
| **Relative weight on the pills** | [Jeremy] "leave that derivation for later" | `cast()` gains `cards` and `words`; the pills gain a number. Note the two measures disagree, sometimes sharply — a character with many short sections is a different book from one with three long ones, and showing only one number hides that |
| **The viewpoint strip in Plan** | the most attractive part and the least necessary; **a picture of who-narrates-what will be read as a verdict on whether the balance is right** | a lane per viewpoint, a column per section — the Conflict strip's renderer, with its warnings |
| **"Deep / Close" as a distance dial** | [Jeremy] "not sure" — and it is the one scope value with no word-pool entry and no `WORD_DESC` | leave `POV_SCOPE` alone until there is a reason |
| **Per-card reliability** | a property of the telling, not a section. The one case that wants it — a reliable frame around an unreliable account — is better said by two viewpoints | — |

And the standing exclusions:

- **No fifth "who narrates" store.** A card's `who` does not write the `Narrator` bucket, does not
  touch `w.storyRole`, and does not resurrect `w.narrator`.
- **No copying the book's POV onto every card.**
- **No silent rewriting of the declared scope.**
- **No POV inferred from prose into the data.** A check may report; it may not set.
- **No POV lens in the planner.** Constraints and materials are different things.
- **No balance meter, no coverage percentage.**
- **Nothing asked of an omniscient story.**
- **Main Character and Antagonist map icons stay off.** §5.

---

## 9 · Phases

**Phase 1 — the field and the tag. ✓ SHIPPED v.766.** `pov` on the frame and the scene record, `resolve()`, the
`window.__pov` module, ~~the quiet sub-line tag, the departure pill~~ **the POV pill on the POV · Stakes line (§13.2)**,
the chooser. The POV row unchanged.

**Phase 2 — the marks. ✓ SHIPPED v.768 (§14).** The viewpoint pills on the POV row, the glyph in the Characters list, the
map icon (flag + repointing). Cheap, visible, and the part most likely to make the feature feel real.

**Phase 3 — the Viewpoint group in the grid filter. ✓ SHIPPED v.769 (§15).** The filter itself is its own feature
(`Dystoria_Plot_Grid_Filter_Design.md`, v.765). This phase only adds the Viewpoint group to its list.

**Phase 4 — the planner, Explore, and the Craft review fix. ✓ SHIPPED v.770 (§16).** The `pre` line and the limited-scope
constraint; the viewpoint in Explore's focus line; `data.pov` finally reaching the craft metrics.

**Phase 5 — the checks.** The deterministic perspective pass and the deterministic Continuity pass
first and **alone**; the two ✦ passes only once the deterministic ones have been used on a real draft
and their false-positive rate is known.

---

## 10 · How it gets verified

- **A story with no POV set draws nothing anywhere** — no tag, no pill, no icon, no empty state that
  reads as a reproach. The feature's resting state is invisible.
- **A first-person book with no departures stores nothing.** Check the plan record: `pov` absent on
  every frame. If inheriting writes data, the central rule is broken.
- **Section surgery leaves every card's viewpoint on its own card.** Insert, delete, **merge**, split,
  reorder. This is the claim that justifies the frame over a `col|i` map, so it is the one to test
  hardest — and merge is where `keepMeta` has to have learned the new field.
- **Renaming a viewpoint character through `__dystMigrateKey` keeps every card pointing at them.**
- **An omniscient story never shows a "whose eyes" control**, on any card kind.
- **Setting a card's viewpoint to the book's own narrator clears it** rather than storing a copy.
- **The map icon reads the live source.** Set a viewpoint on one card only; that character gets the
  scroll. Nothing sets `nd.narrator`.
- **The grid filter's own checks live in its doc** (§7 there).
- **Look at the picture.** Two photographs the harness cannot replace: the map at real element
  density with the scroll icons on, and a grid of forty cards with the viewpoint labels on. The
  question for both is whether it reads as *information* or as *clutter*.
- **`window.__aigateReport()`** for the two ✦ passes in phase 5.

---

## 11 · Risks worth naming

**In a multi-POV book this is a question on every card, and questions are friction.** Forty sections
means forty little decisions before the planner is any better than it was. Mitigations: the chooser
offers the characters already on that card first, so the common case is one tap; and a blank card
must degrade gracefully — the planner omits the viewpoint line rather than the card feeling
unfinished. **Do not put a completeness marker on an unset card.** That is the easiest way to make
this feature hated.

**"Departure" is a loaded word and the pill may read as an error.** The gold border that says
*decision* on a stake card may say *warning* here, on a card doing something perfectly deliberate.
Worth trying: the viewpoint character's own element colour instead of gold.

**The deterministic pronoun check will fire on first-person dialogue in a third-person book**, which
is most third-person books. It **must** exclude quoted speech — and even then letters, epistolary
inserts and remembered speech will trip it. If the false-positive rate is bad enough that a writer
turns the check off once, it is off forever. **Phase 5's deterministic pass ships alone and gets
measured before the ✦ pass is built on it.**

**The map icon was turned off once already.** Not for the same reason, and not as one icon rather
than three — but a feature that was tried and hidden deserves more suspicion than a new one, and the
photograph in §10 is the test, not the reasoning.

**Value is hostage to adoption the way #47's was to #46's.** If writers never set the book's POV,
`resolve()` returns empty forever and all of this draws nothing. That is an acceptable failure mode
— it fails to empty, not to wrong — but **phases 2 and 3 should not be built until phase 1 has been
used on a real draft.**

**Scope creep toward a "voice" feature.** Distance, diction, filter words, free indirect style: all
adjacent, all tempting, none of them what was asked for. The line: POV is **who the camera is on and
what grammatical person it uses.** How it *sounds* belongs to the Craft review, which already has a
Prose & voice dimension.

---

## 12 · Settled

Nothing in this doc is waiting on an answer. The three questions that were open on the first pass
were closed the same day:

- **The filter is AND throughout and multi-select throughout**, over any linked element, with POV
  as one of its groups (§6). Two viewpoints ANDing to nothing is answered by the empty state, not
  prevented by the picker.
- **The filter hides rather than dims**, matching the column filter already on the bar (§6).
- **The "make it Multiple POVs" offer appears at the second viewpoint**, not the third (§3.3).

The grid filter was lifted into its own doc on 2026-09-23 and is being built first.

What otherwise remains uncertain is not a decision but a measurement, and both are named where they
belong:
**the map icon at real element density** and **the deterministic pronoun check's false-positive
rate** (§10, §11). Neither can be settled by argument, and neither should be built past its first
phase until it has been looked at.

---

## 13 · What building phase 1 found (v.766)

### 13.1 · A viewpoint belongs to the section or the scene, not the column (refines §3.2)

Every grid card is one section **in one column**, but a section's frame is shared by every column and a scene
is a mark in the prose, shared too. So the viewpoint is stored on what is shared:

```
section → state.frames[i].pov = { who }     rides with the frame through insert / move / split / merge
scene   → data.scenePov[sid]  = { who }     keyed by the scene mark's stable sid
chain   → book → section → scene
```

Every column's card for §4 shows §4's viewpoint and can change it — Jeremy's *"having the ability to change the
POV on the cards is still important"* holds on every card — and two cards for the same chapter can never disagree
about whose eyes it is in. Per-column storage would have been exactly the `col|i` map the file warns about, with
seven remap paths to keep true. On the frame it moves for free; merge takes the keeper's, split gives both halves
the same eyes, the grid's undo covers it, and a rename follows it. **A conceptual thread that needs its own eyes**
(§10 answer 4) is the case this gives up; it is noted, not built, and the scene-level override covers most of it.

**In a Multiple-POVs book a chosen viewpoint is not a departure** — there is nothing to depart from — so it stays
plain rather than gold. Forty gold pills would say nothing.

### 13.2 · The card surface, as Jeremy reshaped it from screenshots

Built first as §4 designed it (a quiet tag in the sub line, a gold pill beside Write when it departs), then moved
five times in the same build:

1. *"put the POV into the linked elements instead of the top bar … the first pill after the general notes with
   the eye icon. that way you can select the pov CHARACTER to make notes"*
2. *"or maybe having the Eye icon larger on the card in the top row allows you to change to POV"* — the pill
   splits by where you click: **name** selects, **eye** opens the chooser.
3. *"don't make the POV pill full width, make it a normal pill size"*
4. *"Put POV as a title to the left of Stakes, with the pill and then Stakes."* (and *"make the Stakes pill regular
   size as well"*)
5. *"remove the general and have the POV act as the general notes, make it default selected. Then in the line
   where you add linked elements. Have the title 'In Scene' and change +link element to a simple +add element"*

**What shipped:** `POV [👁 Hansel] · STAKES [⚑ …]` on one line; `IN SCENE [elements…] + add element` below. The POV
pill **is the card's general-notes tab**, selected on open; the eye opens the chooser. Where the book names no pair
of eyes the tab keeps its place without an eye — *Omniscient*, *Objective*, or *Notes · General* when no POV is set.
Step 1's "select the POV character to make notes" went with step 5: a linked viewpoint character keeps her own pill
under In Scene for notes on her. A departure is gold (`#6b5415`); the grid names viewpoints only once there are two,
and the grid's eye opens the same chooser without opening the card.

### 13.3 · Finds

- **Renames left every plot card behind** (pre-existing). `plotElems`, `plotThreadElems` and `sceneData[*].els` kept
  a re-keyed element's old key while its stored label kept the card looking right. `__dystMigrateKey` now follows
  them, plus `fr.pov`, `scenePov` and the v.765 `plotCardFilter`.
- **`.pl-povpill` was already the Narrative layers' POV row class** (`flex:1 1 100%`) — the card pill is `.pl-cpov`.
- **`#sky svg{width:100%;height:100%}`** outranks class rules on any SVG in the plan view.
- The bar badges' `#8a6d1e` measured 4.2:1 on the pill's own wash; the pill uses `#6b5415`.

### 13.4 · Phase 3 note

The grid filter's Viewpoint group (phase 3) can read `window.__pov.resolve(i, col, sid)` per scene and
`window.__pov.cast()` for its list; a card's viewpoint is the union of its section's and its scenes' — the same
union rule the filter already applies to linked elements.

### 13.5 · v.767 — the inert eye

[Jeremy] *"When the book has no single pair of eyes, can we keep the eye but just not have it open a chooser. And can
we have the notes for the card that used to be General be Notes · POV · [eye]."* Every card's notes tab now wears
the eye. In an omniscient or objective book, and in one with no POV set, it is **inert** — no button role, no hover
ring, and a click on it is a click on the tab. A book with no POV set reads **Notes · 👁 POV** (it read *Notes ·
General*). Whether the eye is a door is decided by the book, not built into the tab: give the same story a narrator
and the same eye opens the chooser (t767 #6).

---

## 14 · What building phase 2 found (v.768)

- **The mark is the eye, not the scroll.** §5 chose the scroll before the plot card had an eye; once the POV pill
  carried one, a second symbol for the same fact would have been two languages. The Characters list, the POV row and
  the map all use the card's eye.
- **One source, memoised:** `__pov.viewpoints()` → `{ key: { name, book, n } }` — the book's named narrator(s), plus
  everyone a section or any of its scenes resolves to, with how many sections are theirs. The map asks once per pawn
  per render, so it is held for 300ms and dropped whenever a card's viewpoint is set (which also repaints the rail).
  `isViewpoint` now reads it. In an omniscient/objective/unset book a card's stored viewpoint is ignored, so it marks
  nobody but a named narrator.
- **POV row:** a pill per viewpoint under the composed sentence — the book's narrator first (gold edge), then the
  others with their section count; a click opens the character's card.
- **Map:** `addRole(isViewpoint, 'eye', …)` above the head; Main Character and Antagonist stay off. The retired
  scroll's offset (-18) was set for the taller pawn — on the woodcut figure it floated ~20px clear, so the eye sits
  at -10. **Still to be looked at on a crowded map** (§5's warning stands).
- **Test lesson:** `parity` run three-way in parallel gave three different signatures (one a different story
  entirely); run sequentially it was byte-identical. Run parity one at a time.

---

## 15 · What building phase 3 found (v.769)

- **Keyed `pov:<character>`**, never the bare element key: *"Gretel's eyes"* and *"Gretel appears"* are different
  questions, and ANDing them is the point. Rows read *Gretel's eyes*, with the card's eye; the badge says so too.
- **A card carries every pair of eyes in it** — its section's resolved viewpoint plus each scene's (the filter's
  union rule). A Hansel section with one Gretel scene answers to both.
- **Only a card that holds something carries a viewpoint.** Every cell of a Hansel book resolves to Hansel; filtering
  by his eyes would otherwise turn up empty "add a card" slots.
- **The group appears only with two or more viewpoints** (one would match every card). Stale entries are pruned like
  any other key; a rename follows `pov:` entries in `plotCardFilter`; setting a viewpoint repaints the badge.
- Same build, [Jeremy]: **✦ Summarize moved from the card header to the bottom-right of the note**, in the element
  card's ✦ Enrich dress, shown only while the POV (general-notes) tab is selected — the note it writes into.

---

## 16 · What building phase 4 found (v.770)

- **One brief, three readers.** `__pov.brief(i, col, sid)` / `briefText` — *HOW THIS BOOK IS TOLD* (the author's own
  composed sentence), *THIS SECTION'S / SCENE'S VIEWPOINT* (with "the book is X's; this section departs from it" or
  "one of the book's viewpoints"), and the bound. The planner, Explore and anything later say it the same way.
- **The bound is emitted only where it is true** — a limited, close, first-person or multiple-viewpoint telling with a
  known viewpoint, or a departure. An omniscient book is told the telling *may enter any character's mind*; an
  objective one, *a camera, never inside anyone's head*. A model obeys a false instruction faithfully.
- **Planner (§7.1):** the brief sits with the book's standing instruction at the head of the prompt, before the story
  material and the path. No POV lens.
- **Explore (§7.2):** the card passes its brief through `window.__qaEntryPov`; `openExplore` takes it once and clears
  it, so Explore opened from anywhere else never inherits a card's eyes. Both the set and single-element prompts carry
  it as *POINT OF VIEW OF THIS CARD*.
- **Craft review (§7.5):** `structuralMetrics` adds *Point of view (the author's own)* and either *Viewpoint by
  section* (Multiple POVs) or *Sections told through other eyes than the book's* (with scene departures); the system
  prompt measures "consistency of the narrating voice" against them.
