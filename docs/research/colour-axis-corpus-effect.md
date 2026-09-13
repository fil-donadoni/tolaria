# What the colour-coverage axis bought the verdict corpus (issue #3534, PRD #3526)

**Question.** Issue #3532 shipped `colorCoverage` — the first evaluation term
that knows mana has colours. What did it change on the corpus that is supposed
to measure the evaluation: how many pairs stopped being BLIND (identical
feature vectors, so no weight can ever order them), and which contradictory
couples did it resolve?

**Verdict up front: the axis un-blinded exactly two pairs, both of them land
drops, and it un-blinded nothing else.** That is the term behaving as
specified. `colorCoverage` is a colour-of-mana axis; the remaining 42 blind
pairs are blind for reasons that have nothing to do with colour, and they are
unchanged source for source. What the measurement also shows is that the
denial is only visible when the DEMAND outlives the SUPPLY — which is why the
Vision Charm entry needed re-expressing rather than just re-seeding.

## The numbers

The verdict report over the WHOLE corpus (registry + `data/verdicts/**`), at
the committed vector of each tip — `bun run` equivalent:

```
BLADE_VERDICTS=1 BLADE_VERDICTS_OUT=<path>.json \
  bunx vitest run --config vitest.blade.config.ts \
  convex/gre/ai/blade/__tests__/verdict-report.spec.ts
```

|                               | before (`9144edc4e`, pre-#3532) | after (`e36ca0148`, post-#3532) |
| ----------------------------- | ------------------------------- | ------------------------------- |
| verdicts / pairs              | 155 / 367                       | 157 / 373                       |
| verdicts fully ordered        | 71 (45.8%)                      | 73 (46.5%)                      |
| pairs satisfied               | 215 (58.6%)                     | 223 (59.8%)                     |
| pairs violated                | 152                             | 150                             |
| **blind pairs**               | **44**                          | **42**                          |
| contradictory couples / pairs | 222 / 509                       | 226 / 510                       |

The two sides are NOT the same corpus: #3532 shipped its own two-entry Stone
Rain pair, which is +2 verdicts and +6 pairs. So the totals are context and the
pair-level diff is the measurement.

## The two blind pairs it resolved

```
in-play:ph74y79vcg1vnz421ge5y4bhtd8e8p67  want play Treetop Village  over play Mishra's Factory
in-play:ph78qjze678gbdc789pq2vg58h8e957v  want play Treetop Village  over play Karplusan Forest
```

Both are the shape the term exists for: two lands the `mana` SOURCE COUNT
prices identically, separated only by which colours they supply. Before the
term, no weight in the vector could order them — which is the
identical-feature-vector condition ADR 0124 §5 reserves for a root rule, and it
is now gone on these two without one.

## Contradictory couples: 9 resolved, 13 new

Resolved — the axis gave the two sides different vectors, so they stopped
reading as one position ordered two ways. **Four of the nine** are couples
against `in-play:ph78qjze…: play Treetop Village > play Mishra's Factory`, one
of the two land drops above (its partners: the other land drop, a third land
drop, `activation timing: holds Mother of Runes at sorcery speed`, and
`combo: casts Splinter Twin on Deceiver Exarch`). **Three** are
`storm: Grapeshot is lethal` against a `cast Mox Diamond > pass` land-drop
verdict and the two Aluren `cast permission` verdicts. The last **two** are
`defensive grant NEGATIVE CONTROL` against a `cast Mox Diamond > pass` and
against its own `defensive grant` twin.

New, counted exactly: **4 of 13** involve #3532's own `colour denial` entries;
the other **9** are couples among verdicts that both already existed and whose
vectors moved, **6** of them against the single verdict
`in-play:ph79ze6n…: cast Mox Diamond > pass`. A contradictory couple is an
identical-vector disagreement, so a new term necessarily mints new couples
wherever it makes two previously-distinct vectors coincide. The count is not a
regression signal on its own.

## Where the axis does NOT see a denial

The measurement that decided the Vision Charm re-expression (issue #3194's
position B). Seeds 0..29, 200 iterations, the entry's own position:

| opponent's side               | picks the land-type mode            |
| ----------------------------- | ----------------------------------- |
| three Forests, nothing else   | **8 of 30** (22 take the mill mode) |
| three Forests + Grizzly Bears | **30 of 30**                        |

The opponent's colour DEMAND is estimated from live public evidence
(`ai/observedColors.ts`). Three Forests and nothing else are their own only
evidence of {G}: re-type them and {G} leaves the demand set with the last
source that supplied it, the ratio re-bases, and the denial prices at exactly
zero — the same arithmetic that makes #3532's own position B refuse to spend
Stone Rain on a colour nothing but the land itself evidences. A Grizzly Bears
beside the Forests is evidence that SURVIVES the re-type, and the preference
becomes unanimous.

This is a property of estimating demand from live evidence, not a defect to
fix: the alternative is assuming a colour the opponent has shown no sign of
caring about, which is the vacuous heuristic issue #2306 exists to kill.

## The refit over the whole corpus

`BLADE_FIT=1 BLADE_FIT_FILES=1` — the knob issue #3534 added to the fit runner.
`bun run fit:weights` still fits the REGISTRY alone, deliberately: it is the
provenance of the committed vector and must stay reproducible from git, while
`data/verdicts/**` is a pulled artefact (`bun run verdicts:pull`).

140 entries, 157 verdicts, 373 pairs, margin 100, λ 0.05, trust 0.5:

- loss 3.0806 → 2.9593
- pairs satisfied 222 → **220**; verdicts fully ordered 70 → **69**
- the blade `must` tier under the fitted vector: **132 entries, 0 red — green**

The fit lowers its own loss while satisfying FEWER pairs — the in-play corpus
is dominated by land-drop verdicts, and satisfying them costs registry pairs.
So the vector is admissible (it breaks no hand-curated position) and is NOT
obviously an improvement (it satisfies two pairs fewer than the prior it was
fitted from). It is therefore not landed here: it goes to issue #3406, which
owns the question of what the in-play corpus should be allowed to move. The
vector, for that issue:

```
permanentWeight 5 → 5.69954          manaWeight 12 → 14.124668
tappedManaWeight 9 → 8.424668        manaDevWeight 12 → 8.519339
colorCoverageWeight 24 → 25.636524   flexWeight 6 → 9
graveyardEngineWeight 60 → 63.458612 graveyardReachFraction 0.15 → 0.174922
latent.damage 22 → 28.07623          latent.cardAdvantage 45 → 42.133946
latent.lifeSwing 8 → 7.838963        latent.boardRemoval 160 → 119.19326
latent.ramp 12 → 11.748878           latent.disruption 130 → 109.668486
latent.tokens 0.85 → 0.651991        latent.pump 9 → 4.5
latent.protection 60 → 58.404594
(lifeWeight numeraire, deckingWeight, latent.evasion/tempo/recursion: unmoved)
```
