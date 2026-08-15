---
title: CR 514.3a's state-based-action half is unimplemented — no phase entry anywhere checks SBAs
discoveredBy: 2472
status: draft
confidence: medium
---

**What is wrong.** CR 514.3a's condition is _"the game checks to see if any
state-based actions **would be performed** and/or any triggered abilities are
waiting to be put onto the stack"_. #2472 implemented the second half only. The
canonical first-half case — an "until end of turn" pump ending at CR 514.2 drops
a creature to 0 toughness — grants no priority window and starts no additional
cleanup step; the creature instead dies during the next turn's UPKEEP, when the
first mutation-level SBA check runs.

**Evidence.** `convex/gre/phases.ts:2131` (`openCleanupPriorityWindow`) keys the
whole window on `state.stack.length > stackBefore` — a proxy for "a trigger was
put on the stack", with nothing standing in for the SBA disjunct.
`grep -n checkStateBasedActions convex/gre/phases.ts` returns **nothing**: the
engine's SBA seam lives in the `convex/game.ts` mutation layer, which runs after
`advancePhase` has already recursed into the next turn.

The gap is therefore **not specific to the cleanup step**. No phase entry
anywhere in `phases.ts` checks state-based actions, so the same "SBAs are one
mutation late" shape exists at every phase boundary; cleanup is only where CR
names the check explicitly, which is what makes it visible.

**Why it may not deserve its own issue.** Fixing it properly means calling
`checkStateBasedActions` from inside the phase machine, which changes when
creature deaths and their death triggers land at _every_ phase transition — a
cross-cutting behaviour change with a much larger blast radius than the cleanup
step, and one that needs a decision about where the resulting triggers get their
priority window. Meanwhile the observable difference is one step of latency in a
step that grants no priority, and no shipped card depends on it. Probably a line
on a partial-implementation tracker (alongside
`2472-cleanup-step-printed-triggers.md`, which is the same "CLEANUP is an
auto-phase" root) rather than its own ticket — unless a card lands that reads
board state between the two points.
