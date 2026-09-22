# Dystoria — POV on the plot cards

_Design doc. From Jeremy's brainstorm of 2026-09-22: "I would like the POV to play a larger role in
the Plot cards … putting that there can help guide the Explore and Where next planning tool. It would
also help guide the Checks for consistency." Status: **design only** (not built). Current app version
**v.764**, `2026.07.20.687`._

---

## 0 · The one-paragraph version

The book already has a POV — `data.pov` holds person, scope, tense, reliability and narrators, and
composes them into a sentence on the POV row. This adds a **per-card layer underneath it that stores
nothing unless it differs.** A card with no record inherits the book's POV and shows it as a quiet
tag; a card with a record is, by construction, **a departure the author chose to make**. That single
rule delivers all three of Jeremy's cases for free: a first-person book tags every card identically
at zero storage cost; changing one scene *is* the act of signification, because the data cannot say
it any other way; and a multiple-POV book asks every card whose eyes, because that is the one shape
where the book-level answer is deliberately incomplete. The POV row then becomes a **read** of the
cards — weighted pills, counted, never typed — exactly as the Conflict row is a read of the stakes.
Downstream, the planner, Explore and a new consistency check get a POV line they currently do not
have.

---

## 1 · What already exists

More than you would expect, and **scattered under four different names** — which is the first thing
this design has to not make worse.

| name | what it is | where |
|---|---|---|
| `data.pov` | the book's POV record (`state.session.plan.pov`) | `ensurePov()`, `povSentence()` |
| `narration` | the element **category** id — Person · Scope · Reliability · Device | `DYSTORIA_DATA.categories` |
| `Narrator` | a **bucket** on a `being` element (`w.bucket`) | `BUCKET_SETS.being` |
| `POV` | the user-facing label on the rail row | `NARR_LAYER_CATS` |

**The book-level record, in full:**

```
state.session.plan.pov = {
  person:      '' | 'First Person' | 'Second Person' | 'Third Person',
  scope:       '' | 'Limited' | 'Omniscient' | 'Objective' | 'Deep / Close' | 'Multiple POVs',
  tense:       '' | 'Past' | 'Present',
  reliability: '' | 'Reliable' | 'Unreliable',
  narrators:   [ elementKey ],   // being elements, two-way synced with the Narrator bucket
  note: '', aiDesc: ''
}
```

`povSentence()` composes that into _"Past tense, third person, limited — narrated by Delphia."_ and
the row shows it. The card is good. **Nothing below the book level exists at all.**

Also already there, and load-bearing for this design:

- **`povNarratorList()`** unions `p.narrators` with every being bucketed `Narrator`, and the card's
  `+ narrator` writes both — so the two stores are genuinely kept in step.
- **`window.__dystLayerFacts()`** emits `Point of view — <sentence>` as one of six layer lines. This
  is **the only path by which POV reaches any AI surface in the app**, and it arrives inside
  `storyFacts()`, capped at 1800–2600 characters, competing with elements, threads and arcs for room.
- **The wiki already ranks Narrator and Protagonist to the top of the character list** — "an
  ordering, and never a filter". That is the right instinct and the right precedent.
- **`_LAYER_NOTEPH.pov`** — _"Voice, distance, what the narrator knows or hides…"_ — is the app's own
  statement of what belongs in this territory.

### What is missing, precisely

1. **No `window.__pov` module.** POV has no equivalent of `window.__conflict` or
   `window.__stakeData`. Everything is private to the plan IIFE.
2. **The planner never sees POV except by accident.** `context()` in `dyst-wherepath-js` names the
   section, the card, its plot stage, its note, its elements and its neighbours — and no person, no
   narrator, no tense. POV arrives only if `storyFacts()` has room left.
3. **No POV check.** The three Checks are Gap & Chekhov, Continuity and Grammar. Continuity's
   deterministic pre-pass compares exactly one invariant: `sex`.
4. **The Craft review's POV line ignores `data.pov` entirely.** It reads the `narration` category
   words and the `Narrator` bucket, so the person, scope, tense and reliability the author actually
   set are invisible to the one review that claims to assess "consistency of the narrating voice".
5. **The importer cannot propose POV.** `narration` is absent from `_narrCats`, `typeUnion` and
   `narrSubInfo`. That is deliberate (v.712: _the narrative frame is a statement of the AUTHOR'S
   INTENT, not a feature of the prose_) and this design keeps it.
6. **Four parallel "who narrates" stores**: `data.pov.narrators`, `w.bucket === 'Narrator'`,
   `w.storyRole === 'Narrator'` (Character Studio), and the retired `w.narrator` boolean. Only the
   first two are synced. **This design must not add a fifth.**

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
> perspective is."_ → the book-level scope has declared the per-card answer to be the open one.

So: **a card stores a difference, never a copy.** Inheritance is not an optimisation here, it is the
semantics. An empty record and a record that happens to match the book are different facts, and only
the first one is representable — which is what makes "this scene is different" legible without a
flag, a colour, or an author remembering to say so.

And the second half, which is the organising principle for the UI:

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
it claims to support. The per-card control must be able to have nothing to say.

---

## 3 · The model

### 3.1 The record

```
cardPov = {
  who:    <elementKey> | '',    // the viewpoint character for this card
  person: '' | 'First Person' | 'Second Person' | 'Third Person',
  scope:  '' | 'Limited' | 'Omniscient' | 'Objective' | 'Deep / Close',
  tense:  '' | 'Past' | 'Present'
}
```

Every field is **a departure or empty**. `resolve(card)` returns the book's value for any field the
card leaves blank. No card ever stores `'Multiple POVs'` — that is a statement about the book, and at
the card level it has no meaning.

Three laws.

**A card stores only what differs.** Setting a card's field to the book's own value clears it rather
than writing it. This keeps "is this a departure?" a property of the data rather than a comparison
someone has to remember to run, and it means changing the book's POV re-tags every inheriting card
for free.

**`who` is an element key, never a name.** It joins the existing `being` elements, it survives
`__dystMigrateKey` renames, and it is the same currency `data.pov.narrators` already uses. **A card's
`who` does NOT write the `Narrator` bucket** — the bucket means _narrates the book_, and a character
who carries one chapter is not that. This is where a fifth store would otherwise be born.

**A card's POV is never inferred from its prose.** The importer rule holds: the narrative frame is a
statement of the author's intent. A check may *report* that a section reads first-person while its
card says third; it may not *set* the field. (§5.3.)

### 3.2 Where it is stored — and this is the good news

The survey turned up an explicit warning about the established per-card pattern: a store keyed
`col.id + '|' + i` must be re-keyed in **seven** separate remap paths when sections move, and
`plotCardStakes` is named in the file's own comments as _"v.563's fault by construction"_.

POV does not have to repeat that mistake, because **the section card already has a record that moves
with it**: the frame.

```
state.frames[i] = { gap, prompt, stage, stageName, partId?, plotWord?, secType?,  pov? }
```

Adding `pov` to the frame means **no reindex hook at all** — insert, delete, merge, split and reorder
carry it automatically, the same way `stageName` and `partId` already do. The one place that needs a
line is `keepMeta` on merge, which already enumerates exactly these fields.

For the other two card kinds:

- **Scene cards** → `data.sceneData[colId|sid]`, which already exists with `{title, text, els,
  elNotes, stakeNotes}` and is keyed by a stable `sid`, not an index. Add `pov` to `_scnEnsure`'s
  literal and a getter/setter pair. The card's storage router already switches section-vs-scene for
  stake notes (`_stkGet` / `_stkSet`); `_povGet` / `_povSet` go in beside them.
- **Thread and arc cards** → **they inherit and store nothing.** A thread is a storyline crossing
  sections; its viewpoint in §4 is §4's. Giving a thread card its own POV invites the contradiction
  of a thread claiming one viewpoint while the section it crosses claims another, with no rule for
  which wins. _(Raised as an open question, §10.4, because a braided multi-POV novel is precisely a
  story where each thread has a fixed viewpoint — and if that is the shape Jeremy means, the thread
  is the better home and the section inherits from it.)_

### 3.3 The read — weighted perspectives

Jeremy: _"the POV section in the elements would automatically be updated with pills that reflect
multiple perspectives and their relative weight."_

This is a **derivation**, not a store. A new module, matching `window.__conflict`'s shape, so the
planner and Checks can reach it from their own IIFEs:

```
window.__pov = {
  book()            → data.pov (the declared record)
  card(i, col, sid) → the stored departure, or null
  resolve(i,col,sid)→ {who, person, scope, tense, source:'book'|'card'}
  cast()            → [{key, name, cards, words, share}]   sorted by share desc
  departures()      → [{i, col, sid, field, from, to}]
  sentence()        → the composed reading
}
```

`cast()` is the weighted pill row. **Weight is counted, never typed.** Two honest measures:

- **by card** — always available, works before a word is written, and is what a writer means when
  they say "she gets four chapters".
- **by words** — truer to the reading experience; a 4,000-word chapter outweighs a 200-word
  interlude. Only available where prose exists.

Recommendation: **count cards, and show the word share as a second, dimmer figure once any prose
exists.** A pill reads `Feo · 7` and, when there is prose, `Feo · 7 · 62%`. _(§10.2.)_

**The row shows the multiplicity; it never rewrites the author's declaration.** If the book says
_Third Person · Limited_ and three different characters carry cards, the row says so and offers
**"make it Multiple POVs"** as a one-tap action. It does not quietly change the field. _Structure the
manuscript doesn't state is the author's_ — and a declared scope is exactly a statement.

---

## 4 · How it lives on the plot cards

The card header is already full: scene tabs · **Write about** · **Where next** · **Explore** ·
(Summarize) · kebab. A sixth pill there would crowd the row and — worse — would give a control that
is usually silent the same visual weight as three that always do something.

So, two states:

### 4.1 Inherited — a quiet tag, not a pill

In the `.pl-cardpop-sub` line under the title, beside the plot stage, in `--ink-faint`:

```
   Act II · The Descent            ·  first person · Feo
```

No border, no background, no ✦. It is a **fact about the card, rendered** — which is exactly what it
is. Clicking it opens the chooser; hovering says _"From the book's point of view — click to change it
for this section only."_

### 4.2 A departure — it becomes a pill

The moment a card stores anything, the tag promotes to the header row as a real pill,
`class="pl-cardpop-writeabout pl-cardpop-pov"`, so it matches the three pills already there:

```
   [ ◉ Symlog ]   [ Write about ]  [ ✦ Where next ]  [ ✧ Explore ]   ⋯
```

with the gold border the card's other departures use, and a tooltip naming what changed: _"This
section is third person — the book is first. Click to change or clear."_

**That asymmetry is the whole design in the UI.** Inheriting is quiet because it is the norm;
departing is loud because it is a decision, and Jeremy's own framing is that a change "would signify
something about the story getting another perspective". The interface should agree with that.

### 4.3 On the collapsed grid cell

The grid is where "who is telling this one?" is most useful at a glance. A collapsed card shows the
viewpoint character's **initial or first name** in the corner **only where the story has more than
one viewpoint** — a single-POV book gets nothing, because a label repeated on forty cards is noise,
not information.

### 4.4 The chooser

A small popover, and **its contents are decided by §2's table**:

- **Whose eyes** — a searchable list of `being` elements, the book's declared narrators first, then
  everyone on this card's own element list, then the rest. (The Stakes Builder's picker, v.761, is
  the pattern; it already offers groups and has a search box.)
- **Person · Scope · Tense** — three quiet segmented rows, each showing the book's value as the
  selected-by-default state, so choosing something else is visibly a departure. **Shown collapsed
  behind "…also change how it's told"**, because in the common case the viewpoint is the only thing
  that moves.
- **Clear** — returns the card to inheriting, one tap, always present when anything is set.

### 4.5 What the Where Next planner gets

POV joins the `pre` array — the block that already carries the author's standing instruction for the
whole book, and which the module's own comment describes as _"how the book is told"_. POV is
precisely that, so it belongs there rather than in the card context:

```
HOW THIS BOOK IS TOLD: Past tense, third person, limited — narrated by Delphia.
THIS SECTION'S VIEWPOINT: Feo.  (The book is Delphia's; this section departs.)
Offers must be things FEO can see, hear, infer or feel. Nothing may be offered that
he is not present for, and nothing may be offered from inside another character's head.
```

That last sentence is the part that actually changes the output, and it is only truthful when a
viewpoint is known — so it is emitted **only for limited/close scopes**, never for omniscient or
objective. **No POV lens.** The lens list says what a step is *made of*; POV is a constraint on every
step, not a material one step can be built from.

### 4.6 What Explore and Checks get

- **Explore** already has the vocabulary — `QC_NARR` carries `['narration','POV','point of view']`
  and `qaCatNoun.narration = 'point of view'`. What it lacks is the *card's* POV; opening Explore
  from a card should carry the resolved viewpoint into the focus line.
- **Checks** gets a fourth check — §5.3.
- **And the Craft review's existing POV line should be fixed while we are here**: it reports
  "POV / narration constraints" from category words and buckets, and never reads `data.pov`. That is
  a one-line bug in a feature that already claims to assess the narrating voice.

---

## 5 · What gets read back

### 5.1 The POV row becomes a read

Today the row shows one composed sentence. It gains a second line when the cards disagree with each
other — the weighted cast, in the story's own names:

> **Point of view** — Past tense, third person, limited.
> **Told through** `Delphia · 9 · 54%` `Feo · 5 · 31%` `The Assessor · 2 · 15%`

Clicking a pill filters the Plot grid to that character's cards. _(The standing rule — the view may
choose what to draw, but not what to hide — means this is a highlight, not a filter. §10.5.)_

### 5.2 The shape of the telling, in Plan

The same picture the Conflict strip draws, for viewpoints: one lane per viewpoint character, one
column per section, shaded where that character carries the card. It shows at a glance the things a
multi-POV writer actually worries about — **a viewpoint that vanishes for nine sections and comes
back; a character who narrates twice at the start and never again; a back half that is entirely one
voice.**

And it inherits the Conflict strip's hard-won warning verbatim: **the strip shows, and does not
rank.** No "balance" score, no target, no greying out. A lane with gaps in it is a shape, not a
failure, and three lanes with gaps look like a report card no matter what the caption says.

### 5.3 The consistency check — the one Jeremy named

A fourth entry in `CHECKS`, `id:'perspective'`, _"Perspective — sections that read against the point
of view they are set in."_ Two passes, in the app's established order:

**Deterministic first, and it is cheap.** Pronoun density per section, compared to the resolved
person:

- a section resolved **third** whose prose carries first-person singular pronouns outside dialogue
- a section resolved **first** that never uses one
- a section resolved **first · limited** whose prose reports another character's interiority in the
  telltale forms — _"she realised", "he had never told anyone", "they wondered"_

These are pattern matches, they run with AI off, and they are the cases that actually happen when a
draft drifts.

**Then the opt-in ✦ pass**, for the one a regex cannot see: **head-hopping inside a limited scene** —
the paragraph that slips from Feo's head into Delphia's and back. That is a real, common, hard-to-
self-spot fault, and it is the best argument for this whole feature.

Findings are pinned as notes beside the passage and **never applied**, like every other check. And —
the rule that keeps this from becoming a grade — **the check reports the mismatch; it never changes
the card.** If the author wrote §7 in first person on purpose and the card says third, the fix might
be the card, not the prose, and only they know which.

---

## 6 · What this deliberately does not do

- **No fifth "who narrates" store.** A card's `who` does not write the `Narrator` bucket, does not
  touch `w.storyRole`, and does not resurrect `w.narrator`. There are four already; this adds a
  per-card field with a different meaning and says so.
- **No copying the book's POV onto every card.** Cards that inherit store nothing. A card record that
  exists means something.
- **No silent rewriting of the declared scope.** Three viewpoints in the cards *offers* to make the
  book Multiple POVs. It never just does it.
- **No POV inferred from prose into the data.** The importer still cannot propose a POV layer, and no
  AI pass writes a card's viewpoint from its text. A check may report; it may not set.
- **No POV lens in the planner.** Constraints and materials are different things.
- **No per-card reliability.** An unreliable narrator is a property of the telling, not of a section,
  and the one case that seems to want it — a reliable frame around an unreliable account — is better
  said by the two viewpoints than by a per-card flag.
- **No balance meter, no coverage percentage, no "your POV is unbalanced".** The strip draws; it does
  not grade.
- **Nothing asked of an omniscient story.** §2's table is a specification, not a nicety.

---

## 7 · Phases

**Phase 1 — the model and the tag.** `cardPov` on the frame and the scene record, `resolve()`, the
`window.__pov` module, the quiet sub-line tag and the departure pill, the chooser. The POV row
unchanged. This is the whole of what Jeremy asked for on the cards, and it is testable on its own.

**Phase 2 — the read.** `cast()`, the weighted pills on the POV row, the offer to declare Multiple
POVs, the viewpoint name on collapsed grid cells.

**Phase 3 — the planner and Explore.** The `pre` line and the limited-scope constraint; the viewpoint
carried into Explore's focus line. **Fix the Craft review's POV line here** — it belongs with this
phase's work and is a few lines.

**Phase 4 — the perspective check.** The deterministic pass first and alone; the ✦ head-hopping pass
only once the deterministic one has been used on a real draft and its false-positive rate is known.

**Phase 5 — the strip.** Last, on purpose. It is the most attractive part and the least necessary,
and the Conflict doc's warning applies twice over here: a picture of who-narrates-what will be read
as a verdict on whether the balance is right.

---

## 8 · How it gets verified

- **A story with no POV set draws nothing anywhere** — no tag, no pill, no empty state that reads as
  a reproach. The feature's resting state is invisible.
- **A first-person book with no departures stores nothing.** Check the plan record: `pov` on every
  frame absent. If inheriting writes data, the central rule is broken.
- **Section surgery leaves every card's POV attached to its own card.** Insert, delete, **merge**,
  split and reorder. This is the claim that justifies putting it on the frame rather than in a
  `col|i` map, so it is the one to test hardest — and merge is where `keepMeta` has to have learned
  the new field.
- **Renaming a viewpoint character through `__dystMigrateKey` keeps every card's `who` pointing at
  them.**
- **An omniscient story never shows a "whose eyes" control.** Set the book to omniscient and open
  every card kind.
- **Setting a card's field to the book's own value clears it** rather than storing a copy — and the
  card goes back to reading as inherited.
- **Look at the picture.** For the weighted pills and the strip, a photograph is a test the harness
  cannot replace. The specific thing to look at: does a cast of one Delphia pill and one Feo pill read
  as _information_, or as _imbalance_?
- **`window.__aigateReport()`** for the ✦ head-hopping pass in phase 4.

---

## 9 · Risks worth naming

**In a multi-POV book this is a required field on every card, and required fields are friction.** A
writer with forty sections now has forty little questions to answer before the planner is any more
useful than it was. Mitigations: the chooser offers the characters already on that card's element
list first, so the common case is one tap; and a card left blank must degrade gracefully — the
planner simply omits the viewpoint line rather than the card feeling unfinished. **Do not put a
completeness marker on an unset card.** That is the single easiest way to make this feature hated.

**"Departure" is a loaded word and the pill may read as an error.** The gold border that says
*decision* on a stake card may say *warning* here, on a card that is doing something perfectly
deliberate. Worth trying: the viewpoint character's own element colour rather than gold.

**Weight-by-card and weight-by-words will disagree, sometimes dramatically**, and the disagreement is
itself interesting — a character with many short sections and few words is a different book from one
with three long ones. Showing only one number hides that. Showing both risks the row becoming a
dashboard.

**The deterministic check will produce false positives on first-person dialogue in a third-person
book**, which is most third-person books. The pronoun pass **must** exclude quoted speech, and even
then epistolary inserts, letters and remembered speech will trip it. If the false-positive rate is
bad enough that a writer turns the check off once, it is off forever — so phase 4's deterministic
pass ships alone and gets measured before the AI pass is built on top of it.

**This feature's value is hostage to adoption the same way #47's was hostage to #46's.** If writers
never set the book's POV, `resolve()` returns empty forever and every part of this draws nothing.
That is an acceptable failure mode — it fails to empty, not to wrong — but it means **phases 2 and 5
should not be built until phase 1 has been used on a real draft.**

**Scope creep toward a "voice" feature.** Distance, diction, filter words, free indirect style: all
adjacent, all tempting, none of them what was asked for. The line this doc draws is that POV is
**who the camera is on and what grammatical person it uses**, and everything about *how it sounds*
belongs to the Craft review, which already has a Prose & voice dimension.

---

## 10 · Open questions for Jeremy

1. **Does a card carry a viewpoint, or a whole POV record?** I have specced the full delta
   (who · person · scope · tense) with everything but `who` hidden behind "…also change how it's
   told". If in practice only `who` ever varies, the other three are dead weight and the chooser gets
   simpler. If a flashback in present tense inside a past-tense book is a case you want, `tense`
   earns its place.

2. **Weight by cards, by words, or both?** §3.3 recommends cards, with word share as a dimmer second
   figure once prose exists. The alternative is words only, which is truer to the reading experience
   but shows nothing until the drafting starts — and this feature is meant to be useful while
   planning.

3. **Should a card's viewpoint character get any visible mark on the map or in the elements list?**
   The wiki already floats narrators to the top. Marking per-section viewpoint on the map is
   tempting and might be noise.

4. **Do thread and arc cards carry their own POV?** I have said no — they inherit from the section —
   but a braided multi-POV novel is exactly the case where each *thread* has a fixed viewpoint and
   the section inherits from the thread instead. **If that is the shape you have in mind, the
   inheritance runs the other way and §3.2 needs inverting.** This is the one structural question in
   the doc.

5. **Should clicking a weighted pill filter the Plot grid, or only highlight it?** The standing rule
   says the view may choose what to draw but not what to hide, which argues for highlight. But "show
   me only Feo's chapters" is a genuinely useful reading pass.

6. **Is "Deep / Close" a scope or a separate dial?** It sits in `POV_SCOPE` beside Limited and
   Omniscient, but it answers a different question — *how close* rather than *how much is known* —
   and it is the one scope value with no entry in the `narration` word pool and no `WORD_DESC`. It
   may want to be a distance setting rather than a fourth scope.

7. **Should the per-card POV feed the Continuity check as an invariant**, the way `sex` is today? A
   viewpoint character who could not have witnessed what the section reports is a continuity fault as
   much as a perspective one, and Continuity already has the machinery.
