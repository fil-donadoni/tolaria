---
title: match-format-selector is a segmented control that does not use the shared segment classes
discoveredBy: 2723
status: draft
confidence: medium
---

**What is wrong.** There is no shared segmented COMPONENT — five call sites
hand-build their markup on `.segment-pill` / `.segment-active` /
`.segment-inactive` (`src/index.css`). #2723 re-skinned those three classes to
the v4 field/hairline/accent-plate, so all five inherited the skin with no
consumer edit. A sixth control is shaped like a segmented control, reads like
one to a user, and inherits nothing: it carries its own ad-hoc classes.

**Evidence.**

- Consumers on the shared classes: `src/components/lobby/play-mode-selector.tsx:67`,
  `src/components/lobby/deck-builder/match-mode-pills.tsx:30-31`,
  `src/components/lobby/deck-builder/color-filter.tsx:74-75`,
  `src/components/deckbuilder/zone-creature-filter-select.tsx:50-51`.
- Not on them: `src/components/lobby/match-format-selector.tsx:23-50` — a
  `role="radiogroup"` with per-option classes written inline. It is the Bo1/Bo3
  selector the ADR 0103 §6 Loadout names explicitly ("Bo1/Bo3 segmented"), so
  after #2723 the lobby shows two segmented controls in two different skins.
- The shared classes are the only seam #2723 could use: its acceptance criterion
  is "no consumer file edited", and moving this one onto `.segment-pill` is a
  consumer edit.

**Why it may not deserve its own issue.** #2725 (the lobby-as-game-menu slice)
rebuilds the Loadout, which is where this control lives — it will almost
certainly rewrite this markup anyway, and a separate ticket would collide with
it. The case for a ticket is that the v4 divergence is visible the moment #2723
lands and #2725 may not reach this control's markup; the case against is that
one line on #2725 ("put the Bo1/Bo3 selector on `.segment-pill`") is the whole
fix. Either way the shared-class seam is the right target, not a new component.
