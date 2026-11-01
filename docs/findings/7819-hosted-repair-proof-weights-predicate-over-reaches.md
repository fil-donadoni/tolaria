---
title: hosted repair-proof reads almost every engine test as unprovable once it reaches the fitted weights
discoveredBy: 7819
status: draft
confidence: medium
---

**What is wrong.** Since issue #7819, `fileReadsCorpus` (`scripts/pr-checks.ts`)
calls a test corpus-bound when its import closure reaches
`convex/gre/ai/fittedEvalWeights.ts`, because a hosted `derive:regenerate`
cannot refit them (no reader key). The closure runs through `evalWeights.ts`, so
1627 of 2581 test files qualify (581/617 under `convex/gre`, 393/462 under
`convex/cards`, 215/222 under `convex/oracle`). The result is that the hosted
`repair-proof` passes with a note for nearly any engine RED, including a plain
rules repair whose weights the PR never moves. That early hosted signal is lost.
`land:ready` still proves the repair keyed, so no wrong merge follows.

**Evidence.** The opus review of PR #7827 measured the counts. The weights matter
only when the PR's own refit would change them.

**A tighter predicate.** Call a test unprovable only when the PR's diff reaches
the fit's inputs (the Verdict Lock, the registry, `verdicts/evalPairs.ts`, the
search's probe) AND the test reaches the weights. Or run the test anyway: green
proves the repair, and only a red over the weights becomes "not provable here".
A smaller fix: share one import graph per `repairProofCheck` call instead of
rebuilding it for each test (~230 ms each).

**Why it may not deserve its own issue.** The keyed `land:ready` proof is the
authority and is unaffected. The cost is a later signal, never a wrong one.
