---
title: DurationSpec `player: "controller"` means the EFFECT's controller, but Orcish Farmer's Oracle means the affected land's
discoveredBy: 2380
status: draft
confidence: medium
---

**What is wrong.** `DurationSpec.player: "controller"` is resolved against the
controller of the effect that created the duration — never against the
permanent the effect is applied to. Orcish Farmer's Oracle text is "Target land
becomes a Swamp until **its controller's** next untap step", and the card's own
comment claims that reading. The two coincide only when the Farmer's controller
also controls the targeted land; targeting an OPPONENT's land currently reverts
the type change at the Farmer controller's untap step instead of the land
controller's — usually a turn early or a turn late.

(This finding is a by-product of #2380: Jace, Telepath Unbound's +1 is "−2/−0
until **your** next turn", which wants the effect-controller reading and is
therefore correct under the current semantics. The same spec field means two
different things for the two cards.)

**Evidence.**

- `convex/gre/state.ts:211` — `resolveDuration(spec, controllerId, state)`:
  `if (spec.player === "controller") playerId = controllerId;` where
  `controllerId` is the resolving effect's controller.
- `convex/cards/types.ts:1376-1379` — the `DurationSpec.phase` doc says
  `untap` "combined with `player: "controller"` to scope to **the affected
  permanent's controller**, e.g. Orcish Farmer" — which is not what
  `resolveDuration` does.
- `convex/cards/sets/ice/red.ts:1811` repeats the affected-permanent reading in
  the card comment.
- `convex/cards/sets/ice/__tests__/red.test.ts:1768` only exercises the
  same-controller case (the Farmer and the land are both p1's), so the
  divergence is invisible to the suite.

**Why it may not deserve its own issue.** Orcish Farmer is the only shipped
card relying on the affected-permanent reading, and the mis-scoped boundary is
at most one turn off on a marginal card. The cheap half of the fix — correcting
the two doc comments so nobody else authors against the wrong meaning — may be
all that is worth doing; the expensive half (a third `player` value meaning
"the affected permanent's controller", threaded through `resolveDuration`'s
callers) is only worth it if a second card needs it.
