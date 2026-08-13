---
title: State-triggered abilities (CR 603.8) reach the stack with no mode and no target announcement
discoveredBy: 2461
status: draft
confidence: medium
---

**What is wrong.** Every path that puts a triggered ability on the stack runs
the announcement sweep `raiseTriggerTargetSelection` — targets since #1193, and
the CR 603.3c mode announcement since #2461 — except one.
`applyStateTriggers` (`convex/gre/triggers.ts:706`, called from
`convex/gre/sba.ts:868`) pushes CR 603.8 state-triggered abilities straight onto
the stack and hands priority to the active player without calling it at all. A
state trigger with a `targetRequirement` therefore reaches resolution with
`targets === undefined`, and a modal one (`TriggeredAbility.modes`) reaches it
with no `chosenModeId`, where the resolution dispatch finds no mode and the
ability resolves as nothing (`convex/gre/state.ts`, triggered branch).

**Evidence.**

```ts
export function applyStateTriggers(state: GameState): boolean {
    const triggers = collectStateTriggers(state);
    if (triggers.length === 0) return false;
    state.stack.push(...triggers);
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
    return true;
}
```

No `raiseTriggerTargetSelection`, unlike `placeTriggersOnStack`
(`triggers.ts:854`), the `trigger-order` submit (`pendingChoiceSubmit.ts:769`),
`applySelectTarget`'s trigger branch (`pendingTargetOrigin.ts:277`) and
`cancelTriggerTargetSelection` (`game.ts:10129`). The target half of the gap
predates #2461 — the mode half is inherited by the same omission, not created
by it. `resolveManaAbilityTriggerImmediately` (`convex/gre/state.ts:4497`) is a
second bypass, but CR 605.4a arguably excuses that one: a mana ability's trigger
resolves immediately and never uses the stack.

**Why it may not deserve its own issue.** Nothing in the catalogue is affected
today: `collectStateTriggers` only builds items for abilities whose `event` is
`STATE_CHECK`, and no shipped card pairs that event with either a
`targetRequirement` or `modes` — so the gap is unreachable until the first
targeted or modal state trigger is authored. That makes it a line on a
state-trigger tracker (or a one-line hardening in whichever PR ships that card)
rather than a ticket of its own. The counter-argument for a ticket: the fix is
three lines and the failure mode is silent — a card author would ship a state
trigger that announces nothing, pass every per-card test, and see it resolve as
a no-op with no error anywhere.
