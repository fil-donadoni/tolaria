---
title: 39-68 controls per surface still measure under 44px at pointer: coarse
discoveredBy: 2593
status: draft
confidence: high
---

**What is wrong.** Issue #2593's prose asks for "every touch target ≥44px at
`pointer: coarse`" (ADR 0101 §2, WCAG 2.5.8). The token machinery for it exists
and works — `--control-h` resolves to 44px under `@media (pointer: coarse)`
(`src/index.css`) — but most controls never read it, so the rung is honoured
only where a component explicitly opted in. The gate already measures this and
nothing consumes the number: `probe.js` reports `small<n>` per surface, and
`budgets.json` has no ceiling for it.

**Evidence.** Measured by `bun run check:ui` on `feat/issue-2593`, `small` =
visible interactive targets whose smaller side is under 44px, at the coarse
viewports:

| surface       | 390x844x3 | 844x390x3 | 820x1180x2 | 1180x820x2 |
| ------------- | --------- | --------- | ---------- | ---------- |
| lobby         | 5         | 8         | 20         | 25         |
| deck-builder  | 12        | 25        | 65         | 65         |
| design-system | 16        | 21        | 21         | 21         |

The dense clusters are the deckbuilder's own: `deck-column-actions.tsx:72,90,102`
(the ✎ / ✕ / ✓ glyph buttons, `text-[11px]` with `px-0.5`) and
`zone-color-filter-toggles.tsx:40` (`size-6`, five of them at `gap-0.5`).

**Why #2593 did not fix it, and why that is not just deferral.** The obvious
remedy — grow the hit box without growing the paint, via a centred 44px
`::after` — is WRONG for exactly these clusters, and measurably so: at `gap-0.5`
(2px) two adjacent 24px controls given 44px hit areas OVERLAP by 18px, the later
sibling paints on top, and the earlier one becomes genuinely un-tappable near its
own edge. That is a real mis-tap and it would also show up as a `ctrlsOcc`
regression in the probe. Honouring 2.5.8 here means RE-SPACING the clusters (or
moving them into a menu), which is a layout decision about the Column header
band, not a token swap — and the deck-builder already carries `ctrlsStranded 9`
at tablet portrait, so the band has no spare height to give.

**Why it may not deserve its own issue.** It may be better as a `smallN` ceiling
added to `budgets.json` on the surfaces that are already clean, plus a line on
the PRD #2405 tracker, rather than a ticket of its own: the work is per-cluster
layout, not one change, and a single "make everything 44px" ticket would be
re-sliced immediately. Against that: it is the one acceptance-criterion phrase of
#2593 that shipped unmet, so leaving it only in a PR description loses it.
