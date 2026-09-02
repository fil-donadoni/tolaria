---
title: ScenarioSpec's libraryCount seeds BOTH players, so a library-divergence decision cannot be written as a blade entry
discoveredBy: 3027
status: draft
confidence: high
---

**What is wrong.** `ScenarioSpec.libraryCount` fills both libraries with the
same number of filler basics (`scenarioBuilder.ts`: `p1.library = []` /
`p2.library = []`, one loop, both pushed). There is no per-seat form, the way
`life` and `poison` have `{ me, opp }`.

**Why it matters.** A decision that turns on the libraries DIVERGING cannot be
expressed. Every mill deck, every deck-out race, and the whole self-mill half of
a graveyard-loop line is exactly that shape: my library is a healthy 40 and the
opponent's is down to 12, so milling myself is cheap and milling them is lethal.
A blade entry can only say "both at 12", where the term largely cancels and the
position tests something else.

**Evidence.** Issue #3027's branch adds a `library` eval term and wanted a
discriminating blade entry for it. The best available candidate —
`libraryCount: 3` with a lethal Brain Freeze against a non-lethal Lightning
Bolt — was measured on the PARENT commit and picks the identical move on 5/5
seeds at 400 and 1200 iterations, i.e. it would have passed with the term
absent. The entry that did discriminate had to route around the limitation by
making the kill depend on recurring a Black Lotus instead. The probes that
actually measured the term's effect had to trim `opp.library` by hand after
`buildBladeState`, which a registry entry cannot do.

**The fix is small and has a precedent.** `life` was in exactly this position
until issue #2147 gave it `{ me?, opp? }`, whose note records that before it
"this position was simply unwritable". The same shape applied to `libraryCount`
(keeping the scalar as the both-seats shorthand) makes the class writable.

**Why it may not deserve its own issue.** Only one branch has wanted it so far,
and a probe can trim the library by hand. Against that: it is a five-line change
to a builder with a working precedent, and while it is missing, every
library-divergence decision is untestable at the level the repo pins decisions
— so the terms that read a library have no decision-level guard of their own.
