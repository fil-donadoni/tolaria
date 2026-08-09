---
title: exileOnResolve is only honoured at resolution, so a COUNTERED Flashback (or Jace −3) spell lands in the graveyard
discoveredBy: 2380
status: draft
confidence: medium
---

**What is wrong.** `StackItem.exileOnResolve` is the engine's single
"exile this card as it leaves the stack" flag. CR 702.34a says a Flashback
spell is exiled "instead of putting it anywhere else any time it would leave
the stack" — including when it is COUNTERED (CR 701.5a puts a countered
spell into its owner's graveyard, which the Flashback replacement then
overrides). The engine only checks the flag on the resolution path, so a
countered Flashback spell goes to the graveyard and can be flashed back
again.

Shipped as of #2380, Jace, Telepath Unbound's −3 rides the same flag ("If
that spell would be put into your graveyard, exile it instead"), so it
inherits exactly the same gap — a countered spell cast under the grant
returns to the graveyard and is castable again next turn.

**Evidence.** `convex/gre/state.ts:5812` is the only read of
`item.exileOnResolve` outside serialization/copy-clearing:

- set at cast-commit — `convex/game.ts` `flashbackStackFlags` /
  `graveyardCastStackFlags` (the #2380 branch is the third caller);
- consumed only inside `finalizeSpellResolution` (`convex/gre/state.ts:5812`);
- the counter path (`SpellContext.counter` → the countered item's move to the
  graveyard) never consults it. `grep -n exileOnResolve convex/gre/state.ts`
  returns no hit inside the counter/leave-the-stack code.

**Why it may not deserve its own issue.** It is a Flashback bug that predates
#2380 by a long way and needs a countered-Flashback board to observe; nobody
has reported it. If the fix is one line at the counter site, it is arguably a
line on the flashback row rather than a ticket of its own — but note that the
right shape is probably a shared "spell leaves the stack" chokepoint, since
`shuffleIntoLibraryOnResolve` and `reboundFromHand` have the identical shape
and the identical gap.
