---
title: The check:ui batch renders a clean PR's receipt with the base's row vocabulary, so a PR that edits a walked row can never verify it
discoveredBy: 8446
status: draft
confidence: high
---

**What is wrong.** A BATCH receipt is three digest lines; the verdict digest is
a hash of the verdict block, and that block names every cell's assert labels
(and its viewports and surface ids). `batch-run.ts` renders those lines in its
own process: `batchReceiptLines` calls `landableEvaluation(surfaces,
LANE_VOCABULARY, …)`, and `LANE_VOCABULARY` is whatever `scripts/ui-gate/` holds
in the checkout the batch runs from, which is the base tip (`ui-batch.yml`
checks it out). The walk itself runs inside the merged tree, so it measures the
PR's rows. `land:ready` then re-derives the block from the PR's tree
(`verify-receipt.ts`). When the PR changes the vocabulary of a row its scope
walks, the two sides hash different blocks and the receipt is refused, on every
batch, however clean the walk.

**Evidence.** PR #9539 (issue #8446) carries a one-row fix to
`scripts/ui-gate/surfaces.ts`: `draft-final-pick`'s assert `pool pane` becomes
`Pool toggle`. ui-batch run 43573028216 walked it clean, wrote the receipt, and
`land:ready` refused: `verdict digest mismatch`, pasted `42c97f0e…`, re-derived
`816b3fd2…`. Recomputing `batchReceiptLines` from the banner in the PR body
gives `816b3fd2…` in the PR's tree and `42c97f0e…` in the same tree with the
base's `surfaces.ts` checked out: exactly the two digests. The batch also
dropped `ui-owed` and added nothing, so the PR was left with no label at all.

The same shape reaches any PR that renames an assert, adds or removes one on a
walked row, or changes a row's viewports. A PR that only adds a NEW row is not
hit through its own scope, because a `surfaces.ts`-only diff owes no walk
(`check:ui -- --scope-only`: `not owed — no changed path can reach the DOM`).

**Why it may not deserve its own issue.** There is a way round it today: land
the row change in its own PR first (it owes no walk), or walk the PR in its own
tree for a `SCOPED` receipt, which renders with the PR's vocabulary. Both cost a
pass that has to diagnose a digest mismatch first; the refusal names no cause.
If it becomes an issue, the fix is to take the vocabulary from the merged tree
(the lines the walk printed there, or a render spawned inside it) instead of
the batch's own imports, and to leave `ui-owed` in place when `land:ready`
refuses a receipt the batch itself wrote.
