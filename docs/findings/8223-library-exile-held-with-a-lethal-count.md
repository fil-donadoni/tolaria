---
title: the Bot holds an exile-from-library spell at a long library, and sometimes at one a gravestorm count would empty
discoveredBy: 8223
status: draft
confidence: medium
---

**What is wrong.** Bitter Ordeal targets a player, searches their library for a
card and exiles it. At a 20-card opposing library the Bot passes on all five
seeds. Issue #8223 and PR #8228 name that a valuation gap not specific to
gravestorm: exiling from a library is worth about nothing to `evaluate` there.
Issue #8223 was the record, and it closes with its blade entry.

The Bot also holds it at shorter libraries. With a tally of 0 it casts on all
five seeds at libraries of 1, 2, 3, 5, 6, 8 and 9 cards and passes on all five at
10, 11 and 12 (4 and 7 were not probed). Those sizes sit inside `deckingHorizon`,
where `libraryTerm` still pays for an exile, so "worth nothing" does not explain
them.

With a tally that makes the spell empty the library, the Bot usually casts but
not always:

| Tally | Opposing library | Seeds `0xb1ade, 1, 2, 3, 4` |
| ----- | ---------------- | --------------------------- |
| 9     | 10               | cast on all five            |
| 10    | 11               | passes on seed 1            |
| 11    | 12               | passes on seeds 1 and 3     |

**Evidence.** Probes through `runBladeScenario` at 400 iterations, on the spec of
the blade entry "gravestorm: aims Bitter Ordeal at the short opposing library",
varying only `permanentsToGraveyardThisTurn` and the opposing library's size.
Every pick in the table was decided by `material-tiebreak`, so the candidates
were within `outcomeEps` of the best mean (`convex/gre/search.ts`). The cause is
not established: the entry's own 2-card position stayed green with `libraryTerm`
returning 0, with `deckOutDelta` blind to the opponent's empty library, and with
both, so neither term is shown to carry the decision.

**The blade entry does not pin the tally.** It casts at a tally of 0 as well. The
10-card library is the position that separates them (pass at tally 0, cast at
tally 9), but its neighbours flip by seed, so it was not added as a `must`.

**Why it may not deserve its own issue.** Each copy adds a resolution and a
`search-library` choice, so a large count may simply run out of budget at 400
iterations; a higher budget was not tried. A tally of 10 in one turn is rare, and
few cards exile from a library by target. It may be a line on a broader
library-valuation ticket.
