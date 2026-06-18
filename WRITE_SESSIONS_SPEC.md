# Write Sessions — session-versioned drafting (spec)

A design for turning Write mode into a session-based, stitchable, reversible drafting
tool. Captures the agreed decisions; the build is phased so each phase ships on its own.

## Core idea
Each timeline **section** accumulates a stack of **writing sessions**. A session is one
timed focus burst. Ending a session snapshots exactly what was written that session
(pre-refinement) with a timestamp and its review. Sessions stitch together to form the
section's active prose. Only the active, stitched prose is promoted to Read and Refine.
Refine is for final touches only — editing a section in Refine locks its sessions.

## Data model (per frame / section)
```
frame.sessions = [
  { id, startedAt, endedAt, html, words, review, status:'kept'|'archived',
    reason?: 'replaced' | 'discarded' | 'redo-all' }   // why it was archived
]
frame.refined = null | { html }   // set when Refine edits this section
frame.locked  = false             // true once refined → only Continue allowed
```
- **Active section prose** = `frame.refined ? frame.refined.html : stitch(kept sessions)`.
- **Whole-story Read/Refine** = active prose of every section, stitched in order.
- A session's `html` is just the chunk typed that session — because during an active
  session the editor holds only the current chunk (see lifecycle). Stitching = concatenation.

## Session lifecycle
- A timer is **always** part of a session. The session begins on the first keystroke
  (timer starts). It ends when the writer presses **End Session** *or the timer runs out* —
  either path triggers the snapshot + the review.
- On end: capture the editor chunk → push a `kept` snapshot; generate the **review**
  (the existing post-session recap / event-book) and link it **to that snapshot**.
- An end with nothing written → no snapshot.

## Re-entering a section that has sessions (always)
You **always** land on the locked-review screen — prior kept sessions load into the page
**read-only** (timestamp dividers between them) so you can re-read before writing. The
bottom action bar offers:
- **Continue from previous session(s)** — clears the editable area, shows the word
  *Continue* where you start typing; the new session is appended to the stack.
- **Redo previous session** — rewrite the most recent session only (the rest stay locked
  above for context). On end → review with a choice (below).
- **Redo from beginning** — archive the **whole** stitched set (`reason:'redo-all'`) and
  start a fresh first session. The archived set stays viewable and purgeable.

If `frame.locked` (the section was refined): only **Continue** is available; the Redo
options are disabled with a note — *"Refined — sessions are locked; you can only continue."*

## Post-session review choice (Redo case)
After redoing the previous session, the review pop-up adds:
- **Replace previous** — the new snapshot replaces the redone session; the old one → archive
  (`reason:'replaced'`).
- **Discard this** — keep the previous session; the new one → archive (`reason:'discarded'`).

Archived sessions are viewable per section and **individually purgeable**.

## Refine integration (final touches only)
- Editing a section's prose in Refine writes `frame.refined.html` and sets `frame.locked = true`.
- The pre-refinement snapshots are preserved → a **"see original"** toggle shows the
  unrefined stitched sessions.
- Refine mode shows a clear, persistent notice up front:
  *"Refine is for final touches. Saving edits here locks this section's writing sessions —
  you'll only be able to Continue, not Redo or Rewrite."*
- Only the active (refined, if present) prose promotes to Read/Refine.

## UI placement
- **End Session** → a small button at the bottom of the writing area (removed from the
  left panel).
- **Session history** → bottom of the Writing Focus left panel: each snapshot as
  timestamp · word count · open-review; plus an entry into the **Archive** (view + purge).
- **Locked-review screen** → the writing area renders the locked prior sessions with the
  bottom action bar (Continue / Redo / Redo from beginning).

## Migration (non-destructive)
Existing stories: convert each section's current prose into a single `kept` snapshot
(`review:null`, `ts = story.updated`). Nothing is lost; the feature lights up from there.

## Phased build (each shippable)
1. **Capture + history (non-destructive).** Snapshot on End/timeout; link review; list
   sessions at the bottom of the focus panel (openable); move End Session to the writing
   area. Writing flow unchanged.
2. **Locked review + Continue.** Section entry shows locked prior sessions; Continue appends
   a new session. *(Requires splitting section prose out of the single continuous editor —
   the main structural work.)*
3. **Redo / Redo-from-beginning + archive.** The replace/discard choice; archive viewer + purge.
4. **Refine integration.** Lock-on-refine, "see original," the Refine notice, Read/Refine
   consume active prose only.

## Open risks / notes
- Prose today is one continuous `#editor` document for the whole story; Phase 2 is where it
  becomes genuinely per-section — that's the heaviest lift and worth a careful migration.
- Storage grows with snapshots + archive (text only — modest); purge keeps it in check.
- Post-refine stack shape: `[orig1, orig2, …refined-lump…, newSession]` — the refined lump
  is one locked snapshot.
