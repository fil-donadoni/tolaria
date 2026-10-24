---
title: loop-drain test harness inherits TOLARIA_LOOP_RUN_ID from an afk-pass job
discoveredBy: 6630
status: draft
confidence: high
---

**What is wrong.** `scripts/__tests__/loop-drain-retry.test.ts` › "exports
TOLARIA_LOOP_RUN_ID into the pass" pins the driver's LOCAL run id shape
(`RUN=[<pid>-<n>]`), but `scripts/loop-drain.sh:128` reads
`RUN_ID="${TOLARIA_LOOP_RUN_ID:-}"` from the environment first, and the
harness (`loop-drain-harness.ts`) does not scrub it. Inside an `afk-pass`
job the dispatcher exports `TOLARIA_LOOP_RUN_ID=gh-<run>-<attempt>`, so the
test reds on every PR whose lane reaches it through the `scripts/**` import
graph — `land:ready`'s pre-queue `vitest(related)` refused PR #6759 on it,
with no change to any loop file in the diff.

**Evidence.** On the job runner: `bunx vitest run
scripts/__tests__/loop-drain-retry.test.ts` → 1 failed, received
`RUN=[gh-40117944460-1]`; `env -u TOLARIA_LOOP_RUN_ID bunx vitest run …` →
16 passed. Unsetting `GITHUB_RUN_ID` / `GITHUB_ACTIONS` alone does not help:
the inherited variable IS the run id.

**Why it may not deserve its own issue.** One line in the harness (unset
`TOLARIA_LOOP_RUN_ID`, as `scrubGitRepoEnv` already does for git's
variables) — a line on the afk-pass tracker rather than a ticket, unless the
pre-queue hatch keeps being needed for `scripts/**` PRs in jobs.
