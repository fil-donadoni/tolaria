---
title: Static round-robin worker partition can leave some workers idle while others finish long games
discoveredBy: 2681
status: draft
confidence: low
---

**What is wrong.** `runWorkerPool` (`scripts/lib/ladder/pool.ts`) assigns the
plan to workers via static round-robin (`partitionRoundRobin`) decided entirely
up front — no dynamic work-stealing. Game duration varies a lot by matchup
(measured on a `--dynamics combo`, `--iterations 40` smoke shakeout: 6-9s for
some pairings, 20-23s for others — a ~3-4x spread), so a worker whose bucket
happens to contain more of the slow matchup finishes well after its siblings,
which sit idle for the remainder of the run.

**Evidence.** `scripts/lib/ladder/pool.ts:runWorkerPool` — `Promise.allSettled`
over one promise per bucket; each bucket is a fixed slice from
`partitionRoundRobin`, chosen before any game plays. In the measured run
(sequential 178s vs 4 workers 66s = ~2.7x, not the ideal ~4x), part of the gap
is this imbalance rather than fixed overhead — one bucket contained 2 of the
slower `channel-fireball vs mono-black`/`white-weenie vs channel-fireball`
matchups back-to-back.

**Why it may not deserve its own issue.** The round-robin split already
interleaves pairing rows across buckets (not contiguous blocks), which
amortizes most of the skew at real tier sizes (48-240 games vs the 16-game
shakeout measured here) — the relative imbalance shrinks as bucket size grows.
A dynamic work-stealing queue (workers pull the next task instead of owning a
fixed slice) would close the remaining gap, but adds real complexity (a
shared-queue protocol over the current one-shot stdin handoff) for a return
that may not matter once decision-tier bucket sizes average it out. Worth
re-measuring at `--tier decision` before deciding it needs fixing.
