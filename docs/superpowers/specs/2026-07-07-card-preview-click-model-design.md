# Card Preview — Desktop Click Model (Arena-style)

**Date:** 2026-07-07
**Status:** Approved design, pending spec review

## Problem

The desktop card preview opens on `mouseover` (300 ms hover delay,
`CardPreview` in `src/components/cards/card-preview.tsx`). It is unreliable:
under the board's live 3D tilt (`CardTilt3D`) the card rewrites its transform on
every pointer move, so `mouseleave` fires spuriously (pointer still inside the
moved rect) and then never fires again — leaving stale previews, or failing to
open on the first try. A document-level pointer watcher (`startExitWatch`) was
added to paper over this, but the interaction is still fragile.

Goal: replace the hover model on desktop with an explicit, deterministic click
model that mirrors MTG Arena's desktop behavior.

## Target behavior (desktop, `pointer: fine`)

Left-click stays a **gameplay** action (play from hand, tap, select target) —
unchanged. Preview is driven entirely by the **right** mouse button:

| Gesture                                         | Result                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Quick right-click (press + release < threshold) | Toggle the **anchored** preview beside the card                                         |
| Right-button held past threshold                | Show the **big** preview in the board's right-column dock while held; release closes it |

### Anchored preview (quick right-click)

- Renders beside the card via `CardPreviewAnchored`, everywhere (board + lobby +
  deck-builder). The board's fixed right-column dock is **no longer** used for
  the small preview.
- Fully clamped inside the viewport — horizontally (prefer right, fall back to
  left, else the side with more room) **and** vertically. `clampPosition` in
  `card-preview-anchored.tsx` already does both; reused as-is.
- **Toggle + one-at-a-time**: a second quick right-click on the same card closes
  it. A left- or right-click anywhere else, or `Escape`, closes it. Enforced by
  the existing `card-preview-singleton` (document `pointerdown` capture closes
  any open preview; one open at a time).

### Big preview (right-button hold)

- Board only. While the button is held past the threshold, the big preview shows
  in the existing right-column dock (`CardPreviewDock`) at a larger size.
- Supersedes the anchored preview: while the dock zoom is up, the anchored-beside
  surface is **hidden** (a single preview surface visible at any moment).
- Release closes it and returns to the closed state (no anchored preview is
  restored).
- **Lobby / deck-builder**: no hold-zoom. There is no board dock there, so the
  hold gesture does nothing extra — only the quick-click anchored preview exists.

### Removed

- The 300 ms hover-to-open path (`HOVER_DELAY_MS`, `onMouseEnter` timer) and its
  `startExitWatch` / window-blur / pointer-exit machinery — no longer needed once
  the preview is click-toggled rather than hover-followed.
- The old right-click-**hold**-dock behavior (`handleMouseDown` button-2 +
  `mouseup` close) is replaced by the new right-press state machine below.

### Unchanged

- **Mobile / touch**: the long-press centered overlay (`useLongPress`, ADR 0009,
  `showOverlay`) is untouched. `sawTouchRef` still gates the mouse path off on
  touch devices.
- Left-click gameplay handlers. `onContextMenu` stays suppressed so the native
  menu never appears on right-click.

## Components / units

### New: `src/hooks/useRightPressPreview.ts`

A small mouse-only state machine, parallel to `useLongPress` (which stays
touch-only). One clear purpose: turn right-button press/hold/release into two
intents.

- **Phases:** `idle → pressing → zoom`.
- `onMouseDown(e)`: ignore unless `e.button === 2`; `preventDefault` +
  `stopPropagation`; set `pressing`; start a timer of `RIGHT_HOLD_ZOOM_MS`
  (~250 ms, exported constant, tunable). On fire → `zoom`, call `onZoomStart()`.
- **Release** (a `window` `mouseup` listener, since the release can land off the
  card): if phase was `pressing` → quick click → call `onQuickClick()` (toggle
  anchored); if phase was `zoom` → call `onZoomEnd()` (close big). Then reset to
  `idle` and detach the listener.
- Returns `{ phase, handlers: { onMouseDown } }`. No scale feedback on desktop
  (kept minimal; can add later).

### Changed: `src/components/cards/card-preview.tsx`

- Drop hover state (`isHovered`, `hoverTimeoutRef`, `HOVER_DELAY_MS`,
  `startExitWatch`, `stopExitWatch`, `exitTeardownRef`, the `onMouseEnter` /
  `onMouseLeave` handlers).
- Replace `handleMouseDown` with `useRightPressPreview`:
    - `onQuickClick`: toggle a new `showAnchored` boolean (open → `requestOpenPreview`;
      close → `releasePreview`), so a second right-click closes it and the singleton
      closes it on outside click.
    - `onZoomStart` (board only, i.e. `gameCtx` present): hide anchored, set
      `showZoomDock`. `onZoomEnd`: clear `showZoomDock`.
- Render logic:
    - `showAnchored && !showZoomDock` → `CardPreviewAnchored` beside the card.
    - `showZoomDock` (board only) → `CardPreviewDock` at the larger size.
    - Mobile `showOverlay` block unchanged.
- Keep `containerRef`, `closeRef`, `card-preview-singleton` wiring for the
  anchored toggle + click-outside close.

### Reused as-is

- `card-preview-anchored.tsx` — beside-card placement, viewport clamp (H+V).
- `card-preview-dock.tsx` — right-column dock, rendered only for the hold-zoom
  now; passed a larger `size` (`"md"`; `CardPreviewBody` supports `sm`/`md`).
- `card-preview-singleton.ts` — one-open-at-a-time + document click-outside close.
- `card-preview-body.tsx` — shared content.

## Data flow

```
right mousedown ──► useRightPressPreview
   │  (button 2, preventDefault/stopPropagation)
   ├─ release < 250ms ─► onQuickClick ─► toggle showAnchored
   │                                      └─► CardPreviewAnchored (beside card, clamped)
   │                                          closed by: re-click / outside click (singleton) / ESC
   └─ hold ≥ 250ms ────► onZoomStart (board only) ─► hide anchored + showZoomDock
                          └─ release ─► onZoomEnd ─► CardPreviewDock hidden
```

## Edge cases

- **Card near viewport edge**: anchored preview flips side / shifts; fully inside
  viewport (already handled by `clampPosition`, incl. vertical).
- **Release off the card** (hold then drag away): `window` `mouseup` still closes
  the zoom — release is listened on `window`, not the element.
- **Touch device**: `sawTouchRef` short-circuits the mouse path; the mouse hook's
  `onMouseDown` is a no-op there. Long-press overlay unaffected.
- **Tab blur / window leave mid-hold**: reset `zoom` on `window` `blur` so the
  dock never sticks open.
- **Left-click during an open anchored preview**: gameplay proceeds; the
  singleton's outside-click close fires on the same `pointerdown`.

## Testing

Client-only feature (no GRE / wire-format surface). Per `frontend-components.md`:

1. **Hook unit test** (`src/hooks/__tests__/useRightPressPreview.test.ts`):
   phase transitions — quick release → `onQuickClick`; hold past threshold →
   `onZoomStart`, then release → `onZoomEnd`; `button !== 2` ignored; release
   fired via `window` mouseup.
2. **Component test** (`src/components/cards/__tests__/card-preview.test.tsx`):
   left-click never opens a preview; quick right-click opens anchored
   (`data-card-preview-anchored` marker), second right-click closes it; hold on
   the board shows the dock and hides anchored, release closes the dock; no dock
   in lobby (no `GameContext`).
3. `bun run check:all` — format + lint + type-check.

Threshold constant `RIGHT_HOLD_ZOOM_MS` is exported so the test can reference it
instead of hard-coding 250.

## Out of scope

- Changing left-click gameplay semantics.
- Mobile/touch preview changes (ADR 0009 stays).
- Desktop scale/press feedback animation (can follow later).
