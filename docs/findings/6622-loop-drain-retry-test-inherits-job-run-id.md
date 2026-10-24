---
title: loop-drain-retry.test.ts inherits TOLARIA_LOOP_RUN_ID from an afk-pass job and reds its own identity assertion
discoveredBy: 6622
status: draft
confidence: high
---

**What is wrong.** `scripts/__tests__/loop-drain-retry.test.ts` ("exports
TOLARIA_LOOP_RUN_ID into the pass — the whole budget rests on it (#3699)")
asserts the id the driver exports matches `/^RUN=\[\d+-\d+\]$/`. The driver
(`scripts/loop-drain.sh:128`) takes an ambient `TOLARIA_LOOP_RUN_ID` when one
is set, and an `afk-pass` job launches every pass with
`TOLARIA_LOOP_RUN_ID=gh-<run id>-<attempt>` (`scripts/lib/afk-pass.ts:106`),
so inside a job the test's stub sees `RUN=[gh-40116671073-1]` and fails. The
test does not scrub the variable from the environment it hands the driver.

**Evidence.** On PR #6635's tip (`scripts/` untouched by the branch)
`land:ready`'s `vitest(related)` step redded on this one test; re-run in the
same shell with `env -u TOLARIA_LOOP_RUN_ID bunx vitest run
scripts/__tests__/loop-drain-retry.test.ts` → 16 passed. Unsetting only the
`GITHUB_*` variables does not help: the test reads the already-derived
`TOLARIA_LOOP_RUN_ID`, not its inputs.

**Why it may not deserve its own issue.** It only bites `land:ready` runs that
happen inside a job whose `vitest(related)` closure reaches this test, and the
fix is one line in the test (`delete env.TOLARIA_LOOP_RUN_ID` beside the
`TOLARIA_LOOP_DRAIN` scrub it already does) — a line on the afk-pass tracker
(ADR 0156) rather than a ticket, unless the job-vs-attended env drift shows up
in a second test.
