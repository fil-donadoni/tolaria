---
title: A cast-then-attack-with-haste 2-ply decision needs ~5x the blade suite's typical budget to converge
discoveredBy: 2248
status: draft
confidence: medium
---

**What is wrong.** The negative control proving the #2248 sorcery-speed hold
tie-break doesn't swallow a decisively-better cast ("flash permanent NEGATIVE
CONTROL: still casts hasty Raging Kavu for lethal this turn",
`convex/gre/ai/blade/registry.ts`) needed `budget.iterations: 2000` to converge
on all 5 seeds — every other `must`-tier entry in the file uses 200-400. At
400/800/1200 the search had NOT yet identified `cast-spell Raging Kavu` as the
top candidate on any of the 5 seeds; at 2000 it was top on all 5, by a mean
margin (0.067) comfortably above `OUTCOME_EPS` (0.05).

**Evidence.** Measured via a throwaway debug spec calling `searchWithTrace`
directly on the built blade state at increasing budgets (not committed):
400/800/1200 iterations → `pass` chosen on all 5 seeds; 2000 → `cast-spell` on
all 5, `mean(cast) = 0.8357` vs `mean(pass) = 0.7686`.

**Why this shape is expensive.** The decision is genuinely two-ply: cast the
hasty creature, THEN pick a declare-attackers subset out of 2^n combinations
once it joins the board (`enumerateAttackerMoves`, `convex/gre/moves.ts:1562`,
full power-set over the optional attackers). With 3 pre-existing attackers +
the newly-cast one, that is up to 16 attack-subset children under the
`cast-spell` root edge alone, on top of the auto-tap mana-payment branching for
the cast itself. A budget sized for the suite's typical one-shot decisions
(400) just hasn't spread enough visits down that specific line yet.

**Why it may not deserve its own issue.** This is not a bug in the #2248 fix —
the position is CORRECTLY solved at a higher budget, and the note on the entry
records the measurement so a future reader doesn't re-litigate why this one
entry's budget is an outlier. It also isn't obviously worth a general "harden
two-ply combinatorial decisions" ticket on its own: it's one measurement on one
position, not a swept survey of how common this shape is elsewhere in the
catalogue (haste + flash is a narrow keyword intersection). If a similar
budget cliff shows up on an unrelated haste/combat-trick entry in the future,
that would be the point to open a real ticket (a genuine multi-instance
pattern), not this single observation.
