---
title: The bot's search slice never pays a `discardThis` activation cost, so cycling is free in the tree
discoveredBy: 2442
status: draft
confidence: medium
---

**What is wrong.** `applyMoveForSearch`'s `activate-ability` branch applies the
cost legs that change the board — `cost.tap`, `cost.sacrifice`, and (for a
graveyard source) `cost.exileThis` — but never `cost.discardThis`. It also only
ever locates the source on a **battlefield** or in a **graveyard**; a HAND
source (`activateFromHand`, i.e. every cycling and typecycling card) is never
found at all. Inside the ISMCTS tree a cycled card therefore stays in hand: no
`CARD_DISCARDED` event, no Marauding Mako growth, no "when you cycle this card"
trigger (CR 702.29c, the capability this issue adds), and a leaf hand size one
card too large. The search evaluates cycling as a pure card-draw with no cost.

**Evidence.** `convex/gre/applyMove.ts:400` opens the branch;
`convex/gre/applyMove.ts:411-415` scans battlefields only;
`convex/gre/applyMove.ts:424-439` adds the graveyard-source fallback for
`cost.exileThis`; `convex/gre/applyMove.ts:446-462` applies `cost.tap` /
`cost.sacrifice`. `grep -n "discardThis" convex/gre/applyMove.ts` returns
nothing, while the real commit paths pay it at `convex/game.ts:2864`,
`convex/game.ts:6021` and `convex/game.ts:13023`. The one `discardToGraveyard`
call the file does make (`convex/gre/applyMove.ts:532`) is the _filtered_
discard cost's named picks (Survival of the Fittest), a different cost leg.

**Why it may not deserve its own issue.** The file header documents that the
search slice applies costs only and deliberately does not resolve the ability's
payoff, so some divergence is by design, and `docs/findings/1209-applyMoveInSearch-park-costs.md`
already records a neighbouring gap in the same function — this may belong as a
line there rather than a ticket of its own. The practical impact is also bounded
today: no catalogue card has a "when you cycle this card" trigger, and cycling's
own payoff (draw a card) is not simulated either, so the two errors partly
cancel. It becomes real the moment a discard-matters card (Marauding Mako is
already shipped) is in the bot's deck.
