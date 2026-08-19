---
title: The Bot still never enumerates evoke / dash / plain alternative costs, though the Move now carries the field
discoveredBy: 2388
status: draft
confidence: high
---

**What is wrong.** `enumerateCastMoves` has never offered an alternative-cost
cast — the file's own comment says it "never pays kicker", and the same is true
of `CardDefinition.evoke`, `CardDefinition.dash` and every entry of
`CardDefinition.alternativeCosts`. So the Bot cannot pitch a Force of Vigor, can
never evoke a Grief, and cannot cast Gush or Fireblast off an empty board — the
lines those cards are IN a deck for.

**Evidence.** `convex/gre/moves.ts` `enumerateCastMoves`: before issue #2388 the
whole function built exactly one `rawCost` (`getInstanceManaCost(card)`) and one
variant axis (`modeVariants`). #2388 added `Move.alternativeCostId`
(`convex/gre/moves.ts`, the `cast-spell` member), wired it through
`src/lib/ai/executor.ts` (`announceCast({... alternativeCostId })`),
`convex/gre/applyMove.ts`'s search sandbox and `convex/gre/describeMove.ts` —
but enumerated only the Bestow variant, because that was the issue's scope. The
remaining work for evoke/dash is one more block beside the bestow one: a
different base cost and, for a hand-leg cost (Grief's "exile a green card"), the
`alternativeCostHandChoice` pick the executor would then owe.

**Why it may not deserve its own issue.** It is arguably a line on whatever
tracker owns Bot cast coverage rather than a ticket of its own, and the payoff
is uneven: a mana-for-mana swap (dash) is nearly free, while a hand-leg or
permanent-leg alt cost needs the executor to answer a picker it has no rung for
today, which is a real design step and not a fill-in-the-blank.
