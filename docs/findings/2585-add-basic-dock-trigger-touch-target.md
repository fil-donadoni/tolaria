---
title: The dock "Add Basic" trigger is a 73x22px touch target; fixing it costs #2585's own AC
discoveredBy: 2585
status: draft
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

**Disposition — left to #2593, not fixed here.** #2585's AC is explicit,
measured, and the entire reason this ticket exists; closing the touch-target
gap by reclaiming ~20px of chrome elsewhere in the dock column at 1180x820 is
exactly the kind of holistic touch-target-vs-layout-budget reconciliation
that belongs to **#2593** (the sibling #2405 child, already unblocked and
queued next, AC: every control reaches ≥44px at `pointer: coarse`, WCAG 2.2
AA target size). #2593's own target files are `src/components/deckbuilder/**`
— the same surface — so it is positioned to trade off this specific 22px
against the rest of the dock column's chrome (header, basics-bar-as-trigger,
search row) rather than borrowing against one AC to satisfy another.

**For #2593:** do not re-apply the naive `minHeight: var(--control-h)` patch
verified above without first finding ~20px to reclaim elsewhere in the
1180x820 dock column — it silently reopens #2585's search-active regression
recorded in this file and in `scripts/ui-gate/budgets.json`'s `deck-builder`
`1180x820x2` entry (that entry now describes the shipped 22px state; do not
"fix" it back to describing the reverted experiment without re-deriving the
chrome budget first).
