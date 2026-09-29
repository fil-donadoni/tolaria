---
title: Every stretch blade entry without beyondBudget reds under requireAssertions
discoveredBy: 4765
status: triaged
issue: 4769
confidence: high
---

**What is wrong.** `bun run test:blade:stretch` is report-only by contract, but
since PR #4613 turned on `expect.requireAssertions` for every project
(`vitest.blade.config.ts:61`), the stretch branch of
`convex/gre/ai/blade/__tests__/bladeShardRunner.helper.ts` (~line 265) fails every
entry that carries no `beyondBudget`: it prints the verdict, returns, and has
asserted nothing, so vitest reports `expected any number of assertion, but got
none`. A PASS and a FAIL verdict both come out as a red test and a non-zero
exit, so the run's exit code carries no information.

**Evidence.** Issue #4765's four new stretch entries all print
`[blade:stretch] PASS … ` on 5/5 seeds and all four are counted as `failed`,
each with the same `requireAssertions` error.

**Fix shape.** The report-only branch owes one trivially true assertion (e.g.
`expect(result).toBeDefined()`) or `expect.requireAssertions` off for the
stretch tier only — not a relaxation of the `must` tier.
