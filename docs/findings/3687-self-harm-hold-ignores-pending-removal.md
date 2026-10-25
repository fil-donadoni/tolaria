---
title: the self-harm hold reads a flicker in response to removal as self-harm, so the Bot lets its creature die
discoveredBy: 3687
status: draft
confidence: medium
---

**What is wrong.** The root rule `self-harm-removal` (`isSelfHarmRemovalCast`,
`convex/gre/search.ts`) holds a self-targeted cast over an outcome-equal pass
when `resolvedMarginDelta` is negative. That delta compares the margin AFTER
the settled stack with the margin of the root position — where an opponent's
removal spell is still on the stack and the creature it targets is still
counted. So a flicker cast in response (All Aboard, Ephemerate, Momentary
Blink) reads as "spent a card, gained nothing": the creature it saves was
already on the "before" board. The hold picks `pass`, and the removal resolves.

**Evidence.** During issue #3687 a blade position — a prepared Skycoach
Conductor, one Island, a Serra Angel targeted by the opponent's Swords to
Plowshares on the stack — had the Bot pass with `mechanism:
"self-harm-removal"` at 400 iterations, while the engine (applyMoveInSearch +
resolve) confirms the flicker makes the Swords fizzle and keeps the Angel. The
shipped `must` entry uses an enters-trigger re-buy (Flametongue Kavu) instead,
whose margin gain the delta does see.

**Why it may not deserve its own issue.** It is a valuation of the hold's
baseline, not of the prepare mechanic; it may belong as a line on the Bot
roadmap tracker beside the other "pass-line baseline" margin reads. The same
shape hits any self-targeted answer whose payoff is the opposing spell
fizzling, so it is defensible without the card.
