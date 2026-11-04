---
title: The flat haste bonus prices a haste that cannot be used, so riot ties with its +1/+1 counter
discoveredBy: 4011
status: draft
confidence: medium
---

**What is wrong.** `KEYWORD_BONUS.haste` is a flat 10 (`convex/gre/creatureBody.ts:78`),
about what a +1/+1 counter adds to a 1/1, and `inertKeywordDiscount`
(`convex/gre/evaluate.ts`) does not discount it. Haste does nothing on a creature
that is not summoning sick, or once this turn's combat has passed, yet the bonus
stays.

**Evidence.** A riot 1/1 with an empty board, answered in `POSTCOMBAT_MAIN` at 400
and at 2000 iterations: `accept` and `decline` tie on `meanReward` (0.87391 at 400,
0.87478 at 2000), and the root pick is `decline` on `mechanism: material-tiebreak`.
The Bot takes a useless haste over a permanent counter. In `PRECOMBAT_MAIN` with
lethal on board the search picks the haste, which `riot.bot.test.ts` pins. An empty
board is a degenerate position, and nothing here measured a board with blockers.

**Why it may not deserve its own issue.** Riot's prompt is the only place this
choice is explicit, seven cards carry it, and most creatures are cast precombat.
The fix moves the value of every haste creature on every board, so it owes a `must`
blade pair and a refit, which may cost more than the misplay does.
