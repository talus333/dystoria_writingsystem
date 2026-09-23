# Dystoria — the Plot grid filter

_Design doc. Split out of `Dystoria_POV_On_Plot_Cards_Design.md` §6 on 2026-09-23, where it had been
written down because it came up in that conversation — it is a general Plot-grid feature with nothing
POV-specific about it. Status: **SHIPPED as v.765** (`2026.07.20.688`, 2026-09-23). Written at v.764; §8
records what building it found._

---

## 0 · The one-paragraph version

A **Filter** button on the Plot bar opens a searchable list of every element linked to a card —
characters, places, artifacts, groups, concepts, events, stakes, threads — with checkboxes. Selecting
elements **hides every card that does not carry all of them** (AND), and **hides every section row
left with no card showing**. A badge on the bar names the filter and clears it in one click. The list
is live: each element shows how many of the currently-showing cards it is on, and an element on none
of them is shown but cannot be picked — so the filter narrows toward answers rather than into an
empty grid. **POV joins the list as a Viewpoint group** once cards carry a viewpoint (POV design,
phase 1); until then there is nothing to filter by.

[Jeremy] _"a Filter button and then using the pop up that lists all story elements with the search
filter bar for the list would be great. also allowing for more than one selection so you can see all
the cards that have feo and Delphia for example."_ · _"keep it AND only"_ · _"Hide"_ · _"the filter
is not about POV, it's about any linked elements on a card"_ · _"pov included"_

---

## 1 · What already exists

**A column filter, with a law for hiding safely.** `data.plotColFilter` narrows the grid to threads
only or arcs only; `plotColumnsShown()` leaves filtered columns out before render; and the code
wrote down the rule this feature inherits:

> _"a **badge on the bar** says when it is on. A filter you cannot see is indistinguishable from
> columns that have gone missing."_

and `plotFilterWorthIt()`: _"Only worth offering when the grid actually holds more than one kind —
otherwise every option but one empties the page."_

**The standing rule _the view may choose what to draw, but not what to hide_ is about defaults**, not
about a filter the author turns on, names, and can see. This pair is how the app has already settled
the difference.

**A link picker with the right look and the wrong behaviour.** `openCardLinkPicker` —
`.plan-menu.plan-linkpick`, a search box, rows, an empty state — is single-select and closes on
pick. The filter reuses its dress and its menu lifecycle (a `.plan-menu` is closed by the shared
outside-pointerdown handler), and adds checkboxes. **There is no multi-select element list anywhere
in the app**, so this is the first.

---

## 2 · What the survey found that shapes the build

**The grid is one flat CSS grid with no row wrappers.** Cells are placed purely by order — label,
one cell per column, a trailing spacer, an insert row — and the code carries two comments about the
whole grid drifting diagonally when a single row came up one cell short. So:

- **A card is hidden by emptying its cell, never by removing it.** The `.pl-pcell` is always emitted;
  a card that does not match renders as a blank cell. Removing it would shift every later cell.
- **A row is hidden by skipping all of it at once** — label, every column's cell, the spacer and the
  insert row together. A whole row is atomic, so skipping it cannot cause drift.
- **Part dividers follow the rows that remain**: a divider is drawn above the first *showing* section
  of its Part, and not at all if none of its sections show.

**A card is one section × one column, and holds every scene in that section.** Scenes are rows
*inside* a card (`.pl-scenerow`), not cards of their own. So a card matches on **the union of its
scenes' linked elements** — _"the cards that have Feo and Delphia"_ includes a card where Feo is in
scene 1 and Delphia in scene 3. That is the plain reading of "the card has them".

**What counts as "linked to a card"** is exactly what the author linked: the section card's own
element list plus each scene's. Two things are deliberately **not** counted:

- **The column's key elements** (`plotDefEls`), which every card in a column inherits. Counting them
  would make every card in that column match, which is not a filter.
- **The section's map elements.** The card never shows them, and a filter that matched on something
  the card does not display would read as broken.

**Reading must not write.** `cardEls()` creates an empty array in the store for any cell it reads. A
filter that scans every cell through it would dirty the plan and trigger autosaves on open. The
filter reads the stores directly.

---

## 3 · The model

```
data.plotCardFilter = [ elementKey, … ]     // absent or empty = off
```

Three laws.

**AND, everywhere** [Jeremy]. Every selection narrows. A card shows only if it carries every selected
element. There is no OR and no mode switch.

**A filter that names something no card carries is pruned, not obeyed.** If an element is removed
from every card, or deleted, its key would otherwise make the grid empty forever with no visible
reason. The filter drops keys that no card carries; if that leaves nothing, it switches itself off —
the same self-healing `plotColumnsShown()` already does for the column filter.

**Filtering is not editing.** `plotCardFilter` joins `PLOT_UNDO_SKIP`, so turning a filter on or off
is never an undo step, and undoing an edit never clears the filter. It persists per story, like the
column filter, and the badge is what keeps that safe.

---

## 4 · The interface

### 4.1 The button and the badge

- **Filter** — a pill on the Plot bar, beside the ⋯, shown only when at least one card carries a
  linked element (`plotFilterWorthIt`'s rule: a filter over nothing is a door to nowhere). It turns
  gold while a filter is on.
- **The badge** — `Feo · Delphia  ×`, beside the column filter's badge, shown only while a filter is
  on. Clicking it clears the filter, exactly as the column filter's badge does.

### 4.2 The list

A popover in the link picker's dress:

- **A search box**, focused on open.
- **Elements grouped by kind** — Characters · Groups · Places · Artifacts · Concepts · Events · Stakes
  · Threads, the plural headings the Narrative rail already uses — listing **every element linked to
  at least one card**. An element on no card cannot match anything, so it is not offered.
- **A checkbox and a live count on every row.** The count is how many of the cards *currently
  showing* also carry that element — so with Feo selected, `Delphia · 3` means adding her leaves three
  cards. **An element at 0 is shown, dimmed, and cannot be ticked.** This is how AND stays useful:
  every tick you can make leads to cards, and the ones that would lead to nothing say so before you
  make them.
- **Live.** Each tick applies at once; the grid redraws under the open list.
- **Clear** and **Done** at the foot.

### 4.3 While a filter is on

- Rows with no showing card are hidden; showing rows keep their full width, with blank cells where a
  card does not match.
- **The insert rows between sections are hidden.** Inserting a section into a filtered view would
  place it among rows you cannot see, and the new section would not match the filter and would vanish
  the moment it was made.
- **A filter that matches nothing says so** — _"No card has Feo + the Ledger."_ with a Clear button —
  rather than leaving an empty grid, **because a blank grid and a broken grid look identical.** With
  the live counts this should be rare, but a filter can still be left behind by edits made in a
  card.

---

## 5 · What this deliberately does not do

- **No OR, no "any of these" toggle.** [Jeremy]
- **No dimming.** [Jeremy] Hidden, matching the column filter.
- **No filtering by map membership or column key elements.** §2.
- **No hiding of columns.** The column filter already owns that axis. A column with no matching card
  stays, blank — which is itself information.
- **The .xls export is not filtered.** The column filter's export comment says _"The export writes
  what the grid is SHOWING"_, and the card filter could follow it — but a filtered export is a
  different document from the book's plot, and that choice deserves to be made on purpose rather than
  inherited. Left as it is until asked.
- **No Viewpoint group yet.** Cards do not carry a viewpoint until POV phase 1.

---

## 6 · POV, when it lands

Once cards carry a viewpoint (`Dystoria_POV_On_Plot_Cards_Design.md` phase 1), the list gains a
**Viewpoint** group at the top, shown only when the story has more than one viewpoint. Viewpoint
entries AND with everything else, so _Feo's eyes · Delphia_ gives the cards told through Feo in which
Delphia appears — the combination most worth having. Two viewpoints AND to nothing, because a card
has one; the live count shows that as a 0 before it is tried.

---

## 7 · How it gets verified

- **An unfiltered grid is unchanged** — same cells, same order, same classes. The row loop is
  rewritten to iterate the rows that show, and with no filter that is every row; the harness compares
  the grid's DOM signature before and after.
- **AND holds**: one element shows every card carrying it; adding a second shows only cards carrying
  both; the union across a card's scenes counts.
- **The grid never drifts**: every showing row has exactly label + columns + spacer cells, blank cells
  included.
- **Rows with nothing showing are gone**; Part dividers appear only above a showing section.
- **Opening the list writes nothing** to the plan store.
- **The badge shows whenever the filter is on** and one click clears it.
- **Counts are live and zero rows cannot be ticked.**
- **A stale key is pruned**, and a filter pruned to nothing switches itself off.
- **Filtering is not an undo step.**
- **An empty result says so** and offers Clear.

---

## 8 · What building it found

**A phantom undo step, and it came from the render, not the filter.** The grid reads every cell through
`cardEls()`, which creates an empty array in the store for any cell it reads. A filtered render draws
fewer cells, so it leaves fewer arrays behind — and clearing the filter then *changed the plan*, which
`plotCapture` dutifully recorded as an undo step that did nothing when pressed. The harness caught it
only because its fixture happened to add a column while a filter was on. The fix is a rule worth
keeping: **a filtered render must leave the same store behind as an unfiltered one** — the cells it
will not draw are touched exactly as a full render touches them. The filter's own reads still write
nothing; this only stops it changing what the render writes. t765 #19 pins it.

**The column filter's badge was under AA in Ember, and had been since it was written.** Its `#8a6d1e`
ink on the dark bar measures about 2.7:1. The card filter's badge shares the class, so it would have
inherited the fault; both now wear the bar's documented Ember dress (`--lab-gold` on a gold wash), and
the Filter pill takes the same ramp as the undo buttons beside it — in the first photograph it was a
pale veil that read as disabled.

**The unfiltered grid is provably unchanged.** The row loop was rewritten to walk the rows that show;
with no filter that is every row, and `parity` came back byte-identical to v.764 (`notepad:plot` n 271,
cls 1602, txt 684).

**Two things the harness got wrong first, both worth knowing next time.** A plot column added straight
into `data.plotCols` is pruned on the next render unless a real thread backs it (`ensurePlotCols` asks
each kind `live(id)`); and a Part's name lives in a `textarea.pl-partname`, so reading the divider's
`textContent` gets only its control glyphs.
