---
title: The Bot can now reach Arena of Glory's costed mana option but never picks it
discoveredBy: 3359
status: draft
confidence: high
---

**What is wrong.** Issue #3359 made the costed mana option a real candidate: on a
board of Arena of Glory plus a Mountain, a creature cast is now offered TWO tap
plans — the free `{T}: Add {R}` one and the one that funds `{R}` from the
Mountain and exerts Arena for `{R}{R}` plus the haste rider. The search takes
the free plan every time. So the card's second half is reachable and correctly
priced, but nothing the evaluation can see makes it worth reaching for: the
rider's payoff is a creature attacking one turn earlier, which is washed out at
the search horizon exactly as combat quality is.

**Evidence.** Measured on this branch with `runBladeScenario` (Arena of Glory +
Mountain on the battlefield, Goblin Ski Patrol in hand, PRECOMBAT_MAIN, turn 3,
200 iterations, seed 727774): the chosen move was
`cast-spell taps=[Arena of Glory, Mountain]` with `manaChoiceIndex: 0` — the
free option. The costed candidate is present in the same position's move set
(`castTapPlans`, `convex/gre/moves.ts`), so this is a valuation gap and not a
reachability one.

**Why it may not deserve its own issue.** It is a PREFERENCE, and ADR 0124 §5
says a preference is settled by a Verdict plus a weight fit, never by a
hand-written rule or a hand-written blade entry — which is also why issue #3359
ships no `must` entry claiming the costed pick. The right shape is probably a
Verdict on this position feeding the corpus, plus whatever term prices "this
creature can attack this turn"; that may already be somebody's open line rather
than a new ticket. What would make it a ticket of its own is a second carrier
whose costed option buys something the evaluation ALREADY reads (extra net mana,
say) and is still never chosen.
