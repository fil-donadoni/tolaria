---
title: ui-gate-undecided-exit.test.ts writes a file into src/ that vite-card-sets-dev-bundle.test.ts can read after it is gone
discoveredBy: 6440
status: draft
confidence: high
---

**What is wrong.** `scripts/__tests__/ui-gate-undecided-exit.test.ts:11-14`
writes `src/components/zz-unplaced-issue-6144.tsx` into the shared checkout and
removes it in `finally`. `scripts/__tests__/vite-card-sets-dev-bundle.test.ts:115-133`
("a Set module has exactly its two importers") lists every `src/**/*.tsx`, then
`readFileSync`s each one. Both run in the `node-engine` project, in parallel
workers: when the listing sees the file and the read comes after the `rmSync`,
the walk throws `ENOENT` and the lane goes red without any defect.

**Evidence.** PR #6441's merge-queue `queue-lane` run (actions run
39910011045, draft PR #6442) failed only on that test, with
`ENOENT: no such file or directory, open '…/src/components/zz-unplaced-issue-6144.tsx'`;
`--retry-flaky` did not clear it, and `check:lane (advisory)` on the same PR head
was green.

**Why it may not deserve its own issue.** It is a test-isolation flake, not an
engine defect, and the fix is small: give the undecided-exit test a path the
other walk never lists, or make the importer walk skip a file that vanished
between list and read. It could be a line on whatever tracks lane flakes, if
one exists.
