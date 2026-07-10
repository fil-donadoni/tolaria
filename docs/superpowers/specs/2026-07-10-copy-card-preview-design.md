# Copy card preview: current + original face

**Date:** 2026-07-10
**Status:** Approved (design)

## Problem

When a permanent becomes a copy of another object (Copy Artifact, Clone,
Vesuvan Doppelganger — CR 707.2), the board and the card-preview render only
its **presented** identity (the copied object). The fact that the permanent is
actually a Copy Artifact / Clone is invisible. Arena addresses this by showing
the copy's current face alongside the original card. Tolaria's preview should
do the same.

Spell copies on the stack (`isCopy`, e.g. Fork) have no distinct printed
identity — the copy is a copy of the same spell — so they get a `Copy` badge
rather than a second face.

## Existing model (no backend change for permanents)

- `CardInstanceState.copiedFrom?: string` (`convex/gre/state.ts:668`) holds the
  original printed def id, set by `applyCopy` (`convex/gre/copy.ts:46`), cleared
  by `revertCopy` when the copy leaves the battlefield.
- `copiedFrom` survives the wire projection (`slimCard` spread,
  `convex/gameProjections.ts:171`) and is declared client-side
  (`src/types/game.ts:173`).
- The preview's `cardId` prop is the **presented** id (the copied object) — what
  it already renders big.
- `StackItem.isCopy?: boolean` (`convex/gre/state.ts:1069`) survives projection
  but is **not declared** in the client `StackItem` type
  (`src/types/game.ts:227`).

Both battlefield permanents and stack spells reach the preview through
`CardImage → CardPreview` (`src/components/cards/card-image.tsx:55`).

## Design

### 1. Data sources

- **Permanent original face** — read `cardInstance.copiedFrom`. Already on the
  client; zero backend work.
- **Spell-copy badge** — declare `isCopy?: boolean` on the client `StackItem`
  type. Thread it from `game-stack.tsx` through `ColorOverlayCardImage` →
  `CardImage` → `CardPreview` as a `showCopyBadge` prop. Server projection
  already keeps the value.

### 2. Body builder (refactor)

Extract the inline `sharedBody` object in `card-preview.tsx` into a named
builder `buildPreviewBody(defId, cardInstance?, gameCtx?)` that returns the
same shape consumed by `CardPreviewBody` / `CardPreviewAnchored` /
`CardPreviewDock`.

- **Current face** = `buildPreviewBody(cardId, cardInstance, gameCtx)` —
  identical to today's behavior (effective P/T, counters, color override,
  owner, granted abilities).
- **Original face** = `buildPreviewBody(copiedFrom)` with **no** `cardInstance`
  and **no** `gameCtx` → pure printed values: the original card's name, art,
  type line, oracle text, and printed P/T. Built only when
  `cardInstance?.copiedFrom` is set.

### 3. Surface rendering

`CardPreviewBody` gains an optional `originalBody` prop (same shape as its
current props bundle). When present it renders **two bodies side by side**,
each with a small label: `Current` and `Original` (English, per project rule).

Applied to all three preview surfaces:

- Anchored (desktop quick-click, `size="sm"`) — doubles width; the existing
  viewport-clamp logic keeps it on screen.
- Dock (desktop hold-zoom, `size="md"`).
- Mobile overlay (`size="md"`).

When `originalBody` is absent the preview is unchanged (single face).

### 4. Spell-copy badge

When `showCopyBadge` is true, render a small `Copy` badge on the (single-face)
preview. No second face — a spell copy has no distinct printed identity to
show.

### 5. Reversion

No extra work: `revertCopy` clears `copiedFrom` when the copy leaves the
battlefield, so the preview automatically falls back to a single face.

## Testing

Per `.claude/rules/gre-development.md` § Frontend wiring analysis, SURFACE
assertions run through the reducer, not a hand-built fat state.

- **Unit** — `buildPreviewBody(copiedFrom)` returns the printed original face
  (name / art id / printed P/T / oracle of the original card), independent of
  any `cardInstance` overrides.
- **Component** — the preview renders two labeled faces (`Current` /
  `Original`) when `cardInstance.copiedFrom` is set, driven through the
  **projected / slim** instance (`projectPublicState`), not a fat state — a
  hand-built state would mask a dropped field.
- **Spell-copy badge** — `isCopy` declared on the client `StackItem`; the badge
  renders when the flag is set and is absent otherwise.
- **Wire survival** — `copiedFrom` through `projectPublicState` is already
  covered (`convex/cards/sets/lea/__tests__/blue.test.ts:3340`); no new wire
  test needed for the permanent path.

## Out of scope

- Face-down / morph "presented vs printed" identities (future; the same
  `originalBody` mechanism can extend to them).
- Any backend / GRE change — the feature is purely a client view over data
  already on the wire (plus one client type declaration for `isCopy`).

## Preset scenario

Add a `PRESET_SCENARIOS` entry loading a resolved copy permanent (e.g. Clone
copying a creature) so the two-face preview can be exercised one-click from the
Debug panel.
