# Attack with All + Sequential Attack-Target Selection

**Date:** 2026-07-23
**Status:** Approved (design)

## Problem

During `DECLARE_ATTACKERS` the active player must click each creature
individually to declare it as an attacker. There is no one-click "attack with
everything". Separately, when the defending player controls planeswalkers, an
attacker's destination (defending player vs. a specific planeswalker, CR 508.1a
/ issue #1220) is chosen ad-hoc by clicking a planeswalker, which retargets the
`most-recently declared` attacker — awkward when many attackers need distinct
destinations.

Goal: add an **"Attack with all"** button that declares every eligible creature,
then — mirroring MTG Arena — walks the player through choosing a destination for
each attacker, one at a time, when more than one destination exists.

## Scope

Client-only (design option B). **No new `GameState` field**, no changes to
`serialize.ts` or `gameProjections.ts`. The sequence cursor lives in React
state on the active player's client. Because attacker declaration is not yet
confirmed while the sequence runs, the opponent does not act on it — so
client-only carries no correctness cost. Trade-off accepted: no resume across a
reload mid-sequence (the attackers stay declared vs. the player; the user simply
re-enters target selection).

Touched files:

- `src/hooks/useControllerActions.ts` — new button + sequence lifecycle
- `src/hooks/useBattlefieldInteraction.tsx` — route PW clicks to the current
  sequence attacker
- `src/hooks/useBattlefieldVisualState.ts` — dedicated ring on the current
  attacker
- new shared React state for the sequence (hook `useAttackAllSequence` or state
  threaded through the existing combat/controller context — pick during
  planning, whichever avoids prop-drilling per frontend rules)
- parallel test files (see Testing)

Existing server mutation `toggleAttacker` (with optional `planeswalkerId`) is
reused unchanged.

## Domain facts

- 2-player only. The single defending player + their planeswalkers are the only
  legal attack destinations (CR 508.1a). "Multiple destinations" ⇔ the defender
  controls ≥1 planeswalker.
- Eligibility is decided server-side by `validateAttackerEligibility`
  (untapped, not summoning-sick unless haste, no "can't attack", must-attack
  handling, attacker cap). The client uses ONE shared predicate for both the
  board's graying and the button's "all" set, so those two can never drift from
  each other.
- **The client predicate is a strict SUBSET of the server's**, and deliberately
  so: `cantAttackThisTurn`, the registry-driven keyword restrictions, Arboria,
  Island Sanctuary and the attacker cap live in the engine and are not on the
  wire (this is the pre-existing state of the board's own gray-out gate, not a
  new gap). The button therefore treats a per-creature server rejection as
  normal: each toggle is dispatched and tolerated independently, and the
  sequence walks the attackers that were ACTUALLY declared, never the
  optimistic client list. Closing the subset gap would mean projecting those
  fields onto the wire — out of scope here.

## Design

### 1. Sequence state (React, not serialized)

```ts
{ active: boolean; order: string[]; index: number }
```

- `order` — the declared attacker instance ids, in declaration order.
- `index` — the attacker currently choosing a destination.
- Owned by the active player's client only.

### 2. "Attack with all" button

In `useControllerActions.ts`, inside the `isSelectingAttackers` branch, added
alongside `confirm-attackers`:

- Compute the eligible-creature set with the shared client predicate
  `eligibleAttackerIds` (`src/lib/attacker-eligibility.ts`) — the subset of
  `validateAttackerEligibility` expressible on the wire (see Domain facts).
- **onClick:** declare every eligible creature vs. the defending player —
  `toggleAttacker` for each not-already-selected creature (ignore any partial
  manual selection = option A, Arena behavior). Each toggle is awaited and its
  rejection tolerated INDIVIDUALLY, so one server-refused creature neither
  aborts the run nor leaves the board half-declared with no sequence.
- Then branch on the defender's planeswalker count:
    - **0 planeswalkers** → call `confirmAttackers` immediately (no destination
      choice is possible).
    - **≥1 planeswalker** → start the sequence: `active=true`,
      `order = the ids actually declared` (pre-existing declarations plus the
      toggles the server accepted), `index=0`.
- Omitted entirely when there is no eligible creature — a permanently dead
  button is worse UX than no button.

### 3. Destination sequence (defender has ≥1 planeswalker)

- The attacker `order[index]` gets a **dedicated ring** (see §5) on the active
  player's own board.
- Default destination is the defending player (the attacker was already
  declared that way by the "all" step).
- Interactions on the current attacker:
    - **Click an opponent planeswalker** → `toggleAttacker({ planeswalkerId })`
      for `order[index]`, then `index++`. Skipped when that attacker is ALREADY
      on that planeswalker: the server reads a repeat `planeswalkerId` as a
      toggle-OFF back to the defending player, which would silently undo the
      choice the click expresses.
    - **Keep on the player and advance** → Space, or a primary "Next" button →
      `index++` with no mutation.
- The primary controller button during the sequence shows progress, e.g.
  `Assign target (2/4)`, and drives "Next". `Confirm Attackers` is disabled
  while `active` is true.
- When `index >= order.length`: `active=false`; the button reverts to
  `Confirm Attackers (N)`.

### 4. Click routing

In `useBattlefieldInteraction.tsx`: when `sequence.active` and the user clicks
an opponent planeswalker, the attacker to (re)target is `order[index]` — NOT the
existing "most-recently declared attacker not already attacking it" heuristic.
Outside the sequence, the current free-retarget behavior is unchanged.

### 5. Current-attacker ring (dedicated)

New visual flag in `useBattlefieldVisualState.ts` marking `order[index]`. Render
a **dedicated ring** (emerald pulse, consistent with the selection-ring
treatment in `feedback_selection_ring_unstack`), distinct from the gold
"declared attacker" styling — so the user can tell "already declared" from "now
choosing this one's target". Reuse the existing ring infrastructure; add a new
color/variant, do not fork the layout.

### 6. Exit / cancel

- Space = Next during the sequence.
- A "Cancel" controller action resets the sequence (`active=false`); the
  attackers stay declared vs. the defending player and the user falls back to
  free retargeting. Pass Turn is unchanged.

## Testing

- `useControllerActions` test: button appears in DECLARE_ATTACKERS for the
  active player; declares all eligible creatures; 0-PW defender → immediate
  confirm; ≥1-PW defender → sequence starts.
- `useBattlefieldInteraction.attackTarget.test.tsx`: while the sequence is
  active, clicking a planeswalker targets `order[index]`, not the last-declared
  attacker; `index` advances.
- `useBattlefieldVisualState.attackTarget.test.tsx`: the current attacker
  carries the dedicated ring flag; it moves with `index`.
- Eligibility parity: the client "all" set equals the set the server accepts via
  `validateAttackerEligibility` (shared predicate — assert no divergence).

## Out of scope

- Server-side / serialized sequence state (option A) — no resume across reload.
- 3+ player attack-target selection (engine is 2-player).
- Banding interactions with the "all" button beyond the existing manual flow.
