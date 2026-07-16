# Brainstorm "put back 2 on top" — scry-like drag picker

**Date:** 2026-07-16
**Status:** design approved, pre-plan
**Prototype:** `src/routes/prototype/put-back/` (verdict captured in its `NOTES.md`)

## Problem

Brainstorm resolves as `draw 3` then `putBack 2` (`convex/cards/sets/ice/blue.ts`).
The GRE is complete: `putBack` (`convex/gre/effects/interpreter.ts`) raises a
single suspending `choose-hand-card` PendingChoice over the caster's own hand,
`count: 2`, and on resume moves each pick to the library top via
`moveHandCardToLibraryTop` — the pick ORDER is the resulting top order (last pick
= topmost).

Today the client surfaces an own-hand `choose-hand-card` as the generic banner +
in-hand click-toggle. There is no visualization of the library, and ordering is
implicit in click order. We want the **scry-like drag picker**: the hand shown as
a fan on the left, a mocked library on the right, drag exactly 2 hand cards onto a
single TOP-of-library zone, reorder them by dragging (right = top, higher
z-index + slight lateral offset) — the exact `LibraryOrderPicker` top-zone
mechanic.

## Approved shape

Reuse `LibraryOrderPicker` (`src/components/board/library-order/`) — **not** a new
component. Add a `putBack` mode, sibling to the existing `distribute` mode. The
mechanic is `distribute` inverted:

| mode                            | left zone                  | right zone (keep exactly N)    | confirm sends                                   |
| ------------------------------- | -------------------------- | ------------------------------ | ----------------------------------------------- |
| `distribute` (Impulse/Stock Up) | BOTTOM pool                | HAND                           | right → hand, left → bottom                     |
| **`putBack` (Brainstorm)**      | **HAND** pool (whole hand) | **TOP OF LIBRARY** (exactly 2) | right topmost-first → picks; **left → nothing** |

Both start with every card in the LEFT zone and pull exactly `keep` into the
RIGHT zone; the right zone is the ordered fan with `right = top`, insertion
drag-reorder, deferred-commit pointer capture. Only three things differ from
`distribute`: the zone labels (`HAND` / `TOP OF LIBRARY`), and the confirm caller
submits ONLY the right array (topmost-first) and ignores the left (those cards are
already in hand and move nowhere).

## Components & changes

### 1. `LibraryOrderPicker` — add `putBack` mode

- Add an optional `putBack?: { keep: number }` prop, mutually exclusive with
  `distribute`. Internally it reuses the `distribute` strip mechanics (all cards
  start in the left/`second` array, pull `keep` into `top`) with `leftLabel:
"HAND"`, `rightLabel: "TOP OF LIBRARY"`.
- `confirmDisabled` requires `top.length === keep` (same as distribute).
- On confirm, call `onConfirm(topTopmostFirst, [])` — the second array is dropped
  by the caller (see §3). No engine change to the picker's submit contract.

### 2. GRE — discriminator on the choice (client-only routing hint)

- `putBack` sets a new optional boolean on its `requestChoice` call, e.g.
  `putOnTop: true`, carried through to the `PendingChoice`. The kind stays
  `choose-hand-card` — the GRE submit path and the bot's generic
  `choose-hand-card` handling are **unchanged** (order is already respected via
  the `cardInstanceIds` array). This flag exists only so the client routes to the
  ordered picker instead of the in-hand toggle.
- Serialization: the flag is nested in `pendingChoices` (serialized wholesale),
  but confirm it round-trips and add a representative value to the serialize
  smoke test if the drift guard requires it.

### 3. Frontend — mount + submit

- New wrapper component `PutBackPicker` (own file, mirrors `HandCardPick`),
  mounted from `board.tsx`. Reads the chooser's own `player.hand` via
  `useGameContext`; gates on `head.kind === "choose-hand-card" && head.putOnTop &&
head.playerId === playerId && (head.zoneOwnerId ?? playerId) === playerId`.
- Builds `lookedAt` from the whole own hand (`{ instanceId: c.id, defId:
c.card.id }`) and mounts `LibraryOrderPicker` with `putBack={{ keep: count }}`.
- Confirm submits ordered via the existing `submitChoice` mutation:
  `cardInstanceIds: topTopmostFirst` (no `secondZoneIds`). Order is authoritative
  — do NOT route through the toggle buffer (its order is not guaranteed).
- `pending-choice-prompt.tsx`: extend the own-hand `choose-hand-card` suppression
  so the generic banner + in-hand toggle do NOT show for a `putOnTop` choice
  (mirrors the existing `order-top`/`reorder-library` suppression).

### 4. Reducer walk (mandatory, per gre-development rules)

- `projectPublicState` (`convex/gameProjections.ts`): confirm the `putOnTop` flag
  survives projection on the pending choice, and that the chooser's own hand
  crosses the wire with card identity (`card.id` = defId) so the picker can render
  art. Add/extend a wire-format assertion.
- `buildTriggerStateView`: N/A — putBack has no activation-cost gate; nothing to
  carry.

## Testing

- **Picker unit test** (`library-order-picker.test.tsx`): `putBack` mode requires
  exactly 2 in the top zone before Done; confirm emits topmost-first; left zone
  never submitted. Reorder within the top zone flips which card is topmost.
- **Wire-format**: drive the picker's card list + the choice's `putOnTop` flag
  through `projectPublicState` (a hand-built state masks a dropped field).
- **Interpreter**: `putBack` already has coverage in the effect-script suite; no
  new Op. If missing an ordered-resume assertion, add one (2 picks → top order).
- **E2E / integration**: `selectTarget`/`submitChoice` accepts the ordered
  `cardInstanceIds` for a `putOnTop` `choose-hand-card`; resolving reproduces the
  chosen top order end-to-end.
- Existing full gate: `bun run check:all` + `bun run test`.

## Cleanup

- Delete `src/routes/prototype/put-back/` (the router entry is already removed).
  Fold the validated interaction into the real picker per above.

## Out of scope

- Any card other than Brainstorm. The `putBack` mode + `putOnTop` flag are
  generic, so a future "put N from hand on top" card reuses them for free, but no
  such card is wired here.
- Opponent-hand ordered put-back (no card needs it).
