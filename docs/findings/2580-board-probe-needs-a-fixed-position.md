---
title: The /game board cannot be budgeted until check:ui can load a fixed position
discoveredBy: 2580
status: draft
confidence: high
---

**What is wrong.** `bun run check:ui` (#2580) can reach `/game` reliably, but
the numbers it measures there are not reproducible, so the surface has no
budgetable ceiling. Two consecutive runs of the **same tree** (`2f4d0da5`, no
edits between them) measured `cardsOcc 4` and then `cardsOcc 5` at
`844x390x3`. The board is whatever position the lane happened to resume or
deal, and the occlusion count tracks hand size, because the hand fan overlaps
its own tiles by design.

**Evidence.** `scripts/ui-gate/budgets.json` → surface `game-board`, now
`{"status": "unwalked"}` with the two readings in its `reason`; the run logs
are pasted in PR for #2580. The walk itself is
`scripts/ui-gate/surfaces.ts` → `ensureBoard`, which resumes an existing match
(never conceding one it did not create) or deals a solo game from the lobby.

The unblock already exists in the lane and is one budget row away: the
`game-stress` surface loads the DB debug scenario
`UI stress — full board, full hand, deep piles` (ADR 0044), which is a fixed
position. It is currently `unwalked` for a different reason — it refuses to
load a scenario into a match the lane did not create, and an active game was
in progress when the budgets were recorded. Close `game-stress` from an empty
lobby and the board becomes measurable; `game-board` can then either stay
withdrawn or be re-budgeted on the deterministic metrics only.

**Why it may not deserve its own issue.** It is a two-line budget change
sitting behind "run the lane once with no game in progress", so it may be
cheaper as a checklist item on the next UI slice than as a ticket. What argues
the other way: as long as both board rows are `unwalked`, the gate has **zero**
coverage of the single most complex screen in the app, and the PRD #2405
slices that will change the board are exactly the ones that need it.
