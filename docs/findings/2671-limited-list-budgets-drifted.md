---
title: limited-list / limited-your-events budgets.json ceilings are stale — every viewport but 844x390x3 now over budget
discoveredBy: 2671
status: draft
confidence: medium
---

**What is wrong.** `bun run check:ui` (full run, all surfaces) reds on
`limited-list` and `limited-your-events` at every viewport except
`844x390x3`, with the same shape at each: `small` measures 1 over the
recorded ceiling, and `1440x900x2`/`820x1180x2` also gained a new
`starved 1` where the budget records `0`.

```
FAIL  limited-list         1440x900x2   small25 — over budget: small 25 > 24
FAIL  limited-list         390x844x3    starved1, small17 — over budget: starved 1 > 0, small 17 > 16
FAIL  limited-list         820x1180x2   small22 — over budget: small 22 > 21
FAIL  limited-list         1180x820x2   starved1 — over budget: starved 1 > 0
FAIL  limited-your-events  1440x900x2   small23 — over budget: small 23 > 22
FAIL  limited-your-events  390x844x3    small16 — over budget: small 16 > 15
FAIL  limited-your-events  820x1180x2   small21 — over budget: small 21 > 20
FAIL  limited-your-events  1180x820x2   small21 — over budget: small 21 > 20
```

**Evidence it is pre-existing, not caused by this PR's diff.** `git stash`
on this branch (isolating `HEAD` back to the verified-green base tip) and
re-running `bun run check:ui -- --surface=limited-list,limited-your-events`
reproduces the exact same numbers, byte-for-byte. This PR's diff touches
only `src/components/deckbuilder/**`, `scripts/ui-gate/surfaces.ts`'s
`deck-builder` walk, and `scripts/ui-gate/budgets.json`'s `deck-builder`
cells — nothing under `src/components/limited/**` or either surface's own
walk in `surfaces.ts`.

**Likely cause.** Probably account-state drift (the number of events/rows
`/limited` renders for the `TOLARIA_UI_EMAIL` test account has grown since
these cells were last recorded — each event row adds several `small`
controls), not a code regression. `small`'s per-control debt at these two
surfaces already has an open tracker.

**Why it may not deserve a new issue.** #2659 ("Coarse-pointer tap targets:
Limited list controls at 22-40px, overflow-menu items at 28px") already
owns the `small`/touch-target debt on this exact surface family — this may
just be #2659's existing ceiling needing a re-record pass rather than a new
problem. The `starved 1` at `390x844x3`/`1180x820x2` (new, not just
"budget exceeded" but a genuinely new starved-container reading at those
two cells) is the one piece that might warrant its own look — I did not
investigate what specifically starves there, since it is outside this
issue's target files.

**Disposition.** Re-record `scripts/ui-gate/budgets.json`'s `limited-list`
/ `limited-your-events` cells against current numbers (or fix the
underlying account-state assumption in `surfaces.ts` if the walk should be
pinning a fixed event count), and confirm whether the two new `starved 1`
readings are real regressions or the same account-state drift.
