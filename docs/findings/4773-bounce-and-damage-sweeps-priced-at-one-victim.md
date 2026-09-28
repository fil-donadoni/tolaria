---
title: Bounce, damage and subtype-filtered sweeps still sit in hand at one representative victim
discoveredBy: 4773
status: triaged
issue: 4781
confidence: medium
---

**What is wrong.** Issue #4773 taught `evaluate`'s hand term to price a
`forEach` over the battlefield by the NET realised loss it inflicts
(`LatentLens.sweepUnits`, `convex/gre/ai/latentBoard.ts`), but only for a body
that is nothing but `destroy` / `exile` of `$each` under a `type` /
`excludeType` filter (`sweptForEachValue`, `convex/gre/ai/opValuers.ts`).
Every other sweep keeps the context-free price — ONE representative victim,
whatever the board holds, the caster's own members never subtracted:

- bounce sweeps (`moveZone $each` to hand — Evacuation and ~7 others);
- damage sweeps (`dealDamage $each` — Pyroclasm and ~17 others);
- destroy sweeps under a subtype / colour filter (Flashfires and ~7 others);
- a body with an `if` around the removal (March of Souls).

The same symmetric-sweep mispricing: casting one with the opponent ahead in
what it hits can read as a loss at 1 ply, and one that would take more of the
caster's board than the opponent's still reads as latent worth in hand.

**Evidence.** Review of the issue #4773 PR ran a catalogue scan: 121 `forEach`
loops over `set: "permanents"`, 14 reached by the fix.

**Why it may not deserve its own issue.** Each family needs its own per-member
loss model — a bounce returns the card (tempo, not removal), a damage sweep
kills only what its damage exceeds — so the class is three slices, and the
botReach sweep already passes these cards today (by noise, possibly, as
Armageddon did). It is an issue once one of them is measured flipping.
