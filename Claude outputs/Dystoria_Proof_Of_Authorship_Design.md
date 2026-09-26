# Dystoria — Proof of Authorship: a Record of the Work (design)

_Brainstorm and design doc · 2026-09-26 · written against v.835 · status: **PROPOSED — decisions in §11 wait on Jeremy**_

> **Jeremy:** "Since more and more people are being accused of their work being AI generated and not original, or even plagiarized, we almost need a way to submit work that comes with proof of originality so that you can avoid the accusations. it would be great if Dystoria helped with that, but having a few checks on originality, plagiarism, and ensuring it isn't AI-generated work, as well as having a log of the sessions and proof of the work being done by an individual… This would also be invaluable for the research and essay potentials of the tool… having fact checks and other things that can be part of your submission would be great."
>
> **Jeremy:** "the tool should not allow you to get away with plagiarism, ai-generated work sold as original work, or when it comes to journalism and research posting things that are not based in fact, unless the work is posited as hypothesis or exploration of possible alternative ideas"

---

## 0. The short version

Dystoria can't look at a finished page and say who wrote it. Nobody can do that reliably (§1). What Dystoria **can** do is **keep an honest record while the work is being made**, then let the writer attach that record to a submission. Dystoria also holds much more of the work than a word processor does. It has the planning, the research with its sources, the sessions and the revisions. That makes its record hard to fake and easy to believe.

The feature has four parts:

1. **The Ledger.** Recording starts now and stays invisible. It notes where every piece of text came from: typed here, dictated, pasted from outside, moved from your own notes, imported, suggested by a co-author, or rephrased by AI on request. Each session is sealed with a timestamp from the server.
2. **The Checks.**
   - Composition: how much of the text came from each source.
   - Borrowed text: every piece of outside text is either quoted and cited, or it is flagged.
   - Voice: sections that read unlike your own baseline are noted, and that is a note, never a verdict.
   - Claims (for essays, research and journalism): every factual claim carries a real source, or it is labelled Hypothesis, Opinion or Exploration.
3. **The Session log and replay.** A timeline of every session, plus a playback of the draft growing from the first note to the final version.
4. **The Record of Work.** A page and a PDF the writer shares. A verification link shows the recipient the server's copy, so it can't be edited after it is issued.

**The rule that answers Jeremy's second message:**

- The Record **always tells the truth, and it can't be told to leave anything out.**
- Pasted outside text, AI-touched text and unsourced claims can't be hidden. They can only be *resolved*: quoted and cited, rewritten, sourced, or labelled as hypothesis.
- **The Record won't give a clean status while anything is unresolved.** An open item is printed on the Record.
- Dystoria can't stop anyone copying their words out and passing them off elsewhere. It can make sure that **nothing Dystoria signs is a lie.**

---

## 1. The honest premise: what can and can't be proven

**AI detectors that judge a finished text are not trustworthy enough to accuse anyone, and not trustworthy enough to clear anyone.**

- OpenAI withdrew its own AI-text classifier in July 2023, citing its "low rate of accuracy".
- Stanford researchers (Liang et al., *Patterns*, July 2023) found GPT detectors flagged the writing of non-native English speakers as AI far more often than native speakers' writing.
- Independent tests have found false-positive rates far above vendors' claims. Light prompting evades most detectors.

A detector score is exactly what gets innocent writers accused, so **Dystoria will not issue one as a verdict** (decision D1 in §11).

**What does hold up is a record of the process.** This is the direction the field has taken:

- **Grammarly Authorship** records whether text was typed, pasted or AI-generated, and offers a replay. The student previews the report before sharing it. Grammarly itself says the report opens a conversation; it is not final proof.
- **Turnitin Clarity** gives students a composition space that records pasted text, writing time and draft history for the instructor.
- Students accused of using AI are routinely told to produce their Google Docs version history as evidence.

**Where Dystoria goes further.** Those tools see keystrokes in one document. Dystoria sees the *thinking*:

- the elements a writer built before writing about them;
- the notes, questions and Explore answers;
- the research, with its retrieved sources and the dates they were read;
- the plot grid, the sessions and the revisions.

A forger can retype a chatbot's essay by hand. It is much harder to fake three weeks of notes, research and plans that lead coherently to that essay. **The thinking trail is the strongest evidence Dystoria can offer, and no competitor has it.**

**What the Record will say, and what it won't.** The Record states what the record shows. It never claims more.

- It says: *"Written in Dystoria by Jeremy Plante over 14 sessions between Sept 2 and Sept 25. 91% typed here, 6% dictated, 3% quoted and cited. No AI-written text."*
- It never says *"certified human-written"*.

Its limits are printed on it (§8), because a certificate that overclaims is the easiest kind to discredit.

---

## 2. What Dystoria already has to build on

| Already in the app | What it gives the Record |
|---|---|
| **"AI never writes your manuscript"** (Tool Map, Philosophy). The only AI that touches prose is Rephrase on request; Refract makes you write the retry yourself. | The story's own AI is already on the right side of the line. The Ledger only has to mark the one door (Rephrase) and everything that comes in from outside. |
| **Writing sessions** — `sessionLog` snapshots (`at`, `words`, `html`, `sessHtml`, elements, guides, prompt) and the `data-sess` marks on prose written in a session | A session timeline exists already; it needs durations, deletions and sealing. |
| **Version history** — `captureVersion` (auto, manual, shared), the "Sent to beta readers" versions (v.835) | The spine of the replay; shared versions show exactly what a reader or instructor received. |
| **Research** — answers built only from retrieved sources ("no source, no save"), `{title, url, accessed}` kept on every clip, ✦ Research notes on elements | Sources for the claim check, with the date each was read. Research dated *before* the prose that uses it is strong process evidence. |
| **Co-author roles and presence** (Editor / Suggester, section holds, `data-au`) | Who wrote what, when a work is shared. |
| **Beta exchange and reader links** | Human readers who saw a dated draft: a second, independent witness to the timeline. |
| **Server rows with server timestamps** (Supabase), RLS, the `notices` function | Somewhere to seal the ledger that the writer's own device can't backdate. |
| **Patterns lenses** that learn *your* baseline | The honest version of an "AI check": does this passage sound like **you**? |

---

## 3. Part A — the Ledger (capture)

This has to start before any of the rest, because **provenance can't be reconstructed after the fact.** Every week without the Ledger is a week of drafts that can never have a Record.

### 3.1 What it records (and what it doesn't)

Every change to the manuscript is logged as an event with **where the text came from**:

| Source | How it's detected | How it's shown |
|---|---|---|
| **Typed** | `beforeinput` insertText and IME composition | Yours. Speed and rhythm are kept per burst, not per key. |
| **Dictated** | Dictate / the notepad dictation window writes through one function | Yours (spoken). |
| **Pasted — from inside Dystoria** | The clipboard payload carries a Dystoria marker, or the text matches your own notes, sections or research clips | Yours, moved. A research clip keeps its source. |
| **Pasted — from outside** | A paste event whose text isn't found in the story | **Outside text**: a length, a fingerprint and a time. Stays flagged until resolved (§4.2). |
| **Imported** | The importer | **Pre-existing text; its history is outside Dystoria.** The Record starts from the import. |
| **AI Rephrase (accepted)** | The Rephrase accept path | **AI-assisted**: the span, the time, and what it replaced. |
| **Co-author / accepted suggestion** | Live sync / `data-au` / suggestion accept | Written by *name*. |
| **Deleted** | `beforeinput` delete* | Counted, not kept. Revision is evidence of thought. |

- **Spans carry their origin.** Each run of text carries an origin mark, like `data-au` does today. Editing inside an outside-text span doesn't make it yours until it has been **substantially rewritten**: less than about 35% of its original words left in order. It is measured, not guessed (D3).
- **Privacy.** The Ledger never stores keystrokes or clipboard contents from outside. It stores lengths, fingerprints (hashes), timings and origins. It lives with the story, in the story's cloud row and locally. Only the writer ever sees it, until they choose to issue a Record.
- **Cost.** Events are grouped into bursts (a pause of more than 2 seconds or a change of source starts a new one). A novel's Ledger should stay in the low hundreds of KB. Old bursts roll up into per-session summaries.

### 3.2 Sealing: making the log tamper-evident

- Every event block is hash-chained to the one before it.
- When a session closes (the end-of-session recap already exists), its **closing hash, word count and summary** go to the server in a small `ledger_seals` row, stamped with **server time**.
- A Record lists its seals. Anyone verifying it can check that the chain matches the seals and that the seal times are real.

**Honest limit:** someone who rewrites the app in their own browser could feed it made-up events *as they go*. Sealing stops **after-the-fact** fabrication: backdating, or inventing sessions afterwards. It does not stop a determined forger working live. The cadence and thinking-trail checks (§4) are what make live forging expensive, and the Record says this plainly (§8).

---

## 4. Part B — the Checks

Each check has three possible outcomes: **clear**, **disclosed** (true, and shown), and **unresolved** (it blocks a clean status). None of them ever says "this is AI".

### 4.1 Composition

A bar and a table:

- how much was typed here, dictated, moved from your own notes, quoted and cited, co-authored, AI-rephrased, imported, or is **unresolved outside text**;
- per section as well as for the whole work.

This is the headline of the Record.

### 4.2 Borrowed text (plagiarism)

- **Outside pastes.** Every paste from outside must end as one of:
  - **a quotation**: marked as a quote, with a citation (a research source, or a reference typed in);
  - **rewritten**: past the threshold in §3.1;
  - **removed**.
  
  Until then it is **unresolved**: flagged in the margin, counted on the Record, and it blocks the clean status. *"The tool should not allow you to get away with plagiarism."*
- **Similarity to published text** (phase P5). The final text is compared against the web and published sources, for passages that were *typed* but match something that already exists. That is the retyping loophole. It needs an outside service (§11, D5): a plagiarism API, or distinctive-sentence search through the worker, as research already does. Any match of more than about 12 words with no quotation marks becomes an unresolved item.
- **Self-plagiarism is fine.** Text from your own other stories in Dystoria counts as yours, moved, and says so.

### 4.3 Voice (the only "AI check" we'll run)

- **Process signals.** These are reported as facts, not scores:
  - Did the text arrive at human writing speed, with pauses, corrections and back-tracking?
  - Or did it arrive in long, even, correction-free runs, the way retyping or transcription does? Those passages are **noted**, e.g. *"Section 7 was entered as steady transcription (2,100 words in 38 minutes, no revisions)"*.
  - The writer can annotate a note ("copied from my handwritten draft"). The annotation is shown beside it.
- **Your own baseline.** The Patterns lenses already learn your voice. A passage far outside *your* baseline (rhythm, vocabulary, sentence shapes) is noted as *"unlike your usual voice"*. It is never called "likely AI", because a writer trying something new looks exactly the same.
- **No third-party AI-detector score** (D1). If Jeremy wants one anyway, it must be off by default, labelled with its error rates, and it must never block a status.

### 4.4 Claims (essays, research, journalism)

This is the second half of Jeremy's second message: *nothing posted as fact that isn't based in fact, unless posited as hypothesis or exploration.*

**How claims are found.** A claim pass reads the manuscript and marks each factual claim: a statistic, a date, a quotation, a named event, a causal assertion ("X caused Y"). It can be ✦ AI-assisted, pointing only. It is deterministic for numbers, dates and quotation marks.

**What each claim must end as.** Every claim must be one of these:

| Label | What it needs | How it prints in the export |
|---|---|---|
| **Sourced** | A real source attached: a Research source (retrieved, dated), or a reference the writer adds (URL, DOI or bibliographic entry, checked that it resolves) | A citation marker; the entry in the bibliography |
| **Quotation** | A source, **and the words must match** the source's text (fetched and compared). A misquote is unresolved. | Quoted and cited |
| **Common knowledge** | The writer's say-so. It is listed on the Record, so a reader can disagree. | Nothing |
| **Hypothesis / Exploration** | The writer marks the passage. **The label travels with the text.** | A visible "Hypothesis" treatment (margin rule and label) in every export, and the Record lists them |
| **Opinion / Analysis** | The writer marks it. | Listed on the Record |

**What blocks.** An unlabelled factual claim with no source is **unresolved**. In a Journalism or Research work, a Record with unresolved claims can't say "Claims: verified".

**The hard part, stated plainly.** A source *existing* doesn't prove it *supports* the claim.

- For quotations, the text is compared word for word.
- For other claims, a ✦ support check reads the source and says *"the source says this / says something weaker / doesn't address it"*. That is a pointer the writer must look at, the same honesty rule Research already uses.
- The Record shows which claims were support-checked.

### 4.5 Citations

- Every citation resolves (link checked, accessed date kept).
- A dead link is kept with its title and accessed date, as Research already does.
- The bibliography is generated from the sources actually attached, so a reference can't appear that nothing in the text uses.

---

## 5. Part C — the Session log and the replay

- **Timeline.** One row per session:
  - date, start and end, active minutes;
  - words added and removed;
  - which sections;
  - what else was open: planning, research or notes in that session.
  
  A strip across the top shows the whole work's calendar.
- **The thinking trail.** Beside the timeline sit the non-prose events: an element created, a research question asked (and its sources), notes written, a plot card filled, Explore answers, beta-reader comments received. This shows the essay's argument growing *before* the essay did.
- **Replay.** A slider (or play at 1×–64×) runs the manuscript from empty to final, built from the session snapshots and versions. Origin colours can be turned on, showing typed, outside and AI-assisted text.
- **What the recipient sees** is the writer's choice (D6):
  - the summary only;
  - plus the timeline;
  - plus the thinking trail's *titles* (not its contents);
  - plus the full replay.
  
  A student's notes can stay private while still proving they existed.

---

## 6. Part D — the Record of Work (what gets submitted)

- **Issuing.** In Review → Share, or Export → **Record of Work…**:
  1. Choose the version: the current draft, or a shared, sent or published one.
  2. Choose what to include (§5).
  3. Issue it.
  
  The Record freezes that version's text fingerprint.
- **The Record page** (`#/proof/<id>`, readable signed out). It shows:
  - title, author and word count;
  - the date range and number of sessions;
  - the composition bar;
  - each check with its outcome;
  - disclosures: outside text, AI-assisted spans, claims labelled Hypothesis or Opinion, imports;
  - the session timeline;
  - the optional replay;
  - the seals;
  - **"What this record can't show"** (§8);
  - a **verification code**.
- **Verification.**
  - The recipient pastes the submitted text, or uploads the file, into the verify box. Dystoria compares its fingerprint with the issued version's and says **"matches the recorded version"** or **"differs — here is where"**. This catches editing after the Record was issued.
  - The Record itself lives on the server and can't be changed. Re-issuing makes a new Record; the old one stays visible as superseded.
- **PDF.** The same content, with the verification link and code. For portals that only take files.
- **Status wording:**
  - **Complete**: nothing unresolved.
  - **With open items**: the open items are listed on the Record.
  - There is no "Original ✓" badge that could be read as a verdict on the text itself. The claim is always *about the record*.

---

## 7. By kind of work (fits roadmap #79)

| Kind | Ledger & composition | Borrowed text | Voice | Claims | Default share |
|---|---|---|---|---|---|
| Fiction / novel / short stories | ✓ | ✓ (epigraphs count as quotations) | ✓ | off (the story's world isn't fact) | Summary + timeline |
| Essay | ✓ | ✓ | ✓ | **on**; Opinion / Analysis expected | Summary + timeline + trail titles |
| Research | ✓ | ✓ | ✓ | **on, strict**: sourced or Hypothesis; quotation match required | Everything but notes' contents |
| Journalism | ✓ | ✓ | ✓ | **on, strictest**: every factual claim sourced; quotations matched; no "Common knowledge" without an editor-visible list | Everything |
| Journal / memoir | ✓ | ✓ | ✓ | off (optional) | Summary only |

In an Essay, Research or Journalism work, **Hypothesis / Exploration** is a first-class tool, not just a way out. It is how a writer explores alternative ideas honestly, and the export shows it.

---

## 8. What the Record can't show (printed on every Record)

- **Text typed in Dystoria from another screen or a printout.** The cadence note (§4.3) and the similarity check (§4.2) catch much of it, not all.
- **Help that leaves no trace**: a tutor, a friend, or another AI in another window, whose ideas were then typed here in the writer's own words. That is the same as it has always been for any writing.
- **Anything before the first recorded event.** Imported text says so.
- **A tampered app, used live.** Seals stop backdating, not live forgery.
- **Whether a source is right.** The Record shows claims are sourced, and which were support-checked. It doesn't show that the source is true.

Printing these limits is what makes the rest believable.

---

## 9. The rules (so nobody "gets away with it")

1. **Origins are sticky.** Outside text stays outside text until it is quoted and cited, substantially rewritten, or removed. Light edits don't launder it.
2. **Disclosures can't be hidden.** The writer chooses how much of the *process* to share (§5). The writer never chooses whether the *disclosures* show.
3. **No clean status with open items.** Unresolved outside text, unsourced factual claims (in claim-checked kinds) and misquotes keep the Record at "With open items", and they are listed.
4. **Labels travel with the text.** A passage marked Hypothesis prints as a hypothesis in every export, not only on the Record.
5. **The Record never overclaims.** It describes the record, prints its limits, and never issues an AI-probability score as a verdict.
6. **The writer previews first.** Nothing leaves until the writer has read exactly what the recipient will see, as Grammarly lets students do.

---

## 10. Phasing

| Phase | What | Needs |
|---|---|---|
| **P1 · Ledger, invisible** | Origin marks on text; typed / dictated / pasted (inside vs outside) / imported / Rephrase / co-author; bursts; hash chain; the end-of-session summary. No UI beyond one Settings line: "Dystoria keeps a private record of how your work is made." | Client only. **Start first: every day without it is a day that can never be proven.** |
| **P2 · Your record (private)** | Composition bar and per-section view; the session timeline; margin flags on unresolved outside text; Quote & cite / Mark as rewritten actions | Client |
| **P3 · Seals + the Record** | `ledger_seals` and `records` tables (migration 18); `#/proof/<id>`; the verify box; PDF | Migration, the notices-style server time |
| **P4 · Claims** | Claim marking (deterministic first, ✦ second); the five labels; quotation matching against Research sources; Hypothesis print treatment; the "Claims" check; by-kind defaults (with #79) | Research worker (fetch the source text) |
| **P5 · Similarity to published text** | Distinctive-sentence search through the worker, or a plagiarism API | A provider and a cost decision (D5) |
| **P6 · Replay & thinking trail** | The slider/player; origin colours; the trail beside the timeline | Client |
| **P7 · Voice notes** | Cadence notes; "unlike your usual voice" from the Patterns baseline | Client |

P1–P3 give a writer a defensible Record for fiction and essays. P4 is what makes it a research and journalism tool.

---

## 11. Decisions for Jeremy

- **D1 — AI-detector score.** Recommend **none**. The Record reports process facts and "unlike your voice" notes, never a probability that the text is AI. (Alternative: an optional third-party score, off by default, labelled with its error rates, never blocking.)
- **D2 — Name.** *Record of Work* (recommended), *Proof of Authorship*, *Provenance*, *Originality Record*. "Proof" invites the question "proof of what?"; "Record" says exactly what it is.
- **D3 — When edited outside text becomes yours.** Recommend: less than 35% of the pasted words left in their original order, **and** at least one sentence restructured. Or simpler: only quoting and citing or deleting resolves it.
- **D4 — Where the Ledger lives.** Recommend: with the story (cloud row + local), sealed per session. A writer who never signs in gets a local-only record that can't be verified. The Record needs an account.
- **D5 — Similarity provider** (P5). Options:
  - a paid plagiarism API (per-page cost);
  - distinctive-sentence web search through the worker (cheap, partial);
  - none at launch, relying on the paste rules.
- **D6 — Default share level** per kind (§7), and whether Records are a Pro feature. Recommend: issuing is free (it is a trust feature); the replay and similarity check can be Pro.
- **D7 — Claims in Essay.** Strict like Research, or softer, with Opinion / Analysis expected and "Common knowledge" allowed?
- **D8 — Before P1 ships.** Existing stories have no Ledger. Their Records start at "Record begins: the date P1 shipped", with earlier text counted as *pre-record*. Recommend showing that plainly rather than guessing from old versions.

---

## 12. Sources for §1

- OpenAI, "New AI classifier for indicating AI-written text" (withdrawn July 20, 2023): https://openai.com/index/new-ai-classifier-for-indicating-ai-written-text/ · TechCrunch, July 25, 2023: https://techcrunch.com/2023/07/25/openai-scuttles-ai-written-text-detector-over-low-rate-of-accuracy/
- Liang et al., "GPT detectors are biased against non-native English writers", *Patterns*, July 2023; summarised with other false-positive findings at the University of San Diego guide: https://lawlibguides.sandiego.edu/c.php?g=1443311&p=10721367
- Grammarly Authorship (typed / pasted / AI sources, replay, student preview): https://www.grammarly.com/blog/academic-writing/grammarly-authorship-just-got-a-major-update/ · https://www.grammarly.com/authorship
- Turnitin Clarity (pasted text, writing time, draft history): https://www.turnitin.com/products/feedback-studio/clarity
- Version history as evidence when accused: https://www.studentdisciplinedefense.com/accused-of-ai-misconduct-use-your-google-docs-version-history-as-evidence-in-your-favor-heres-how
- C2PA / Content Credentials (the provenance standard for media; a possible future export format for the Record): https://spec.c2pa.org/specifications/specifications/2.4/explainer/Explainer.html
