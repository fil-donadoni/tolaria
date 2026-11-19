---
title: A play-Bot eval-weight refit moves the Draft Table Audit's Floors
discoveredBy: 9978
status: draft
confidence: medium
---

**What is wrong.** The LEA `meanCastability` Floor (`scripts/lib/draft-audit.ts`)
broke on the base with no change to the drafter or Auto-Build. A `derive:sync`
commit that only regenerated `convex/gre/ai/fittedEvalWeights.ts` (and Bot
snapshots) moved the LEA audit from 0.771 to 0.768 on seeds 1..8, under the
0.77 Floor. A Floor that a play-Bot refit can move fails the next Auto-Build PR's
`draft:audit` receipt, which then has to explain a regression it did not cause.

**Evidence.** `git bisect` over `cd24f1faa..origin/staging` with
`bun run draft:audit -- --scope lea --quiet` as the predicate names
`d6a562ac4` ("derive:sync — regenerate the lockfile header and data/catalogue
on the tip"; its diff is `fittedEvalWeights.ts` plus Bot fixtures) as the first
bad commit. The likely path is the card-quality heuristic
(`candidateBaseRating` → `cardValueById`) reading the fitted weights.
`draft-audit-receipt.ts` also says the audit's import closure "reaches the
fitted-weights path". PR for issue #9978 loosened the Floor to 0.76 to land.

**Why it may not deserve its own issue.** The move is 0.003, inside the
seed-block noise `docs/research/draft-table-audit-floor-noise.md` measures, so
the real defect may be a Floor set at the noise edge rather than the coupling.
Decoupling the drafter's quality heuristic from the play Bot's fitted weights
is a design choice (ADR 0073 wants one card-quality authority), not a bug.
