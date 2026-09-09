---
title: A bug report cannot say which search budget the bot actually ran with
discoveredBy: 3192
status: draft
confidence: low
---

**What is wrong.** Difficulty is one knob — the `SearchBudget` handed to
`search()` — and it is chosen client-side, never persisted with the game. A
report filed against bot PLAY therefore cannot be attributed to a rung: the same
board is a blunder at `medium` (400 iterations) and expected behaviour at `easy`
(3 iterations, documented as deliberately shallow and beatable).

PR #3271 closed most of this the day after issue #3192 was filed:
`tolaria:aiDifficulty` is on the bug-report preference allowlist, so new reports
carry the reporter's difficulty. The residue is that a PREFERENCE is not a
BUDGET — it is the value in `localStorage` at submit time, not the one the
search ran with. A reporter who changes difficulty, or resumes a solo game
started on another setting, files a report that reads as authoritative and is
wrong.

**Evidence.** `convex/gre/difficulty.ts` — `DIFFICULTY_BUDGETS` is
`easy: {iterations: 3}` / `medium: {iterations: 400}` / `hard: {iterations:
1200}`, and `grep -rn difficulty convex/` finds it nowhere outside the preset
module: no column on the game row, no field on the saved state.
`AiDecisionRecord` (`src/lib/ai/diagnostics.ts`, the ring a report carries)
holds `at / expectedKind / moveKind / outcome / phase / seq / via` — the exit
the driver took, never the budget it took it with.

Issue #3192's own report is the demonstration in the negative: filed
2026-09-08, one day before #3271 landed, so its payload has neither `build` nor
`preferences`, and the rung had to be inferred from inter-move timestamps
(3.7s and 6.5s against a `THINK_DELAY_MS` of 200 — consistent with `medium` or
`hard`, proof of neither).

**Why it may not deserve its own issue.** #3271 already answers the question in
the common case, and the residue only bites a reporter who changed the setting
between playing and reporting. If a second bot report ever arrives whose rung
the preference gets wrong, this becomes a one-field addition to the decision
record — carry the `iterations`/`timeMs` the Brain was invoked with — and earns
its ticket then.
