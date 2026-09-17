---
title: The CR 606.3 loyalty tally survives a zone change, so a recast planeswalker keeps the turn's spent activation
discoveredBy: 3339
status: draft
confidence: medium
---

**What is wrong.** CR 400.7 — a permanent that leaves the battlefield and comes
back is a NEW object, and CR 606.3's "no player has previously activated a
loyalty ability of that permanent that turn" is about the permanent, so the
returning object is owed a fresh allowance. The per-instance tally is never
cleared on a zone change, so it rides back in and the mutation refuses the
activation.

**Evidence.** `resetBattlefieldTransientState` (`convex/gre/state.ts`) clears
`activationsThisTurn` (CR 602.5) and `triggersThisTurn` (CR 603.2) under an
explicit CR 400.7 comment, but not `loyaltyActivationsThisTurn`. Scenario:
activate Liliana of the Veil's `+1`, bounce her with Boomerang, recast her the
same turn — `loyaltyActivationViolation` still returns `"already-activated"` on
the new permanent, and the enumerator, the search and the client hint all agree
with it, because they share the predicate.

**Not a regression from issue #3339.** The boolean lock this tally replaced had
the identical gap; the generalisation only moved the field three lines away from
the two tallies that ARE cleared there, which is what made it visible.

**Why it may not deserve its own issue.** It is one line in an existing reset
walk, and no shipped board reaches it in ordinary play (bouncing and recasting
your own planeswalker in the turn you activated it). It may read better as a
line on whichever CR 400.7 / transient-state tracker is live than as a ticket of
its own — but it IS defensible without the card that surfaced it, since it is a
rule the engine states and does not keep.
