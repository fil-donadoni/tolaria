---
title: A standing each-step engine's intervening-if is read as always true — Keldon Twilight's edict fires every end step at full recurrence
discoveredBy: 5575
status: draft
confidence: medium
---

**What is wrong.** Issue #5575 reads Keldon Twilight's end-step edict per side
(`eachStepDifferentialValue`, `convex/gre/ai/opValuers.ts`). The trigger only
fires "if no creatures attacked this turn": that is an `interveningIf` closure
(`convex/cards/sets/pls/multicolor.cards.ts`, `keldonTwilight`). The value model
weighs a conditional ability through `gateWeight` (`convex/gre/ai/cardScriptValue.ts`),
and `gateWeight` reads `ability.gate` only. So the condition is ignored, and the
edict counts as firing on every end step, times the recurrence (issue #5151).
The representative walk had the same gap. The difference now is that the board
sets the size of the swing. On an aggressive board, the bot fears its own
Twilight too much, or values the opponent's too highly.

A smaller skew comes from the same reading. The `controlledSinceTurnStart` filter
is matched against the current board. So a creature cast this main phase is left
out of its controller's side, and the recurrence multiplies that snapshot.

**Evidence.** `gateWeight` has no `interveningIf` branch. `phaseTrigger`'s
`interveningIf` is a closure the value model cannot ground. Found by the
issue #5575 review.

**Suggested direction.** Any `interveningIf` the value model cannot ground
should weigh as `gate: { undecidable: true }` does, as Mask of Intolerance's
trigger already declares. The alternative is a declarative condition the lens
can read per side.

**Since issue #5574 landed.** `eachStepDifferentialValue` now takes the
trigger's `interveningIf` as a per-side step gate (`stepGateOf`,
`convex/gre/ai/cardScriptValue.ts`), so the condition is no longer ignored. It
is still asked of the CURRENT board: "no creatures attacked this turn" holds in
a precombat main phase, and the recurrence multiplies that snapshot. The
residue is the snapshot reading, not a missing gate.
