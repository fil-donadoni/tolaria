---
title: gate.ts's CPU-burn heartbeat test is a wall-clock assertion in the GATED suite and flakes under mutex contention
discoveredBy: 2711
status: draft
confidence: high
---

**What is wrong.** `scripts/__tests__/gate.test.ts` → "heartbeats the owner
stamp while the held command BURNS CPU — a long hold never reads stale (issue
#1924)" asserts on observed CPU/heartbeat progress over real elapsed time. It
lives in the gated suite, so it runs inside `check:pr` — which is exactly when
the machine is least able to satisfy it, because `check:pr` is what the heavy
mutex is serialising several sessions through.

CLAUDE.md's own rule says wall-clock assertions belong in `*.perf.test.ts`
(`test:perf`, a fourth suite, deliberately never gated, issue #3123). This one
is not wall-clock by name but is by nature.

**Evidence.** Observed during `bun run land 3415`: `check:pr` reported
`Test Files 2 failed | 1355 passed`, one of them this test, while two sibling
`land` runs (`tolaria-issue-2710`, `tolaria-issue-3413`) had just been holding
and burning the heavy mutex — the `land` log shows 9m12s of queueing behind
them. Re-running `bunx vitest run scripts/__tests__/gate.test.ts` alone on the
identical tree: **21 passed**. The tree was not the variable; machine load was.

**Why it may not deserve its own issue.** It is one test and the fix is
mechanical — move it to `*.perf.test.ts`, or give it a contention-tolerant
budget. But the cost when it fires is not small: it reds a `land` AFTER the
rebase and the full gate have been paid (~7-15 min under the lock), and it
reads as "your diff broke the gate" to whoever is landing, which is the exact
misattribution that makes a flake expensive. It gets worse the more sessions
run in parallel, which is the direction this repo's workflow is going.
