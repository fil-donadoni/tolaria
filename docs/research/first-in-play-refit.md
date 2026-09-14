# What the first in-play Verdict batch did to the fit (issue #3406, PRD #3397)

**Question.** ADR 0124 §5 replaced the hand-written root rule with
**Verdicts → fit → report**. Issue #3402 built the quiz, issue #3401 built the
fit; this is the first time a human sat down, played against the Bot and judged
its decisions, and the corpus came back three-quarters bigger. Does refitting
the evaluation weights on it make the Bot better?

**Verdict up front: no, and the reason is the fit's objective, not the
verdicts.** Over the whole corpus (174 verdicts, 492 Eval Pairs) the refit
produces a vector that orders **fewer** verdicts than the one already
committed — including fewer of the in-play verdicts it was given for the first
time — at every setting of margin, trust region and λ we swept. The committed
`DEFAULT_EVAL_WEIGHTS` stays. What the corpus is asking for is a **missing
term**, and it names one.

## The corpus

| source                   | verdicts |
| ------------------------ | -------- |
| blade registry           | 103      |
| `data/verdicts/**`       | 70       |
| authored counter-example | 1        |
| **total**                | **174**  |

492 Eval Pairs. Reproduce with:

```
BLADE_FIT_FILES=1 BLADE_FIT_OUT=<path>.json bun run fit:weights
```

`BLADE_FIT_FILES=1` is what makes the fit read `data/verdicts/**` at all
(issue #3534); the bare `bun run fit:weights` is the registry alone, and it is
still the provenance of the committed vector.

## The measurement

Three vectors, one corpus, scored on the ordering a human reads rather than on
the fit's loss:

```
== the same corpus, 3 vectors — ordering, not loss (issue #3406)
  vector                verdicts ordered   pairs satisfied   contradictory   blind
  prior (FIT_BASE)      79/174 (45.4%)     328/492 (66.7%)   552             47
  committed (DEFAULT)   83/174 (47.7%)     330/492 (67.1%)   526             47
  fitted (this run)     78/174 (44.8%)     326/492 (66.3%)   553             45
== the fitted vector, as the DEFAULT_EVAL_WEIGHTS literal
```

The fit does what it was asked to: **loss 2.4173 → 2.3293**. It gets there by
flipping pairs that sat just past zero in order to push others past the margin
`δ = 100`. Split by source, the fitted vector is worse on both halves:

| at                    | registry ordered | in-play ordered |
| --------------------- | ---------------- | --------------- |
| committed (DEFAULT)   | 66/103           | 16/70           |
| fitted (whole corpus) | 63/103           | 14/70           |

**It orders fewer of the very verdicts that were added to it.** That is not a
corpus that disagrees with the incumbent — it is an objective that is not
measuring what the corpus is for.

### The sweep

Every combination breaks the same `must` entry and none reaches 83/174:

| margin δ | trust | λ    | verdicts ordered       | pairs satisfied |
| -------- | ----- | ---- | ---------------------- | --------------- |
| 100      | 0.5   | 0.05 | 78/174                 | 326/492         |
| 100      | 0.1   | 0.05 | 79/174                 | 328/492         |
| 100      | 0.5   | 0.5  | 79/174                 | 329/492         |
| 30       | 0.5   | 0.05 | 80/174                 | 327/492         |
| 30       | 0.25  | 0.05 | 79/174                 | 328/492         |
| 10       | 0.5   | 0.05 | 80/174                 | 326/492         |
| —        | —     | —    | **83/174 (committed)** | **330/492**     |

Lowering `δ` moves in the right direction — which is the evidence that the
margin is what disagrees — but it does not close the gap, and the committed
vector is _inside_ the trust region at every setting. The fit could have chosen
it and preferred something that orders less.

### The blade suites

| suite                       | committed                     | fitted (whole corpus) |
| --------------------------- | ----------------------------- | --------------------- |
| `bun run test:blade` (must) | green                         | **1 red**             |
| greedy 1-ply, must tier     | 99/139 entries, 447/613 seeds | 98/139, 441/613       |

The red is `depletion land: pays the two-drop with the basics, sparing the
land's charge`. Its discriminating pair is worth reading, because it is the
whole story in two numbers:

```
want  cast Grizzly Bears (tapping Forest, Forest)
over  cast Grizzly Bears (tapping Hickory Woodlot)
Δ policy -2.0   |   mana -6.0, finiteManaUses +4.0
```

Sparing the depletion land's charge is worth `+4` and costs `−6` of untapped
mana. The registry-only fit bought it by exactly `+2.0`; raising `manaWeight`
12 → 15.19 to satisfy in-play pairs sells it back at `−7.4`. One verdict is
traded for several, the loss goes down, and the Bot starts spending charges it
should spare.

## What the unsatisfied pairs point at

Not a weight. Two findings, in order of size.

**1. Half the corpus is contradictory — 526 pairs over 235 couples.** Two
verdicts whose candidate pair carries the IDENTICAL feature vector and whose
answers are opposite. The evaluation cannot be wrong about both; these are
positions the feature basis does not distinguish at all. The `blind` bucket
(47 pairs) is the same thing, sharpened to a single verdict.

**2. The blind pairs are about LANDS, and they name the term.** Of the 47, 23
name two different candidates, and the in-play ones are almost all one shape:

```
play Steam Vents       over  play Island
play Copperline Gorge  over  play Forest
activate Rishadan Port → Swamp   over   → Island
cast Winter's Grasp → Underground River   over   → Island
```

Every one of those is _which land_, at identical board totals. `colorCoverage`
(issue #3532) already knows mana has colours, and it un-blinded exactly the two
pairs where a colour was newly covered — but "play the dual you already cover
both colours of" scores identically to "play the basic". The axis the corpus is
asking for is a land's **optionality**: how many colours it could ever produce,
whether it fetches, whether it enters untapped, what it costs in life — none of
which is a function of the colours covered _right now_.

The remaining 24 blind pairs render the same description on both sides. They
are a mix of genuinely duplicate objects (two copies of one land, two Treetop
Villages) and choices the describer flattens to `resolve choice (1 card)`
(Mother of Runes' colour). The first are corpus noise and should not be counted
as a missing term; the second are real. Telling them apart needs the describer
to name the choice's content — its own slice.

## What landed

`bun run fit:weights` used to print _"the committed DEFAULT_EVAL_WEIGHTS is
STALE — paste the block above"_ for any vector that differed from the committed
one, having compared it only against the hand-picked prior. Following that
instruction here pastes a regression. The runner now scores the **incumbent**
on the same corpus, prints the three rows above, and replaces the paste
instruction with `DO NOT PASTE` when the fitted vector orders fewer verdicts
(`improvesOnIncumbent`, `convex/gre/ai/verdicts/report.ts`).

The vector itself did not move.
