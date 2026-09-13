---
title: Spending a depletion land's counter scores +1 for the bot, and the tradeoff cannot be written as a Verdict
discoveredBy: 2712
status: draft
confidence: high
---

**What is wrong.** A depletion land (`convex/cards/sets/mmq/colorless.ts`) is a
FINITE mana source: two activations, two mana each, then it sacrifices itself.
"Do I spend a use now, or pay with something renewable?" is a real strategic
question, and the engine answers it today in two places, one of which is right
for a reason that has nothing to do with the card and one of which is actively
backwards.

Two separate defects, and the second is the one that blocks the obvious fix.

**1. The evaluator PREFERS burning a use.** Measured on an identical board —
Hickory Woodlot (2 depletion counters) + two untapped Forests, Grizzly Bears
({1}{G}) in hand — scoring the two post-cast worlds with `evaluate(state, "p1")`
on the committed weight vector:

| Paid with                           | `evaluate`     |
| ----------------------------------- | -------------- |
| the two Forests (Woodlot untouched) | 270.081632     |
| the Woodlot (one counter spent)     | **271.081632** |

The Woodlot world scores exactly **+1.000000** higher, and the number is not a
coincidence: `manaSourceTermFor` (`gre/evaluate.ts`) prices every permanent with
a mana ability at `manaWeight` untapped and `tappedManaWeight` tapped, and
`manaWeight − tappedManaWeight` is exactly 1.0 on the committed vector
(11.110284 − 10.110284). One source tapped instead of two reads as one point of
material saved. That the land is now half gone is invisible: no term counts
counters, and a Woodlot with one use left prices identically to a Forest.

It is only the LAST use that registers, and only because issue #2712 taught the
search's coarse model to sacrifice the land in the tree (`applyTapPlan`,
`gre/applyMove.ts` + `gre/search.ts`). Same board with the Woodlot at ONE
counter:

| Paid with               | `evaluate`     |
| ----------------------- | -------------- |
| the two Forests         | 270.081632     |
| the Woodlot (land dies) | **256.003048** |

−14.08. So the engine prices the death and not the depletion: a two-use land is
free, free, then catastrophic, when it should be half-priced twice.

**2. The bot nonetheless plays it correctly today — for an unrelated reason.**
`planManaPayment`'s coloured-pip selection is lexicographic `(rank,
colour-count, yieldTotal)` with the **smallest** yield winning
(`convex/gre/moves.ts`, the `bestYield` tie-break added by issue #3027 to stop
the greedy burning a Black Lotus on a pip a one-mana source covers). A Forest
yields 1 and the Woodlot 2, so the Forest takes the pip. Verified
order-independent — the plan is `[forest0, forest1]` whether the Woodlot sits
first or last on the battlefield, at 2 counters and at 1, for `{1}{G}` and for
`{G}{G}` — and the Woodlot is reached for only when the cost genuinely needs it
(`{2}{G}{G}` yields `[forest0, forest1, woodlot]`).

That is the right behaviour and it generalises honestly ("don't spend a big
source on a small pip"). It is just not _about_ scarcity: it would make the same
choice for a Black Lotus, and it would make the same choice if the Woodlot had
a hundred uses.

**3. The tradeoff cannot currently be written as a Verdict.** This is the part
that matters for how it gets fixed. `planManaPayment` emits ONE plan per cast,
so `enumerateMoves` offers a SINGLE `cast-spell` Move for the position above —
measured: `[{kind:"pass"}, {kind:"cast-spell", …, tapPlan:[forest0, forest1]}]`.
A blade verdict needs a `(want, over)` PAIR of candidate moves, and there is no
second candidate: the choice was made inside the planner, before the search ever
saw it. So "cast off the Forests, not off the Woodlot" is unrepresentable in the
verdict corpus, and no re-fit of `DEFAULT_EVAL_WEIGHTS` can reach it.

(This is also why issue #2712's own blade entry is a reachability `predicate`
rather than a fitted verdict — see `gre/ai/blade/registry.ts`. That decision was
made for a different reason, and this finding confirms it was the only option
available.)

**Evidence.** All numbers above are from throwaway harnesses over
`enumerateMoves` / `planManaPayment` / `evaluate` / `applyMoveForSearch`, on the
weight vector committed at the time of issue #2712. Reproducible from:

- `convex/gre/evaluate.ts` — `manaSourceTermFor` (the `manaWeight` /
  `tappedManaWeight` pair), `availableManaFor` (counts any untapped source as
  ONE mana — the documented issue #2247 divergence, which also cannot see that
  this land taps for two)
- `convex/gre/moves.ts` — the `bestYield` tie-break in the coloured-pip loop,
  and the single-plan return that makes the pair unrepresentable
- `convex/gre/applyMove.ts` / `convex/gre/search.ts` — `applyTapPlan`, which
  pays the counter and sacrifices the land since issue #2712

**Why it may not deserve its own issue.** The observable behaviour is CORRECT
today on every board tested, and the bug is a latent mispricing rather than a
wrong play — the `yieldTotal` tie-break happens to cover the cases a depletion
land reaches. It bites only where that tie-break does not decide: a cost the
Woodlot must help pay anyway, a choice between two multi-mana sources, or any
position where the evaluator's +1 outvotes something. Five cards in the pool
reach it at all.

Against that: the `yieldTotal` coincidence is load-bearing and nothing names it
(a future planner change that reorders that lexicographic key silently flips
every depletion land to "burn it first", and the evaluator will agree with the
flip). And the fix is not small in either direction, so it is worth deciding
deliberately rather than at the moment it breaks:

- **A term** — an `EvalTerms` key pricing a finite mana source below a renewable
  one (a Woodlot with N uses left is worth roughly N/∞ of a Forest). Needs its
  row in `src/lib/ai/eval-term-labels.ts` per `.claude/rules/bot-development.md`,
  and it is the shape ADR 0124 §5 asks for — REPORT the missing term rather than
  patch the root. It prices the depletion but still cannot be fitted, because
  there are no verdict pairs to fit it against.
- **Alternative tap plans as Moves** — `planManaPayment` returning more than one
  plan, so the search picks the payment instead of the planner. That makes the
  pair representable and the term fittable, and it widens the branching factor
  of the hottest path in the bot (`enumerateCastMoves`, every ISMCTS rollout).

They are not alternatives: the term without the plans is unfittable, the plans
without the term give the search a choice it evaluates backwards (+1 for
burning). Either is a slice of its own; doing one and calling it done is the
failure mode worth naming here.
