---
title: PendingTarget.actingPlayerId is declared but never produced or consulted
discoveredBy: 2283
status: draft
confidence: medium
---

**What is wrong.** `PendingTarget` carries an `actingPlayerId` field documented
as the ADR 0037 Acting Player split ("the player who answers cast-time choices
when split off from the controller for a CONTROLLED cast — Word of Command"),
but nothing writes it and nothing reads it. Every gate that decides who may
answer a target selection keys on `pendingTarget.playerId` alone, so under a
controlled cast the target prompt would be owed to the card's controller rather
than the player actually making the decisions — the opposite of what the field
exists to express.

**Evidence.**

- Declaration: `convex/gre/state.ts:2937` (`actingPlayerId?: string` on
  `PendingTarget`), with the ADR 0037 doc comment.
- All five `state.pendingTarget = {…}` producers set `playerId` and never
  `actingPlayerId`: `convex/game.ts:7031` (`announceCast`),
  `convex/game.ts:12591` (`activateAbility`), `convex/gre/rules.ts:2780`
  (`raiseTriggerTargetSelection`), `convex/gre/state.ts:10152`
  (copy-retarget), `convex/gre/state.ts:14040` (retarget).
- All consumers key on `playerId`: `computeExpectedInput`
  (`convex/gre/expectedInput.ts:59-66` → `playerId: state.pendingTarget.playerId`,
  which is what every mutation's `assertExpectedInput` gate compares against),
  `applyOneTargetSelection` (`convex/game.ts:9406`, "Not your pending target
  selection"), `targetActions` (`convex/gre/legalActions.ts`).
- `getActingPlayer` (`convex/gre/state.ts:1865`) is the helper that WOULD read
  it; it is only ever called on stack items, never on a `PendingTarget`.

**Why it may not deserve its own issue.** It may be genuinely unreachable
today: Word of Command's controlled cast is a `resolve()` protocol card, and if
it never routes a controlled cast through the `pendingTarget` target-selection
flow (rather than resolving targets inside its own closure) then the field is
simply dead code and the fix is deleting it, not wiring it. Deciding which
requires reading Word of Command's controlled-cast path — out of scope for
#2283, which only needed the ANSWERING player, and for the raised origins that
is unambiguously `playerId`. If it turns out a controlled cast can reach here,
this is a real "the wrong player is prompted" bug and deserves a ticket; if not,
it is a one-line cleanup on an existing hygiene tracker.
