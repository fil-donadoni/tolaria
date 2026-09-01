---
title: The dies/LTB trigger look-back scans the graveyard CARD, so a Clone that had become something loses that thing's own leave triggers
discoveredBy: 2075
status: draft
confidence: high
---

**What is wrong.** CR 603.10's look-back is implemented by re-scanning the
departed permanent in its destination zone, and the object found there has
already had its identity reverted — so the abilities scanned are the PRINTED
card's, not the ones the permanent had when it left. A Clone that had become
Vaultborn Tyrant, or a transformed back face carrying its own dies trigger, dies
and simply never puts that trigger on the stack.

**Evidence.** `convex/gre/triggers.ts:365-372` pushes `player.graveyard` entries
whose id is in `recentlyDead` onto the `sources` list, then reads
`(permanent.card as { id?: string }).id` at `:396` to look the abilities up. But
`removePermanentTo` (`convex/gre/state.ts`) runs `revertCopy`, `revertTransform`
and `turnFaceUp` on the way out — CR 707.2 / 712.8a / 708.9 all require that — so
by the time the scan runs, `card.id` is the printed front-face id. The same
applies to the `recentlyLeft` zone scan a few lines below (`:371-393`).

The store this issue shipped, `GameState.lastKnownCopiable`, already holds the
right answer for exactly these ids: it is written at the same funnel, _before_
those three reverts, and keyed by instance id. A fix is plausibly "when the
scanned source is a recently-departed one, resolve its abilities through the LKI
defId rather than through `card.id`".

**Why it may not deserve its own issue.** It is invisible today: no shipped card
combination reaches it that I could find, because it needs a copy/transform
effect to have granted the departing permanent a leave trigger it does not
print, and the two shipped `createTokenCopy` leave-triggers (Vaultborn Tyrant,
Dance of Many) are both on printed cards whose graveyard identity agrees with
their battlefield one. It is also not a one-line fix: the scan feeds every
`CREATURE_DIED` and `PERMANENT_LEFT` trigger in the engine, so changing which
definition it reads is a blast radius well beyond one card. Might be better as a
line on an existing LKI/trigger tracker than a ticket of its own.
