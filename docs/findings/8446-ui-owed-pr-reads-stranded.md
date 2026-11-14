---
title: A PR handed to the check:ui batch (`ui-owed`) reads `stranded`, so the dispatcher re-fires a resume pass with nothing to do
discoveredBy: 8446
status: draft
confidence: high
---

**What is wrong.** A pass whose diff owes a browser walk ends at the `ui-owed`
label (issue #9122): `land:ready` refuses the PR by design and the `ui-batch`
collector lands it. `passOutcome` knows this and reports `handed-off`. The claim
classifier does not: it treats only `ready-to-land` as a hand-off, so once the
issue has an ended `afk-pass` run, its open `ui-owed` PR reads `stranded` and
the dispatcher fires `afk-pass #N (resume)` on the issue's own tier. That pass
finds a pushed, mergeable, current head with its receipts in place, cannot run
`land:ready`, and ends — and the next dispatcher tick past the five-minute
floor fires it again, until the batch settles the PR.

**Evidence.**

- `scripts/lib/afk-pass.ts:255` — `passOutcome` returns `handed-off` for a PR
  wearing `READY_LABEL` **or** `UI_OWED_LABEL`.
- `scripts/lib/claim-verdict.ts:522` — `landQueueByBranch` maps `land-failed`
  and `ready-to-land` only; `ui-owed` yields no state.
- `scripts/lib/claim-verdict.ts:211` — `classifyClaim` returns `pr-open` only
  for `landQueue === "ready"`; an open PR whose run ended falls through to
  `stranded` ("resume it (usually one `land` away)").
- `scripts/lib/queue-plan.ts:1849` — `resumeItems` takes every `stranded`
  claim; nothing in `queue-plan.ts` or `afk-dispatch.ts` names `ui-owed`.
- Observed on PR #9539 (issue #8446, `model:fable`), 2026-11-14: the repair
  pass (run 43568463034) rebased, pushed head `2360d2aa6` and handed back to
  `ui-owed` at 07:28Z; run 43571845726, `afk-pass #8446 (resume)`, was created
  at 07:35Z against the same head, zero commits behind the base tip
  `ce727ab10`, with no batch walk in between. It changed nothing.
- The loop starts only after the first `afk-pass` run named for the issue
  ends: before that, `run` is `none` and the open PR reads `live`, which is why
  the same PR sat `ui-owed` overnight without a resume.

**A possible shape.** `landQueueByBranch` gives `ui-owed` its own state
(`land-failed` still winning), and `classifyClaim` answers it like
`ready-to-land`: holds no slot, nothing to resume, the label stands.

**Why it may not deserve its own issue.** A resume on a `ui-owed` PR is not
always empty: the collector leaves a DROPPED or UNPROVEN head `ui-owed` with a
hold comment (`scripts/ui-gate/batch-collect.ts`), and a head that conflicts
with the base needs a pass to rebase it — a blanket "never resume `ui-owed`"
would strand exactly those until the stalled-PR warning. The fix has to read
the hold (a hold comment naming the current head → resume; none → wait), which
may belong on whatever ticket owns the collector's hold protocol rather than a
new one. The waste is also bounded when `ui-batch` ticks on schedule: one tick
plus one walk.
