---
title: diedTrigger drops targetRequirement, so a compiled dies trigger loses its target
discoveredBy: 4299
status: draft
confidence: high
---

**What is wrong.** `resolveCompiledTrigger` (`convex/cards/compiledTriggers.ts`) spreads
`descriptor.targetRequirement` into the args of every trigger factory, but
`diedTrigger` (`convex/cards/abilities/triggers/diedTrigger.ts`) declares no
`targetRequirement` field and never writes one onto the ability it builds
(`enteredTrigger` and `attacksTrigger` both do). A compiled "When this creature
dies, return target creature card from your graveyard to the battlefield" therefore
carries `effects: [{ op: "moveZone", target: { target: 0 } }]` on an ability with
NO announced target.

**Evidence.** Rebuilt from the lockfile row: Driver of the Dead's descriptor has a
`targetRequirement`, the `TriggeredAbility` `resolveCompiledTrigger` returns has
`targetRequirement === undefined`; Bishop of Rebirth (an `attacks` head) keeps it.
The smoke gate quarantines both dies-trigger cards today (its form reads
`slot zone battlefield` off the rebuilt ability instead of `graveyard`), which is
why Archon of Falling Stars and Driver of the Dead stayed out of the ready delta
of issue #4299 — the gate, not the compiler, is what is catching it.

**Why it may not deserve its own issue.** It is defensible without the card that
surfaced it: any compiled dies-head trigger with a target has the same dangling
`{ target: N }`. Likely a small fix (carry the field like `enteredTrigger` does) plus
a golden over a dies-trigger with a target, after which those two cards graduate.
