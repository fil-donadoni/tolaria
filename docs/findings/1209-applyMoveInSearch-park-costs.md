---
title: The search's activate-ability branch still pays no park cost, so a payment the bot now really makes is invisible to the evaluation that chose it
discoveredBy: 1209
status: draft
confidence: high
---

**What is wrong.** #1209 makes the live bot actually PAY every payment park
(sacrifice a creature, discard a card, tap three bodies, exile from a graveyard).
The ISMCTS search still models none of it: `applyMoveInSearch`'s
`activate-ability` case applies the tap plan and taps the source and stops. So
the position the search evaluates for "activate Survival of the Fittest" has the
same hand it started with, and the position the game reaches is a card down. The
gap widened with this issue — before it the move simply hung, which at least
could not be scored favourably.

**Evidence.** `convex/gre/search.ts:434` (`applyMoveInSearch`), the
`activate-ability` case around `search.ts:635`, versus
`convex/gre/applyMove.ts` (`applyMoveForSearch`), whose `activate-ability` case
applies `move.costPicks` in full — sacrifice victims, `tapOtherIds`,
`exileFromGraveyard`, `discardIds`. The greedy 1-ply sandbox and the search
therefore disagree about what an activation costs. `convex/gre/paymentPicks.ts`
now exists precisely so a third caller can be wired without a second opinion.

**Why it may not deserve its own issue.** It already has one — **#2155**, split
out of #1209 by the 2026-08-04 audit, and #1209's own scope note names
`applyMoveInSearch` as explicitly out of scope. This finding records that
#1209's landing did not narrow #2155 and in fact makes its payoff larger: the
picks are now real, so the mis-valuation is now a real mis-valuation rather than
a hang. If #2155 is being sequenced, this is the argument for sooner.

---

**Second, smaller observation, fixed in this PR rather than left as a finding
(recorded here because it is a repeat of a known shape).**
`convex/gre/activationCostPicks.ts`'s `tapOtherCandidates` matched the RAW
`CardInstanceState` against the declared filter, while the server's own scan
(`convex/game.ts`, `tapOtherCandidates`) has always built a
`{ ...c, colors: STATIC_EFFECT_CTX.getColors(c) }` view first. A
`CardInstanceState` carries no `colors` field, so Hand of Justice's "tap three
untapped WHITE creatures you control" (CR 118.8) matched nothing:
`planActivationCostPicks` returned `null` with four white creatures on the
board, and `enumerateMoves` treated the activation as illegal. Dead for the bot
rather than stalling, which is why no stall test caught it. Fixed here with a
regression test
(`src/lib/ai/__tests__/activation-cost-picks-integration.bot.test.ts`), but the
CLASS — a filter evaluated against the raw instance instead of the layered view
— has now bitten at least three sites (`selectAdditionalCost`,
`tapOtherCandidates` ×2). A catalogue-wide guard that every
`matchesPermanentFilter` call site with a `colors`-capable filter goes through
the layered view would be defensible on its own.
