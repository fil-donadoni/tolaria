---
title: The constructed deck builder strands 9 controls at tablet portrait and collapses one at every viewport
discoveredBy: 2580
status: draft
confidence: high
---

**What is wrong.** The first `check:ui` baseline (#2580) measured
`/decks/create` at all five ADR 0101 viewports. Four of the five report
controls the user cannot reach at all — `stranded` means outside the viewport
with **no scrollable ancestor**, i.e. no gesture recovers them — and every
viewport but phone-landscape reports one control that collapsed to under 4px
in both dimensions.

**Evidence.** `scripts/ui-gate/budgets.json`, surface `deck-builder`,
recorded 2026-08-19 against `2f4d0da5` (screenshots in
`.claude/telemetry/ui-gate/deck-builder__*.png`):

| viewport   | ctrlsZero | ctrlsOcc | ctrlsStranded | starved | axe serious                 |
| ---------- | --------- | -------- | ------------- | ------- | --------------------------- |
| 1440x900x2 | 1         | 1        | **4**         | 1       | color-contrast              |
| 390x844x3  | 1         | 1        | 0             | 0       | scrollable-region-focusable |
| 844x390x3  | 0         | 2        | 0             | 0       | scrollable-region-focusable |
| 820x1180x2 | 1         | 4        | **9**         | 0       | color-contrast              |
| 1180x820x2 | 1         | 2        | **6**         | 1       | color-contrast              |

The two tablet viewports are the worst cells in the whole matrix — which is
the pattern ADR 0101 predicted when it added the tablet pair, and the reason
`.claude/rules/chrome-debug.md` moved from three viewports to five.

The lane budgets these at their measured values with a `knownDebt` note rather
than at the hard floor (zero stranded, zero collapsed), so the numbers are
pinned and visible on every run without the lane being permanently red.

**Why it may not deserve its own issue.** It is squarely inside PRD #2405's
scope (Responsive & mobile UX overhaul), so the right home is probably a line
on that umbrella or the slice that owns the deck builder, not a fresh ticket —
and the budget entry already makes it impossible to lose. What would argue for
its own issue: `ctrlsStranded` is unreachable-by-any-gesture, not merely ugly,
and nine of them on a supported viewport is a functional break rather than a
polish item.
