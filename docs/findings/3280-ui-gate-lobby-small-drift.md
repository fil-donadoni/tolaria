---
title: check:ui is red on the base tip — lobby @ 1440x900x2 exceeds its `small` budget by one control
discoveredBy: 3280
status: triaged
issue: 3320
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

---

**Resolved — and this draft's own premise was wrong.** Filed as issue #3320,
fixed in PR #3326.

The `+1` was not a control that shipped without the budget seeing it. It was a
leaked ui-gate fixture deck: `check:ui`'s deck-builder walk creates a real
`userDecks` row and, when a run aborts, fails to delete it (issue #3184). Five
such orphans had accumulated on the dev account — byte-for-byte copies of the
walk's own decklist. Deleting them took `small` 85 → 79 with no code change.

The real defect was one level down, and the "find the 85th control" framing
above would never have reached it: `probe.js`'s tap-target scan culled on the
VERTICAL viewport band alone, so it counted every control scrolled out
sideways. The lobby's "Your decks" shelf is an uncapped `overflow-x-auto` strip
with one tile per deck, so the count tracked the account's deck count — which
is what the 22 / 83 / 84 / 85 re-record history had been recording all along,
one banked ceiling at a time. Culling by scroll port on both axes took the row
to 27.

The two arguments this draft made for its own ticket both survive, pointed at
the right cause: the count moved without a re-record, and a red base tip makes
the receipt unenforceable. What it got wrong was assuming the movement was in
the UI rather than in the instrument measuring it.
