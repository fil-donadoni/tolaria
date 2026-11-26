# The Census gate: what the generated vector tells apart, with no fit (issue #10857, ADR 0186)

> **Measured at** `5b0332568` (2026-11-27), on the fit side of the committed
> corpus: 544 of 568 Verdicts, 629 Eval Pairs. The exam side was dropped
> before a single position was rebuilt and is not read here. Re-run before
> quoting a number.

**Question.** ADR 0186 grows the Evaluation a generated vector — unit counts
read from what card definitions and the board declare (issue #10853), plus
the deck-relative need family (issue #10856). Its first gate asks, before
anything is fitted: of the Eval Pairs the Evaluation reads as ONE board today
(BLIND: same fittable basis, same terms, same policy value), how many does the
generated vector give different vectors to?

**Pass rule, registered in issue #10857 before measuring:** the generated
vector gives different vectors to at least half of the blind pairs that are
not vacuous (two copies of one card, read by the interchangeability keyer).

**Verdict up front: FAIL, 13 of 29, one short of 15.** No blind pair is
vacuous, so the denominator is all 29. 16 stay blind, and 11 of those are one
shape: a choice written onto an object still on the stack — a target or a
mode — which the settled 1-ply probe leaves unresolved and which no column of
either vector reads.

## The command

```
BLADE_COVERAGE_GENERATED=1 BLADE_COVERAGE_OUT=<path>.txt \
  bunx vitest run --config vitest.blade.config.ts --reporter=default \
  convex/gre/ai/blade/__tests__/verdict-coverage.spec.ts
```

The runner reads the committed corpus (`committedVerdictCorpus`), keeps the
Verdicts `verdictSidesOf` puts on the fit side, builds the Eval Pairs at the
committed weights, reads each pair's two settled boards through the generated
vector (`generatedVector/pairReadings.ts`), and counts with
`verdicts/generatedCoverage.ts`. Nothing is fitted; "satisfied" stays the
current weights' and is not re-read.

## The census

`a→b` is the count under the current vector, then under current + generated.
`separated` is a pair blind today, not vacuous, with different generated
vectors.

```
corpus: fit side only — 544 of 568 verdicts, 629 pairs (exam side not read)
columns: current→current+generated (blind, contra, addressable)
class               pairs  viol    blind   contra  addressable  vacuous  separated
land-drop              67    24      4→1      6→4        14→19        0          3
cast                  192    26      4→1      7→3        15→22        0          3
activate               88    16      2→1     12→1         2→14        0          1
declare-attackers      52     8      0→0      8→6          0→2        0          0
declare-blockers       91     0      0→0      0→0          0→0        0          0
targeting              21     3      3→3      0→0          0→0        0          0
resolution-choice      45    16     15→9      1→1          0→6        0          6
optional-payment        7     1      0→0      1→1          0→0        0          0
pass                   66    11      1→1      5→4          5→6        0          0
TOTAL                 629   105    29→16    40→20        36→69        0         13

pass rule: separated ≥ ceil(non-vacuous blind / 2) — 13 ≥ 15 of 29: FAIL
```

- **Blind 29 → 16.** The rule's number: 13 separated.
- **Contradictory 40 → 20.** Not the rule's question, and the larger move:
  half the anti-parallel couples are anti-parallel only over the 36-term
  basis. `activate` goes 12 → 1.
- **Addressable 36 → 69.** What a fit over the wider vector could buy, at
  most. It is a ceiling, not a claim: nothing was fitted, and a wide vector
  fitted on 629 pairs is the overfitting ADR 0186's later gates exist to
  measure.

## The 16 that stay blind, and what a player would name

| class             | Verdict (`registry:` unless noted)                                               | the difference a player names                                      |
| ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| land-drop         | store `v1-b0d59688…`: "play Brushland" over "play Brushland"                     | none — one copy was drawn this turn (the keyer fails closed on it) |
| cast              | storm: casts Tendrils of Agony when the count is lethal                          | whose life the drain takes (the spell's target, on the stack)      |
| activate          | ability variant: fateseals atop the OPPONENT's library, never its own            | whose library the +2 looks at (the ability's target, on the stack) |
| targeting         | kicker: Sowing Mycospawn's kicked exile never takes its own land (Plains/Forest) | whose land is exiled (the trigger's target, on the stack)          |
| targeting         | the same, Plains over Eldrazi Temple                                             | the same                                                           |
| targeting         | provoke target: announces the creature that dies in the block                    | which creature is forced to block (the trigger's target)           |
| resolution-choice | attack trigger: Territorial Kavu keeps its best spell out of the loot            | which mode the attack trigger resolves (chosen, on the stack)      |
| resolution-choice | attack trigger: Territorial Kavu loots away a surplus land                       | the same                                                           |
| resolution-choice | cast during resolution: Counterspell off Chandra counters the bigger spell       | which spell is countered (the target, on the stack)                |
| resolution-choice | cast during resolution: Plague Spores off Chandra aims its land target … (2)     | whose land is destroyed (the target, on the stack)                 |
| resolution-choice | cast during resolution: Raise Dead off Chandra returns the best creature card    | which creature card comes back (the target, on the stack)          |
| resolution-choice | colour fixing: Manamorphose names green for the green spell it casts             | the colour of the mana in the pool                                 |
| resolution-choice | source of your choice: shields itself from the attacking red creature            | which source the prevention shield names                           |
| resolution-choice | source of your choice: shields itself from the burn spell on the stack           | the same                                                           |
| pass              | standing resource: Umezawa's Jitte keeps its counter when the combat is won      | a charge counter on the Jitte (permanent counters are no column)   |

Read by probing the settled board of each candidate (the probe that
`candidateFeatures` reads): the Kavu modes, the Raise Dead target and the five
Manamorphose colours leave identical hands, graveyards and generated vectors,
with the trigger or spell still on the stack in the first two.

## What this says

1. **The shortfall is one shape, not sixteen.** Eleven of the sixteen are a
   choice recorded on a stack object the probe does not resolve: the target
   of a spell, an ability or a trigger, or the mode of a trigger. Both
   vectors count what a stack object IS (its type, its Ops); neither counts
   what it POINTS AT. Side alone would not do: whose land (Mycospawn, Plague
   Spores), whose library (Jace) and whose life (Tendrils) are side
   questions, but the provoke, Counterspell and Raise Dead pairs choose
   between two objects on the SAME side, and the Kavu pairs between two
   modes. What would separate all eleven is a reading of the target's own
   counts (and of the chosen mode's Ops) — and were all eleven separated the
   rule would read 24 of 29: a counterfactual, not a measurement, since no
   such family exists.
2. **Three are state the generator does not read yet:** mana in the pool by
   colour (1), a prevention shield's chosen source (2), counters on a
   permanent (1 — the counter family is player counters only).
3. **One is not a decision.** The two Brushlands differ only in which was
   drawn this turn; the pair is vacuous to a player and kept by the keyer
   because it fails closed. Excluding it would not change the verdict (13 of
   28 is still short of 14).
4. **Contradictions halve.** Not what the gate reads, and worth stating: 20
   of the 40 contradictory pairs were contradictory only because the basis
   is narrow.

## What this does not claim

- Nothing about the exam side: it was not rebuilt, and must stay unseen by
  anything that shapes the vector.
- Nothing about whether a fit over the generated vector orders the separated
  pairs the right way. Separation is necessary for a fit and far from
  sufficient.
- The September census (`verdict-corpus-coverage.md`, 47 blind) read the
  whole corpus under the vector of the time; this one reads the fit side
  only. The two blind counts are not a trend.
