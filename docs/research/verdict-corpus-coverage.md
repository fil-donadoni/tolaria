# What the Verdict corpus covers, and what it can be asked (issue #3588, ADR 0124)

**Question.** Before spending anything on a richer evaluation — piecewise
terms, boosted trees, a small network — two things have to be known about the
corpus those models would be fitted on: **which decisions it holds**, and **how
much of its disagreement any model could even buy**. A capacity measurement
that skips this concludes something true of the decisions the corpus happens to
contain, and gets read as a conclusion about the evaluation.

**Verdict up front: the corpus is 174 verdicts / 492 pairs, and only 50 of
those pairs — 10.2% — are reachable by any model at these features. Not one
verdict in the whole corpus was judged with a non-empty stack, targeting and
mulligan decisions are absent entirely, and combat is 21 pairs. The pairs the
evaluation fails are dominated by pairs nothing can fix: 47 blind and 65
contradictory against 50 addressable.** Under the decision rule registered
before the measurement (below), that is the stop condition for the model-class
experiment: the bottleneck is the corpus and the feature space, not the
linearity of the scorer.

## The census

Measured at `667645162`, over the whole corpus (the blade registry plus
`data/verdicts/**`), at the committed weight vector:

```
BLADE_COVERAGE=1 BLADE_COVERAGE_OUT=<path>.json \
  bunx vitest run --config vitest.blade.config.ts \
  convex/gre/ai/blade/__tests__/verdict-coverage.spec.ts
```

| class             | verdicts | responses | pairs | satisfied | blind | contradictory | addressable |
| ----------------- | -------- | --------- | ----- | --------- | ----- | ------------- | ----------- |
| land-drop         | 26       | 0         | 92    | 53        | 16    | 7             | 16          |
| cast              | 61       | 0         | 129   | 91        | 6     | 13            | 19          |
| activate          | 37       | 0         | 123   | 103       | 10    | 6             | 4           |
| declare-attackers | 9        | 0         | 11    | 4         | 1     | 4             | 2           |
| declare-blockers  | 7        | 0         | 10    | 8         | 0     | 2             | 0           |
| targeting         | 0        | 0         | 0     | —         | —     | —             | —           |
| resolution-choice | 11       | 0         | 39    | 24        | 14    | 0             | 1           |
| optional-payment  | 2        | 0         | 2     | 2         | 0     | 0             | 0           |
| mulligan          | 0        | 0         | 0     | —         | —     | —             | —           |
| protocol          | 1        | 0         | 1     | 1         | 0     | 0             | 0           |
| pass              | 20       | 0         | 85    | 44        | 0     | 33            | 8           |
| **TOTAL**         | **174**  | **0**     | 492   | 330       | 47    | 65            | **50**      |

- **satisfied** — the evaluation already orders the pair correctly (67.1%).
- **blind** — the two candidates carry IDENTICAL feature vectors, so no weight
  vector orders them. A limit of the feature space, never of the model class.
- **contradictory** — the pair is half of an anti-parallel couple: satisfying
  it unsatisfies its partner. Also unreachable by any weights over these
  features.
- **addressable** — `violated − blind − contradictory`. **The only column a
  model-class experiment may claim.**

The ceiling the whole exercise is bounded by: 330 satisfied + 50 addressable =
**77.2%**. The remaining 22.8% is not a scorer's failure.

## What this says

**1. The corpus cannot speak about most of a game of Magic.** Four classes
carry evidence — cast, activate, land-drop and pass, 429 of the 492 pairs.
Combat is 21 pairs across both sides of it. Targeting and mulligan are zero.
Every judgement in the corpus was given with an EMPTY stack, so the corpus says
nothing whatever about responding, holding up, or the value of a spell on the
stack.

That is not accidental and it is not a sampling fluke: it is what the
collection channel could carry. Verdicts were given in a handful of Premodern
games and a couple of Vintage Cube games, and until issues #3515/#3516 the
lowering REFUSED a position with a stack outright. The corpus is the subset the
machinery could transport, and its shape is a record of that machinery's limits
rather than of the game's decisions.

**2. Contradictions outnumber blind pairs, and they cluster on act-versus-pass.**
65 contradictory against 47 blind, and 33 of the 65 sit in the `pass` class —
pairs where one judgement says act and another, on features the evaluation
cannot tell apart, says wait. Some of that is a missing term (the evaluation
has no notion of holding priority for a reason it cannot see); some of it is
simply two judgements that disagree. **The census cannot separate those two**,
and neither can the fit: both arrive as "unsatisfiable". Distinguishing them is
what the contradiction-quarantine of ADR 0128 §6 exists for, and it is the
strongest argument in this document for building it.

**3. The class with the most blind pairs is `resolution-choice` (14 of 39).**
Picking one card out of a library is a decision the 1-ply feature vector barely
sees: the settled states differ by which card moved zones, and the evaluation's
terms do not price a card in hand by what it is. That is a missing-term finding,
and it is the shape of decision a `search` judgement always produces — worth
knowing before the corpus fills with them.

## The decision rule, registered before the numbers were seen

> **Step 0 (this document)**: census by class. No conclusion about a class with
> fewer than ~50 pairs; such a class is a collection target, not a result.
> **Steps 1–2** (exact ceiling accounting, then a linear-separability test on
> the clean subset): run afterwards, reported per class.
> **Step 3** (out-of-sample comparison of linear against boosted trees at
> identical features): if the addressable pairs are under ~10% of the corpus,
> **stop** — the bottleneck is data and features, not the model. "Not
> demonstrated" is accepted in advance as a legitimate outcome; it is not
> "absent".

**Applying it: 10.2% is on the line, not past it.** Read honestly, that is the
stop condition met, not cleared — and per class the picture is the same: the
headroom is 19 pairs in cast, 16 in land-drop, 8 in pass, 4 in activate. A
model-class experiment on 47 addressable pairs across four classes cannot
produce a result that survives a confidence interval.

**Steps 1 and 2 are therefore already answered in part** — the ceiling
accounting IS the table above — and step 3 is deferred, not cancelled. It is
re-armed when the target classes clear the evidence floor.

## Collection targets

In priority order, by what the corpus cannot currently say anything about:

1. **Responding with a non-empty stack — 0 pairs.** The single largest hole,
   and newly collectable: `ScenarioSpec` has carried a declared stack since
   issue #3515 and a triggered ability since issue #3516.
2. **Declare blockers — 10 pairs; declare attackers — 11.** Combat is also
   where the 1-ply settled probe is weakest (combat value washes out at the
   horizon, which is why combat quality lives in `selectRootMove`'s
   tie-breaks). A corpus without it cannot see the region most likely to need
   a richer model.
3. **Targeting — 0 pairs.** Which of two creatures to burn is exactly the
   "same number, different value in context" judgement the whole non-linearity
   question is about.
4. **Resolution choice — 39 pairs, 14 of them blind.** Collect with the blind
   fraction in mind: more of the same decisions will produce more blind pairs,
   not more evidence, until a term prices what is being searched for.
5. **Mulligan — 0 pairs.**

**These positions should be AUTHORED, not waited for.** A scenario spec
describes a board and its stack, and `seed:scenario` loads it into a live game;
the cold-judging surface (PRD #3574) is the vehicle. Filling the blocking class
is half an hour of deliberate authoring, against ten games of hoping the right
block occurs.

**And the same stratification applies to telemetry.** Harvesting judgements
from ordinary play, without per-class quotas, pours in the classes that are
already over-represented — land drops and passes are the overwhelming majority
of decision points — and coverage gets WORSE as the corpus grows.

## What this document does not claim

- It says nothing about whether a non-linear model would help **on decisions
  the corpus does not contain**. That is the open question, and it stays open.
- The blind and contradictory counts are properties of the CURRENT feature
  basis. A new term moves pairs out of `blind` and into the addressable
  remainder — that is what issue #3534 measured for `colorCoverage`, which
  un-blinded exactly two pairs.
- The satisfied fraction is measured at the committed weights, which were
  themselves fitted on this corpus. It is a before-state for the fit, not a
  claim about the Bot's strength.
