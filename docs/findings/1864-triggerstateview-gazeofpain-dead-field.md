---
title: TriggerStateView.gazeOfPainActiveThisTurn is declared but never populated or read
discoveredBy: 1864
status: draft
confidence: high
---

**What is wrong.** `TriggerStateView` declares an optional
`gazeOfPainActiveThisTurn` mirroring `GameState.gazeOfPainActiveThisTurn`, but
nothing in `src/` ever writes it and nothing ever reads it. The view reducer
`buildTriggerStateView` (`src/lib/card-utils.ts`) does not set the field, so
every client-side consumer that might gate on the Gaze of Pain rider sees
`undefined` regardless of the real game state. This is the drop-symptom shape
the frontend-wiring table in `.claude/rules/gre-development.md` names: an
ability is never offered because a view field was never carried.

**Evidence.** `convex/cards/types.ts:9103` declares it. `grep -rn
"gazeOfPainActiveThisTurn" src` returns nothing — no writer in
`buildTriggerStateView`, no reader in `getStackAbilities` or any `canActivate`
predicate. Server side the flag is live and correct
(`convex/gre/state.ts`, `convex/gre/phases.ts` — #1864 just extended its
lifetime to the whole turn, which is what drew attention to it).

**Why it may not deserve its own issue.** The field may be dead by design: Gaze
of Pain's rider drives a graveyard-zone TRIGGERED ability that fires on
`ATTACKER_UNBLOCKED`, and a trigger needs no client affordance, so there may
never have been a consumer to write. If so the fix is a one-line deletion of
the declaration, not a wiring ticket — which makes this a line on an existing
dead-code sweep rather than a ticket of its own. It earns a ticket only if some
client surface is in fact meant to gate on the rider and silently does not.
