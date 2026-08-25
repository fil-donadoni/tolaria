---
title: The dock "Add Basic" trigger is a 73x22px touch target; fixing it costs #2585's own AC
discoveredBy: 2585
status: triaged
issue: 2670
confidence: high
---

**What is wrong.** In the dock layout (`deck-source-dock:`, landscape +
`min-width: 1024px` + `min-height: 501px`), the source panel's basics bar
folds down to a single `Add Basic` trigger (`deck-builder-shell.tsx`, the
`isSourceDock` branch) instead of the inline five-stepper band the
non-dock/portrait layouts show. That trigger is the ONLY route to the basics
steppers in dock mode. It renders at **73x22px** — under the 44px
`pointer: coarse` target `--control-h-coarse` resolves to
(`src/index.css:940-943`), an ADR 0101 violation. Its portrait twin, the
`Lands` button in `deck-bottom-bar.tsx:117`, already carries
`style={{ minHeight: "var(--control-h)" }}` and reaches the target
everywhere it renders.

**Why the obvious fix doesn't ship here.** Round-2 fixup of PR #2653 applied
the identical `style={{ minHeight: "var(--control-h)" }}` to the dock
trigger. It works exactly as intended — the trigger measures 73x44 at
1180x820 under `pointer: coarse` emulation — but the trigger sits in the same
flex column as the deck (maindeck) pane, so the ~22px it gains comes straight
out of that pane's `flex-1` share. That pane's height percentage is
**exactly the metric issue #2585 exists to raise past 60%** (its own
acceptance criterion, `docs/findings/2585-deck-pane-60-percent-needs-the-pane-split.md`).
At 1180x820 the extra 22px is enough to drop the search-active reading below
the floor.

**Measured on this branch (`feat/issue-2585`), same account, deck pane share
of the flex column, `data-deck-pane="maindeck"` height ÷ viewport height —
A/B on the ONE `minHeight` style prop on the dock `Add Basic` trigger,
nothing else differing:**

| viewport | state         | WITHOUT `minHeight` (shipped) | WITH `minHeight: var(--control-h)` | AC floor |
| -------- | ------------- | ----------------------------- | ---------------------------------- | -------- |
| 1180x820 | idle          | 552.5/820 = **67.4%**         | 534/820 = 65.1%                    | ≥60%     |
| 1180x820 | search-active | 494.5/820 = **60.3%**         | 476/820 = 58.0% — **below floor**  | ≥60%     |
| 1440x900 | idle          | 640.5/900 = **71.2%**         | 634/900 = 70.4%                    | ≥60%     |
| 1440x900 | search-active | 594.5/900 = **66.1%**         | 588/900 = 65.3%                    | ≥60%     |

Only the 1180x820 search-active cell actually crosses the floor, but it does
so on the viewport/state pair #2585's own AC was measured against — so the
regression is not academic. `Add Basic` trigger rect confirmed via
`getBoundingClientRect()`: 72.76x22px shipped (unchanged from before this
ticket), 72.76x44px with the style prop applied.

**Disposition — tracked by #2670.** #2585's AC is explicit, measured, and the
entire reason this ticket exists; closing the touch-target gap by reclaiming
~20px of chrome elsewhere in the dock column at 1180x820 is exactly the kind
of holistic touch-target-vs-layout-budget reconciliation that #2593 (the
sibling #2405 child, AC: every control reaches ≥44px at `pointer: coarse`,
WCAG 2.2 AA target size) was meant to do. #2593 is now CLOSED — it shipped
with that very AC UNMET and parked the gap in its own drawer draft,
`docs/findings/2593-coarse-pointer-touch-targets-below-44px.md` (see that
file's table — the deck-builder surface alone still carries 39–65 sub-44px
controls at the coarse viewports). This dock trigger's gap, and #2593's
whole census, are now tracked by **#2670** ("a11y: coarse-pointer targets
below the ADR 0101 §2 44px rung — #2593's unmet AC, currently drawer-only"),
a #2405 sub-issue, P0 on the board.

**For #2670:** do not re-apply the naive `minHeight: var(--control-h)` patch
verified above without first finding ~20px to reclaim elsewhere in the
1180x820 dock column — it silently reopens #2585's search-active regression
recorded in this file and in `scripts/ui-gate/budgets.json`'s `deck-builder`
`1180x820x2` entry (that entry now describes the shipped 22px state; do not
"fix" it back to describing the reverted experiment without re-deriving the
chrome budget first).

**#2670's own pass (2026-08-25): still unfixed, by design.** The only chrome
this PR actually reclaimed in the 1180x820 dock column was 8px off
`SaveDeckBar`'s own padding (`deck-source-dock:py-2`, `save-deck-bar.tsx`) —
enough to pay for `DeckFeaturedSelect`'s 4px cost (a DIFFERENT control in the
same row, see `scripts/ui-gate/budgets.json`'s `1180x820x2` `knownDebt`) with
a little left over, not the ~20px this trigger needs. No other slack was
found in this column without touching a band #2585 or #2581 already tuned to
its own floor (the header's `deck-source-dock:py-2` is already spent; the
strip below is governed by `docs/findings/2581-deckbuilder-toolbar-starved-
by-touch-rung.md`'s own zero-slack finding). The trigger stays 73×22px.
Recorded as debt, not traded for a reopened #2585 floor — the hard constraint
this issue was given.
