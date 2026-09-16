---
title: game-board concedes nothing of its own — it relies on a sibling surface's cleanup to free the lane's game
discoveredBy: 3695
status: draft
confidence: high
---

**What is wrong.** Since issue #3695 `game-board` creates the lane's solo game
(`ensureScenarioBoard` → `ensureBoard`, which sets `ctx.createdGame = true`) and
loads a declared position into it, but it declares no `cleanup` of its own —
alone among the six `needsGame` surfaces. The game it dealt is ended downstream,
by `game-debug-sheet`'s cleanup ("END the solo game this row dealt",
`scripts/ui-gate/surfaces.ts`), which runs on both the happy and the failure
path.

**Why it holds today.** All six `game-*` surfaces carry byte-identical
`entries: ["src/routes/lobby.route.tsx", "src/routes/game.route.tsx"]`, so ADR
0131 diff-scoping can never scope `game-board` without also scoping
`game-debug-sheet`. In the enforced path — a full run or any SCOPED run — the
sibling's cleanup always runs before the next viewport starts.

**Where it would break.** A run whose scope contains `game-board` and NOT
`game-debug-sheet`: today only a hand-typed `--surface=game-board` diagnostic
run. `ctx.createdGame` is rebuilt per viewport (`index.ts`), so at the second
viewport `ensureBoard` takes the `Resume` branch with `createdGame` false and
`ensureScenarioBoard` throws `Unreachable("an active game the lane did not
create is in progress")` — classified UNWALKED, and since `game-board` is no
longer in `UNWALKED_SURFACES` that reds the run. The fix is one `cleanup`
mirroring `game-debug-sheet`'s, so the surface is self-contained rather than
depending on a sibling's side effect.

**Why it may not deserve its own issue.** It cannot fire on any path `land`
enforces, and the change is not free: conceding at the end of `game-board`
makes every later board surface in the same viewport deal a fresh game
(mulligan prompts included), which changes the wall time and the sequence the
issue #3695 receipts were measured over. It is a line on whichever slice next
re-walks the board rows (issue #3506) rather than a ticket.
