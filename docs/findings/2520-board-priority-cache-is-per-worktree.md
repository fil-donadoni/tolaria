---
title: The board-priority cache is per-worktree, so parallel sessions still pay one GraphQL read each
discoveredBy: 2520
status: draft
confidence: medium
---

**What is wrong.** Issue #2520's rationale is that "five sessions draining the
queue in the same window pay for one board read instead of five" — but the cache
file each of them reads is resolved from the SCRIPT's own directory, so every
worktree gets its own copy. The saving is real for repeated passes inside one
checkout and absent across the parallel worktrees the argument is about.

**Evidence.** `scripts/queue-plan.ts:57` — `const REPO_ROOT = resolve(__dirname, "..")`
— and `scripts/queue-plan.ts` builds the cache path as
`join(REPO_ROOT, ".claude/telemetry/board-priority.json")`. Run from
`/Users/filippo/code/mtg/tolaria-issue-2520`, that is the worktree's own
`.claude/telemetry/`, not the primary checkout's. `scripts/lib/primary-checkout.ts`
(landed by #2519, `56c6b1ea`) already resolves the primary checkout via
`git rev-parse --git-common-dir` and is used by five other scripts for exactly
this kind of shared, gitignored state.

**Why it may not deserve its own issue.** `queue:plan` is normally run by the
orchestrator from the primary checkout, so in the shape the loop actually runs
today all passes share one file and the cache does its job. The gap only opens if
someone plans from inside a worktree. It is also a two-line change
(`primaryCheckout()` instead of `resolve(__dirname, "..")`) whose only real cost
is deciding whether a plan produced in a worktree SHOULD be able to warm the
primary checkout's cache — which is a judgment call, not a bug report.
