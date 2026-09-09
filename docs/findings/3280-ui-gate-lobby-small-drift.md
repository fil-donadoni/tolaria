---
title: check:ui is red on the base tip — lobby @ 1440x900x2 exceeds its `small` budget by one control
discoveredBy: 3280
status: draft
confidence: high
---

**What is wrong.** `bun run check:ui` fails on `origin/staging` itself, not on
any branch: `lobby @ 1440x900x2: small 85 > 84`. One desktop control on the
lobby is under the tap-target floor beyond what the budget records, so every
UI-affecting PR from here inherits a red receipt it did not cause.

**Evidence.** Measured twice on 2026-09-09, same machine, same deployment:

- `fix/issue-3280` (a diff touching no lobby file — the changed `src/` files are
  `components/board/*-button.tsx`, `components/cards/alt-cost-picker.tsx`,
  `hooks/useHandCardCommit.tsx`, `lib/board-chrome-v4.ts`,
  `routes/design-system/sections-buttons.tsx`):
  `FAIL lobby 1440x900x2 … small85 … — over budget: small 85 > 84`
- `origin/staging` at `a8370a45c`, checked out detached in the same worktree:
  the identical row, `small85`, identical verdict.

The other four lobby viewports pass (`small` 5 / 10 / 16 / 16 against their
budgets), so this is one control at desktop width, not a systemic regression.

**Why it may not deserve its own issue.** `small` is sub-44px tap-target debt
and issue #2659 already owns lowering it — the `check:ui` reason strings say so
in as many words at `limited-build` and `draft-pool-peek`. This may be one more
row for that ticket rather than a new one. Two things argue the other way: the
count moved WITHOUT a re-record (the budget was 84 and the tree now measures
85, so something shipped a control the budget never saw), and a red base tip
makes the receipt unenforceable for every skin-lane PR until it clears — which
is the enforcement ADR 0110 §4 leans on entirely. Re-recording the ceiling
would hide the drift rather than close it; finding the 85th control is the
first step either way.
