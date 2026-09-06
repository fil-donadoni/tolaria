---
title: addContinuousEffect syncs only layer 6, so a layer-2-to-5 entry leaves the board unrecomposed
discoveredBy: 3094
status: draft
confidence: medium
---

**What is wrong.** `SpellContext.addContinuousEffect` — the one producer that
writes onto `GameState.continuousEffects` today — calls `syncLayer6(state)` and
nothing else. An entry it adds in layer 2, 3, 4 or 5 therefore leaves
`controllerId`, the battlefield arrays, `types`, `subtypes`, the colour and
supertype rows untouched until the next unrelated stable-point sync happens to
run. The primitive is general over `ContinuousEffectSlot` (`layer: 2 | 3 | 4 | 5
| 6 | 7`); only its recompute is layer-6-shaped.

**Evidence.** `convex/gre/state.ts:16679` — `syncLayer6(state);` with no
`syncLayers2to5(state);` beside it, at the end of `addContinuousEffect`.
Every other writer in that file pairs the two (`convex/gre/state.ts:8031-8032`,
`8087-8088`, `8129-8130`, `8161-8162`) and `unapplySourceStaticEffects`
documents why: CR 613.1 recomputes over one board, so both halves run together.

Unreachable today — the only caller is Dread Wight
(`convex/cards/sets/ice/black.ts:704,715`) and both of its entries are layer 6.
It is, however, the one seam that can produce the state PRD #2064 S5 leaves
unguarded: a permanent whose derived `controllerId` (CR 613.1b) disagrees with
the battlefield array it sits in. The wire now carries the derived controller
(`convex/gre/wireCharacteristics.ts`) while the client still renders per array,
so the two would disagree on screen with no test to red.

**Why it may not deserve its own issue.** PRD #2064 S6 rewrites every producer
in this area, and it may fix this by construction; the fix is also one line
(`syncLayers2to5(state)` beside the existing call, or an assertion that the
entry's layer is 6). If S6 is close, this is a line on #2064 rather than a
ticket of its own — but it should not be discovered a third time, and the
control-vs-array divergence it enables is a UI-visible bug, not an engine-only
one.
