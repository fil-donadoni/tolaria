---
title: tappedTrigger and stateTrigger drop a compiled targetRequirement
discoveredBy: 5699
status: draft
confidence: medium
---

**What is wrong.** `resolveCompiledTrigger` (`convex/cards/compiledTriggers.ts`)
spreads the descriptor's `targetRequirement` into the args of every trigger
factory, but `tappedTrigger` and `stateTrigger` never read it, so the built
`TriggeredAbility` has no requirement and the trigger goes on the stack
announcing no target (CR 603.3d). `diedTrigger` had the same hole; issue #5699
fixed it because Shambling Swarm's compiled dies trigger announced nothing.

**Evidence.** `grep -c targetRequirement` is 0 in
`convex/cards/abilities/triggers/tappedTrigger.ts` and `stateTrigger.ts`, while
`leftTrigger.ts` / `enteredTrigger.ts` forward it verbatim. The spread compiles
silently because TypeScript does not excess-check a spread object.

**Why it may not deserve its own issue.** It bites only when the grammar lowers
a TARGETED effect under a "becomes tapped" or state head; whether any `ready`
card does today was not checked. A generic test — every compiled head kind keeps
a descriptor's `targetRequirement` — would close the class.
