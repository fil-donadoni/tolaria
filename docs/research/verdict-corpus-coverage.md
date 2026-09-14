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

> **Correction, same day.** The first version of this document explained the
> 14 blind `resolution-choice` pairs as library searches the evaluation cannot
> tell apart. That was stated without inspecting the pairs, and it is wrong: the
> corpus holds **no library-search judgement at all**, and the 14 are
> protection-colour choices (12) and library ordering (2) — finding 3 below.
> Inspecting the blind pairs also turned up a second thing the census counts
> but should not: **12 of the 47 blind pairs are vacuous**, two copies of the
> same card that differ only by instance id (finding 4). Neither correction
> moves the conclusion: addressable is still 50, and excluding the vacuous
> pairs from the denominator puts it at 50 / 480 = **10.4%**, still on the line.

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

Excluding the 12 vacuous pairs (finding 4), which are not decisions at all: 480
pairs, 68.8% satisfied, ceiling **79.2%**, 35 genuinely blind pairs — 9 in
land-drop and 5 in activate rather than the 16 and 10 the table shows.

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

**3. The class with the most blind pairs is `resolution-choice` (14 of 39), and
none of them is a library search.** Twelve come from three blade entries about
choosing a protection COLOUR (Mother of Runes, Thornscape Master, and their
negative control), four pairs each; the other two are library ordering (a scry
and an explore). Both shapes are blind for the same reason: the choice changes
nothing on the board a 1-ply evaluation reads. Protection from a colour is worth
exactly what the opponent's colours threaten to do next; a card's position in
the library is worth exactly what the next draw needs. Neither is material the
settled state carries — both are GOALS, read from what the opponent is showing
and what the player is missing.

That is the shape a quantitative fit cannot learn from more examples of the
same decision: identical feature vectors stay identical however many are
collected. It needs a term that states the objective — which colours threaten
me, what my hand lacks — and until that term exists, collecting more of these
decisions adds blind pairs, not evidence.

The corpus contains **no library-search (tutor) judgement at all**. The ids that
mention a search are a storm count and two fetchland activations. The
fifty-option tutor decision is not under-represented; it is absent.

**4. Twelve blind pairs are vacuous: two copies of the same card.** In the
in-play verdicts, a hand holding two Brushlands offers two `play-land` candidates
that differ only by `cardInstanceId`, and three Treetop Villages offer three
identical animations. The judge picks one copy; the pair then asserts that copy
beats the other, which no evaluation could or should believe. These are not a
missing term — they are the candidate list failing to collapse moves that are
the same move. Seven are land drops, five are activations. They inflate `blind`
and the denominator alike, and the tester sees the duplicates in the quiz too.

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
4. **Library search — 0 pairs.** Absent, not thin (finding 3). Worth authoring,
   but with the same caveat as the colour and ordering choices: the value of a
   tutored card is a goal (what the hand is missing), so these positions will
   come in blind until a term states that goal.
5. **Resolution choice (colour, ordering) — 39 pairs, 14 of them blind.** Do
   not collect more of these until an objective term exists; they would add
   blind pairs, not evidence.
6. **Mulligan — 0 pairs.**

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
