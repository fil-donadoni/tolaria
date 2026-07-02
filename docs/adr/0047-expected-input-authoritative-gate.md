# Expected Input as the authoritative gate (and why not a full FSM)

## Status

accepted

## Context

The game's waiting-state machine exists but is implicit, factored across
independent fields: `phase` × `priorityPlayerId` × `passCount` × `stack` ×
`pendingCast` / `pendingActivation` / `pendingTarget` / `pendingChoices`.
Behaviour is correct and tested, but there is no single point that answers
"what is the game waiting for, from whom?". Every consumer re-derives it (UI,
bot, timeout), every mutation re-validates "is this action legal now?" on its
own, and nothing structurally prevents absurd field combinations
(pendingTarget and a pending choice simultaneously). A full rewrite into an
explicit textbook FSM was seriously considered — no live users, appetite for
heavy refactoring — and rejected on domain grounds, not caution.

## Decision

**The engine maintains an authoritative `expectedInput` field, and every game
mutation is gated through it.**

- `expectedInput` is a discriminated union — `choice | target | priority |
  blockers | …` — each variant carrying the acting player and the legal input
  shape. It is *maintained* at every stable point (set when a choice is
  enqueued, recomputed when it resolves), not derived on read.
- **One gate.** Every game mutation first checks the submitted action against
  the current `expectedInput`. "Are you allowed to do this now?" lives in one
  place instead of ~15.
- **Runtime invariant** (asserted in tests and dev): the scattered pending*
  fields must be consistent with `expectedInput` — incoherent combinations
  become loud errors instead of silent bugs.
- The union is the single contract for UI rendering, bot decision-typing, and
  timeout ownership; adding a waiting-kind forces every consumer through the
  compiler. It also yields `legalActions(state)` — the move enumeration
  ISMCTS needs.

**Why not the full FSM rewrite:** an MTG game state is inherently
hierarchical — mid-resolution of a stack item, suspended on a choice, with a
second choice queued, during a combat step. A flat state enum must encode
this combinatorially and ends up re-embedding the composite fields inside
each state; the existing factored fields *are* the correct representation of
a hierarchical machine. The rewrite would touch `game.ts`, `state.ts`,
`phases.ts`, `stack.ts`, the timeout scheduler, solo mode, the bot, and
thousands of test anchors — weeks of high-regression work concurrent with the
Effect Script migration (ADR 0045), which needs a green, stable base — for a
marginal solidity delta over the gate: reified transition tables are ceremony
here, not rigour.

This decision closes no doors: `expectedInput`'s union is exactly the state
type a full FSM would use. If reified transitions ever prove necessary, they
build *on top of* this gate with ~zero sunk cost.

## Consequences

- The "state machine with every stop enumerated" exists as a type; the
  compiler enforces exhaustive handling in every consumer.
- The Effect Script interpreter suspends/resumes scripts around choices at
  the same gate — one suspension model for both authoring worlds.
- Mutation-level validation code shrinks to per-action semantics; the
  "right moment, right player" check is inherited from the gate.
- The invariant assert will surface any latent field-combination bugs in the
  existing engine during rollout — expected and desirable.
