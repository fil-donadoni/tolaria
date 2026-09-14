---
title: check:ui's game-debug-sheet-ai `small` count flaps across runs of the same tree
discoveredBy: 3336
status: draft
confidence: high
---

**What is wrong.** `game-debug-sheet-ai` is budgeted on `small` (the
pointer-blind sub-44px tap-target count), but that number is not a function of
the tree: three `bun run check:ui` runs of the SAME commit reded twice, at two
DIFFERENT viewports, with two different overshoots. A budgeted row that reds on
a re-roll is the condition #2512 calls worse than no ceiling, and it is the only
thing standing between a lobby-only diff and a green receipt.

**Evidence.** Same worktree, same HEAD, three consecutive runs (issue #3336):

| viewport   | run 2 | run 3 | run 4 | ceiling |
| ---------- | ----- | ----- | ----- | ------- |
| 1440x900x2 | 11    | 11    | 15    | 11      |
| 390x844x3  | 8     | 7     | 7     | 8       |
| 844x390x3  | 7     | 9     | 7     | 7       |
| 820x1180x2 | 9     | 9     | 9     | 9       |
| 1180x820x2 | 9     | 9     | 9     | 9       |

`cardsOcc` / `ctrlsOcc` / `starved` held every value on every row through all
three runs — only `small` moved, and only on the two viewports where the sheet
shares the screen with the AI trace ring. The row's own budget note already
records the ring as the subject the walk must clear
(`ctrls n13 small12` vs `ctrls n21 small19` at 1440x900x2 before clearing), so
the likely reading is that `surfaces.ts`'s clear is winning a race rather than
holding a state: what it removes is whatever the bot had logged by then, and a
slower bot turn leaves more controls behind it.

**Why it may not deserve its own issue.** It may be one line on whatever owns
the lane's shared-account problem: the same runs also hit
`an active game the lane did not create` from a concurrent session on the same
dev account (`lobby-vs-ai`'s declared-unwalked note describes exactly this), and
both are the same root cause — the lane measures a deployment it does not own.
If the lane gets its own account, the bot is the lane's own bot and the ring is
deterministic; this row may then stop flapping without anyone touching it.
