---
title: check:ui has been red on main since before this issue — limited-build @ 844x390x3 cardsOcc/ctrlsOcc 15 > 13
discoveredBy: 3054
status: triaged
issue: 3114
confidence: high
---

**What is wrong.** `bun run check:ui` fails on `main`. The failing row is
`limited-build @ 844x390x3: cardsOcc 15 > 13, ctrlsOcc 15 > 13`. Every UI PR
therefore ships a red receipt, and the lane stops discriminating between "this
diff broke something" and "this tree was already red".

**Evidence.** Measured back to back on 2026-09-07, same machine, same
deployment:

- `feat/issue-3054`:
  `FAIL limited-build 844x390x3 cards zero0 occ15 … — over budget: cardsOcc 15 > 13, ctrlsOcc 15 > 13`
- a pristine detached worktree at `main` (`4bd2e86dc`), freshly
  `worktree:init`-ed: **the identical row, identical numbers**.

The diff under test cannot reach that surface: `limited-build` walks
`src/components/deckbuilder/pool-deck-builder.tsx`, which imports neither
`useCardSearch`, nor `useFullCatalogue`, nor the search index.

The ceiling looks stale rather than newly breached. `820x1180x2` measures the
same `occ15` on the same 24-card pool and carries a budget of **15**; only the
landscape-phone row still carries **13**. `scripts/ui-gate/budgets.json`'s own
`knownDebt` note for this surface records that these numbers moved with the
DEPLOYMENT and were re-recorded twice with no `src/` change (issue #2825,
`docs/findings/2671-limited-list-budgets-drifted.md`) — `cardsOcc` here is the
ADR 0075 column-pile overlay, so it is a function of the seeded fixture's pool
size, not of any component.

**Triaged 2026-09-07 → issue #3114 (board `Priority` P0).** The maintainer
took it as a ticket rather than a line on an existing tracker: the red blocks
the receipt for EVERY UI-affecting PR, and #3114 deliberately does not
pre-decide between the two readings below — it requires the verdict be argued
from a measurement.

**Why it may not deserve its own issue.** The remedy may be one line —
`844x390x3` `cardsOcc`/`ctrlsOcc` 13 → 15 — and that is arguably a line on the
existing #2659 / #2822 lineage rather than a ticket. It was deliberately NOT
done inside issue #3054's PR: re-recording a ceiling that another change moved,
from inside an unrelated PR, is exactly how a ceiling gets rubber-stamped. What
makes it worth writing down anyway is that the drawer is the only place the
measurement survives — a red that everyone routes around stops being read at
all, and this one is now on its third recorded drift.
