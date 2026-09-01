# Dystoria — browser harnesses

Playwright suites that drive the built `index.html` and assert on what it
actually renders. They are **committed here on purpose**: an earlier set of
eleven Bonds harnesses (229 assertions, named in
`claude/Dystoria_Groups_As_Containers_Design.md` §12) lived only in a working
directory, was never committed, and is gone. Nothing here is reproducible from
the app alone — a harness is as much a record of a decision as the code is.

    node tests/<name>.js [path/to/index.html]      # defaults to ../out.html

| harness | what it protects |
|---|---|
| `t_bonds.js` | The lens vocabulary, one record read by two lenses, mood constant across lenses, and the invariant that **no group stores a relationship**. |
| `groupsync.js` | A group is one thing across Elements, Bonds, the notepad and the wiki — both directions, no duplicates, and two same-kind groups staying distinct. |
| `onboarding.js` | The whole guided tour, step by step: the doors do not appear before it, Write is described rather than entered, and a door can actually be **clicked** at the end. |
| `betamark.js` | The beta marks, and that the brand mark still lines up with the Plan medallion. |
| `creatorfps.js` | Frame rate with each element creator open, and that no full-viewport `backdrop-filter` is live anywhere. |
| `brandcheck.js` | The brand mark is one vector on the live `--gold` token, in both places. |
| `menuleak.js` | Admin-only menu controls stay hidden from a signed-out visitor. |
| `aboutlink.js` | `#about-…` deep links open the About page at the right section, with a story open. |
| `ringcheck.js` | Every mode medallion's ring, at rest and on hover, in Ember. |
| `plotseam.js` | The Plot timeline column is one ground. |
| `notesground.js` | The notes column matches the page in both themes. |

## Three ways these harnesses have lied

Every one of these was a real pass on a broken build, found this session. Read
them before trusting a green run.

1. **Measuring nothing and calling it a pass.** A check that queries elements
   which do not exist yet — a closed notepad, a scrim built on demand — finds an
   empty list, skips its own assertion and reports success. *Assert that the
   thing you are measuring was found, before you assert anything about it.*
2. **Presence is not usability.** `onboarding.js` asserted the begin-here doors
   were in the DOM. They were — with the notepad drawn over them, unclickable.
   *Click the thing.*
3. **Testing the wrong state.** A `goto` to the same URL with only a new hash is
   a fragment navigation, so `init()` never re-runs; setting a theme class before
   `goMode()` is undone by the mode switch. *Assert the state you meant to create
   actually exists.*

And one about writing expectations: `t_bonds.js` first seeded the relation word
`'Enemy of'`, which is in no family, and three assertions failed. The app was
right and the test was wrong. **Take vocabulary from the source's own tables,
never from plausible English.**
