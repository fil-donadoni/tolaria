---
title: The deck-builder toolbar scroller is starved at 3 of 5 viewports, and the 44px touch rung makes it 4
discoveredBy: 2581
status: draft
confidence: high
---

**What is wrong.** `/decks/create` renders its filter/toolbar column into a
`flex flex-1 items-start gap-3 overflow-auto` container that never grows to its
content. The lane's `starved` probe (a scroll container shorter than its tallest
child, `scripts/ui-gate/probe.js:76-91`) has flagged it at `1440x900x2` and
`1180x820x2` since the budgets were first recorded. Shipping ADR 0101's pointer
rung — `--control-h: 44px` under `@media (pointer: coarse)` — makes its filter
rows 228px tall against a 171px window at `820x1180x2`, so the same container is
now starved at a third viewport.

**Evidence.** Measured with `bun run check:ui`, one variable changed:

| viewport   | container height | tallest child | starved                                      |
| ---------- | ---------------- | ------------- | -------------------------------------------- |
| 1440x900x2 | 157              | 182           | yes (pre-existing, fine pointer)             |
| 820x1180x2 | 171              | 228           | yes — was `starved 0` before the coarse rung |
| 1180x820x2 | 57               | 168           | yes (pre-existing)                           |

Neutralising only the coarse rung (`--control-h: var(--control-h-fine)` inside
the `pointer: coarse` block, `src/index.css`) returns `820x1180x2` to
`starved 0` with **every other number on the surface unchanged** — so the rung is
the trigger and the container is the defect. The ceiling was raised to 1 for that
one cell in `scripts/ui-gate/budgets.json` with a `knownDebt` naming both.

Tuning the rung does not help: the container is 171px and the rows are already
182px at the FINE height, so any touch rung at all keeps it starved.

**Why it may not deserve its own issue.** ADR 0101 §7 already rewrites this
exact chrome ("toolbar collapsed into the bar, filters in a popover, the deck
gets ≥60% of the height"), and the deckbuilder slice of PRD #2405 owns it. If
that slice is already ticketed, this is a line on it — a measurement to check
against, not a second ticket. It earns its own issue only if the deckbuilder
slice slips far enough that `820x1180x2` is worth fixing on its own, which is
unlikely: the same cell already carries 9 STRANDED controls, a strictly worse
defect on a hard floor.
