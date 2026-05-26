# Mobile touch interaction model

Cards on mobile are unplayable with hover-based preview and right-click context menus. Touch devices have no hover and no right-click. This ADR establishes the touch interaction model for card inspection and action selection.

## Decision

### Gesture mapping (touch devices)

| Gesture                                      | Behavior                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| **Tap**                                      | Execute action if only one legal action; open **Action Sheet** if multiple |
| **Long-press** (400ms, cancel on >10px move) | Open **Card Preview Overlay**                                              |

### Card Preview Overlay (mobile)

Full-screen centered overlay with semi-transparent backdrop. Shows card art + oracle text at maximum legible size. Two dismiss modes (**Peek/Lock**):

- **Peek**: release finger before 1s → overlay closes immediately
- **Lock**: hold >1s → overlay stays open, dismiss via tap on backdrop

### Action Sheet (mobile)

Bottom sheet with touch-friendly targets (≥48px height) listing available actions (cast, play land, activate abilities). Dismiss via tap outside or swipe-down.

### Long-press feedback

During the 400ms threshold, card scales to 1.05× as visual confirmation that long-press is registering. Movement >10px cancels (user was scrolling).

### Desktop behavior

Unchanged: hover 300ms → lateral zoom panel, right-click → context menu dropdown. Long-press added as fallback for hybrid devices (touchscreen laptops, iPad with trackpad).

### Scope

All zones: Battlefield, Hand, Stack, Graveyard/Exile browsers. Logic lives in `CardPreview` (universal wrapper) — single implementation point.

### Input detection

Dual event binding: mount both mouse and touch handlers everywhere. Touch handlers call `preventDefault()` to suppress ghost clicks. No device-type sniffing or media-query gating.

## Considered Options

### Preview trigger

- **Hover on mobile** — impossible, no hover on touch
- **Tap = preview, double-tap = action** — three gestures to learn, double-tap conflicts with zoom
- **Long-press = preview** — chosen: natural "inspect" gesture, distinct from tap

### Preview display

- **Same lateral zoom panel** — too small on 375px screens, illegible
- **Bottom sheet** — works but wastes horizontal space for a vertical card
- **Centered overlay** — chosen: max readability, Arena-familiar

### Dismiss model

- **Release only** — can't read long oracle text
- **Tap backdrop only** — extra tap for quick peek
- **Peek/Lock hybrid** (release <1s closes, hold >1s locks) — chosen: best of both

### Action menu (mobile)

- **Popover near card** — too small for fingers, clips on battlefield edges
- **Full modal** — too heavy for 2-3 options
- **Bottom sheet** — chosen: native mobile pattern, large touch targets

### Input detection

- **Media query `(hover: none)`** — fails on hybrid devices
- **First-input detection** — one-shot, misses mode switches
- **Dual binding** — chosen: robust everywhere, minimal overhead

## Consequences

- `CardPreview` gains touch event handlers and a `useState` for overlay mode
- New `ActionSheet` component needed (bottom sheet for mobile actions)
- Desktop users see zero behavior change
- Hybrid devices (Surface, iPad + keyboard) get both interaction models simultaneously
- 400ms long-press threshold is a tunable constant — can adjust based on user testing
