# Reward saturation and in-tree selection — where concentrating visits is safe (issue #9095)

> **Dated:** 2026-11-12. Measured on branch `fix/issue-9095` at `377dd6917`,
> `d7c3f24ba`, `27fe76f42`, `873ecbaec`, `e43498f49` (instrumented as
> `a8cdec0a2`) and `e767aee72`. Every number below is as of those heads.

**Question.** Two root moves tied on reward are compared on the mean margin
of their subtrees (`material-tiebreak`). In-tree selection cannot concentrate
visits among reward-tied children, so a root move with eight continuations
reads each through an eighth of its visits and one with two through a half:
the mean prefers the move with fewer continuations, whatever its lines are
worth. The Caustic Bronco twin (`blade/scenarios.ts`) loses to this on every
seed at 400, 1000 and 2000 iterations. Where can selection concentrate without
breaking the decisions that pass today?

**Verdict up front.** At a node that meets two conditions together:

1. the reward is **saturated** — every child carries the same mean reward,
   because every leaf below sits past the clip (`materialFull`, 500 margin
   points);
2. the Bot **must decide** there — an attack or block declaration, with no
   `pass` among its moves.

A bonus on the children's one-ply policy value at those nodes fixes the twin
with zero new reds on the `must` tier and no root margin gap made thin.
Dropping either condition breaks entries, or leaves them a coin flip that a
5-seed census does not always catch.

## Method

`bun run blade:census` on the hosted matrix (issue #9276): every `must` entry
at its own budget and seeds, 516 entries, 2467 (entry, seed) rows (2477 from
`873ecbaec`, after a rebase). Each arm is compared with a base arm on the same
head; the base fails the twin (5 seeds) and nothing else.

The last round ran an instrumented census (`a8cdec0a2`, never landed) that
also records, per row, the **root margin gap**: the chosen candidate's mean
margin minus the best other candidate's. A row decided by `material-tiebreak`
on a gap under 5 points is a coin flip between seeds, whatever it picked.

## The mechanism: the even spread prices waiting

The entries that go red are almost all "acts now → picks `pass`" (removal
that names the right target, a creature cast, an activation). Root candidates
on three of them, seed 1, base → concentrated at every bot node, 0.05 band:

| entry                         | `pass` mean margin | acting mean margin |
| ----------------------------- | ------------------ | ------------------ |
| keyword bonus (deathtouch)    | −156.2 → −146.6    | −149.3 → −149.9    |
| symmetric lock (Disenchant)   | 10.6 → 29.8        | 21.9 → 21.9        |
| self-sacrificing ETB (Phlage) | 76.2 → 69.5        | 81.0 → 68.5        |

`pass`'s subtree holds the Bot's later options, the same act one window later
among them. Read through its best continuation, waiting is worth as much as
acting now, and the tie-break cannot tell them apart. The even spread over a
priority window's moves is what dilutes `pass` and keeps acting ahead. It is
the same dilution that loses the Bronco twin, but at a different kind of node:
the twin is lost at the **attack declaration** under `pass` (eight tied
declarations), where nothing can be deferred.

Saturation does not escape this. On "self-tap source: pays a {T} ability
entirely from the OTHER lands" (root saturated), 8 seeds at 400 iterations:

| arm                                        | activate − `pass` mean margin | picks        |
| ------------------------------------------ | ----------------------------- | ------------ |
| base                                       | +14 to +16                    | activate 8/8 |
| saturation, every bot node, span 3         | −1 to +2                      | activate 5/8 |
| saturation, every bot node, span 4         | 0 to +3                       | activate 7/8 |
| saturation, declarations only, span 3 or 4 | +29 to +33                    | activate 5/5 |

The census passed the "every bot node" arms at spans 4 and 8 only because the
entry's three seeds fell on the right side of a zero gap.

## Census

Policy-value bonus, span 3, Bot's own nodes below the root (instrumented
round, 2477 rows; tie-break rows are those `material-tiebreak` decides on both
arms with the same pick):

| gate                                  | new red entries (seeds) | entries whose pick changed | tie-break rows: gap unchanged / grew / shrank | rows made thin (gap under 5, was 5 or more) |
| ------------------------------------- | ----------------------- | -------------------------- | --------------------------------------------- | ------------------------------------------- |
| **saturation, declarations only**     | **0**                   | 2                          | 599 / 21 / 16                                 | **0**                                       |
| saturation, declarations only, span 4 | 0                       | 2                          | 599 / 21 / 16                                 | 0                                           |
| 0.05 band, declarations only          | 4 (9)                   | 8                          | 494 / 65 / 52                                 | 1                                           |
| saturation, every bot node            | 1 (1)                   | 8                          | 271 / 164 / 170                               | 6 rows, 4 entries                           |
| 0.05 band, every bot node             | 17 (43)                 | 34                         | 55 / 166 / 267                                | 63 rows, 24 entries                         |

Every arm fixes the twin. The two picks that change under the shipped gate
are the twin and one seed of "emerge beside Drought's tax", inside its allowed
set. One row outside the tie-break count moved from `mean-reward` to
`material-tiebreak` at a gap of 2.2 ("raised target: Skyclave Apparition",
seed 4; its seed 2 sits at 9.6 on the base). The base itself has 161 of 643
tie-break rows under 5; the shipped gate has 158 of 647.

The shipped head (`e767aee72`: saturation, declarations only, span 4) was
censused once more without the instrument: 0 new reds, the twin fixed, the
same 2 entries with a changed pick. Six rows change their deciding mechanism.
Three are one entry, "activation timing: holds a sacrifice engine through its
own main phase": the search now holds on all five seeds by `material-tiebreak`
where `hold-trick` decided three on the base
(docs/findings/9095-hold-trick-preempted-by-the-saturation-prior.md).

Earlier rounds, every bot node below the root unless noted:

| arm                                                                              | gate (mean-reward span) | new red entries | seeds |
| -------------------------------------------------------------------------------- | ----------------------- | --------------- | ----- |
| Reward-Tie Margin Term: bonus on sampled mean margin (issue comment, 2026-11-11) | 0.05                    | 18              | 45    |
| only the best child by policy value                                              | 0.05                    | 21              | 55    |
| the best `⌈0.5·visits^0.25⌉` by policy value                                     | 0.05                    | 5               | 13    |
| policy-value bonus, span 4                                                       | 0.01                    | 3               | 8     |
| policy-value bonus, span 4                                                       | 0.002                   | 1               | 5     |
| policy-value bonus, span 4, opponent's nodes too                                 | saturation              | 1               | 1     |
| policy-value bonus, span 4, the root too                                         | saturation              | 2               | 7     |

The ranking signal does not matter: the sampled margin and the deterministic
policy value fail alike under a band. A width above 1 leaves a two-child node
averaged while an eight-child one narrows, so the progressive width passes
the twin and then reds the original Bronco entry (expect saddle) at 2000
iterations, 5 seeds of 5.

## The span

Caustic Bronco pair, 5 seeds per cell, saturation gate (the declaration gate
does not move these: the twin is decided at its attack declaration):

| `saturationPriorC` | twin @400 | twin @1000 | twin @2000 | original @2000 |
| ------------------ | --------- | ---------- | ---------- | -------------- |
| 1                  | saddle 5  | saddle 5   | pass 5     | saddle 5       |
| 2                  | saddle 5  | pass 5     | pass 5     | saddle 5       |
| 3                  | pass 5    | pass 5     | pass 5     | saddle 5       |
| 4                  | pass 5    | pass 5     | pass 5     | saddle 5       |

The twin expects `pass`, the original the saddle. Root margin gaps at the
entries' own budgets: the twin leads by 8 to 10 at span 3 and by 13 to 16 at
span 4; the original by 24 at span 3 and by 21 to 23 at span 4 (45 on the
base). Span 4 ships: its smaller gap is the larger of the two. The price is
exploration. UCB1 returns to the lowest-valued child once `ln(avail)` outgrows
`(span / ucbC)²`: about 100 visits of the node at span 3, about 3500 at span
4, so within a live budget the worst declaration of a saturated node is read
once.

With `becomeSaddled` made a no-op the original entry picks `pass` on 5 seeds
of 5, so it discriminates.

## Other measures

- **Weight Fit.** The twin and the original are Conditional Verdicts with no
  right-hand half, so the fit does not read them: `fittedEvalWeights.ts` is
  byte-identical with the twin in the registry, and the search pins
  (`searchCost`, `searchForcedPass`, `searchLeafScore`) do not move.
- **Held-out pick agreement** (`bun run verdicts:pick-agreement`, n = 24,
  indicative) on the shipped head: 12/24 verdicts and 74/120 seeds on both
  arms, no held-out pick changed. On the wider "saturation, every bot node,
  span 4" arm: 12/24, seeds 75/120.
- **CPU** per 1000-iteration search on that wider arm, median of 4
  interleaved runs on a loaded machine: 0.96 to 1.02 of the base on three
  mid-game entries, 0.79 on the saturated twin.
- **How often the root saturates:** 61 of 2477 base rows, 16 entries. The
  clip is 500 margin points, about three vanilla 2/2s.

## Limits

- The gate is the hard clip. Under the `reward-soft-tail` variant (ADR 0176)
  nothing saturates and the prior never fires; the twin would be red again.
- The dilution stays at every priority window and among near-tied,
  unsaturated children. Removing it there needs a cost of waiting the search
  can read first: today that cost IS the dilution.
- A census on 3 to 5 seeds does not see a gap that collapsed to zero and
  happened to fall right. The margin gap does; the instrument that records it
  is not on the base.
