# Turn controller surface + responsive board layout

The spatial board (now the only board — the "board next" name is retired)
presents the interactive priority + phase/combat-step surface as a **single,
collapsed-by-default pod docked to the right edge**, and the whole board uses a
**right control column that collapses to a bottom bar on portrait mobile**. This
records the layout contract so later work doesn't "fix" choices that were
deliberate (issue #258).

## Status

accepted

## Decision

### Desktop

- **One unified controller pod**, right edge, collapsed by default: shows only
  the CURRENT phase + the priority cue + the action buttons + a CTA. The full
  phase list is one click away, not always on, so the board stays free.
- The CTA opens the **full phase list sized to its content** (every phase
  visible; scrolls only if it would exceed the viewport — _not_ `100vh`),
  anchored to the right edge, vertically centered, non-modal with click-away.
  Phase names are centered between two stop-toggle columns headed **YOU / OPP**.
- **Stops stay the live model** — the per-phase self + opponent auto-pass toggle
  (`useSkipPhasePreferences` / `PhaseStepCell`), CR auto-pass prefs — only
  restyled, not redesigned.
- **The right edge is a single control column**, top→bottom: opponent piles ·
  stack · pod · viewer piles. The pod sits ABOVE the viewer's piles (it does not
  share the bottom-right corner with them, and it never overlaps the
  center-right stack slot).
- **Symmetry — reserved right gutter.** Both battlefields reserve the same right
  inset (= the pod column width) in `bandedRowsLayout` so the back row's
  flush-right noncreature block ends before the control column on BOTH sides.
  The opponent has no pod but keeps the gutter, and its piles move from top-LEFT
  to **top-RIGHT** to mirror the viewer. Without this, a flush-right permanent
  is permanently hidden under the pod.
- **Card preview docks at a fixed center-LEFT panel**, replacing the
  beside-the-card lateral zoom (`clampZoomPosition`). One constant location the
  eye learns; shows on hover, hides on mouseout.

### Mobile

- **Landscape = reduced desktop** (keep the right column, narrower).
- **Portrait** transforms the right column: pod → fixed **bottom action bar**
  (current-phase chip + full-width primary action); phase list → **bottom
  sheet**; piles & stack → tappable **chips** that open the existing reveal /
  stack views; right gutter → **0** (back row uses full width); hand → flat
  overlap that **scrolls horizontally beyond 6 cards**.
- **Card preview on portrait is the ADR-0009 centered long-press overlay**, NOT
  the center-left panel. The center-left dock is desktop-only.
- Layout switches via CSS breakpoints (`md:`). Input stays dual-bound
  mouse+touch — ADR 0009 forbids device sniffing for INPUT detection, which is
  orthogonal to responsive LAYOUT.

## Considered Options

- **Full always-on phase rail** (the pre-#258 left rail, classic board) —
  rejected: occupies the edge permanently and reads cryptically (two-letter
  codes). The collapsed pod keeps the board free and the full list legible.
- **Pod sharing the bottom-right corner with the piles, or piles shifted left
  alongside the pod** (variant I) — rejected: the bottom edge gets crowded and
  the piles creep toward the hand fan. Stacking pod-above-piles keeps three
  clean rows in the right column.
- **Keeping the lateral (beside-the-card) zoom on desktop** — rejected: the
  preview jumps around the screen following the card; a fixed center-left dock
  is a single learned location.
- **Same lateral zoom on mobile** — rejected by ADR 0009 (illegible at 375px);
  portrait keeps the centered overlay.
- **Asymmetric board (gutter on the viewer side only)** — rejected: a large
  visual asymmetry between the two halves; both sides reserve the gutter.

## Consequences

- `bandedRowsLayout` callers on the board must pass a right inset equal to the
  pod column width on BOTH sides; the opponent's reserved column is intentional
  even though it hosts no pod.
- `BoardNextPiles` opponent block moves top-LEFT → top-RIGHT.
- `CardPreview` gains a desktop fixed-dock mode distinct from the mobile
  overlay; the lateral `clampZoomPosition` path is retired on desktop.
- The pod reuses the existing priority/phase logic (`action-bar` priority
  helpers, `useSkipPhasePreferences`); no GRE changes (issue #258 constraint).
