---
title: '"Unless you discard" / "you may discard … if you do" compositions stamp the discard as an effect, not a CR 118.12 cost'
discoveredBy: 3814
status: draft
confidence: medium
---

**What is wrong.** Issue #3814 gave every discard a `DiscardOrigin`. The
`payMayPayCost` hand leg (`convex/gre/state.ts`, `{ kind: "cost" }`) is a CR
118.12 cost, and it is marked as one. The same 118.12 shape written as a
composition goes through `SpellContext.discardCard`, and that call stamps
`{ kind: "effect", controllerId: item.castById }`. The sites:

- `upkeepDiscardOrElseTrigger` (`convex/cards/abilities/upkeepDiscardOrElse.ts:106`,
  used by Solitary Confinement)
- Oath of Lim-Dûl (`convex/cards/sets/ice/black.ts`)
- the ATQ "3 damage unless you discard" card (`convex/cards/sets/atq/colorless.ts`,
  a DSL `if`)
- any DSL "you may discard … if you do" script

So Library of Leng, "If an EFFECT causes you to discard", still applies to
those discards. Its printed ruling says: "You can't use Library of Leng when you
discard a card as a cost, because costs aren't effects."

**Evidence.** In `convex/gre/state.ts`, `discardCard` stamps
`{ kind: "effect", controllerId: item.castById }`, and the `discard` Op has no
way to say "this is a cost payment".

**Why it may not deserve its own issue.** The only replacement affected is Library
of Leng's routing on a self-controlled cost. No catalogued "unless you discard" is
opponent-controlled, so Dodecapod never sees the difference. Fixing it needs a cost
marker on the `discard` Op, or a `discardAsCost` primitive (an eight-site `/new-op`
change). The payoff is one LEA card's may-routing in a corner case.
