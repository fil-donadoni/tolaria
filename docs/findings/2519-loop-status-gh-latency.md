---
title: gatherLoopStatus's sequential gh calls can take ~20-25s, longer than the /api/loop-status cache TTL
discoveredBy: 2519
status: declined
confidence: medium
---

**Resolved directly, not filed.** The PR #2545 review (finding 2) re-framed
this against the panel's poll interval rather than as an abstract latency
number: with a 10s cache TTL and a gather that takes longer than 10s, NO poll
is ever served from cache, which is a defect, not a product decision to defer.
Fixed in the #2545 round-2 fixup — `scripts/lib/board-priority.ts`'s read now
has its own 5-minute cache (`getPriorityCached` in `telemetry-serve.ts`),
decoupled from the rest of the gather, which keeps the 30s outer TTL below.
Declining rather than promoting to `triaged`/an issue: there is no remaining
gap to track.

**What is wrong.** `gatherLoopStatus` (`scripts/loop-status.ts`) makes roughly
seven sequential shells: `fetchClaimedIssues`, `fetchOpenPrBranches`,
`fetchAllBranchNames` (two calls), `git worktree list`, the unclaimed
ready-for-agent list, and `fetchBoardPriority`'s two calls (`item-list
--limit 2000` + `project view`). Measured on this machine: `bun run
loop:status --json` took ~20-25s wall clock, dominated by
`gh project item-list --limit 2000` (~11s on one run, and once returned
`GraphQL: API rate limit exceeded`).

The `/api/loop-status` server route (`scripts/telemetry-serve.ts`) caches the
resolved payload for 10s (`LOOP_STATUS_TTL_MS`), per the issue's own
instruction ("Cache the payload server-side (~10s)"). When a single gather
takes longer than the TTL, the cache still does its one guaranteed job —
concurrent requests within the same in-flight window share one promise rather
than firing N separate `gh` rounds — but it does not make the endpoint feel
fast: a request landing just after the cache entry resolves can be looking at
a gather that is already stale again.

**Why it may not deserve its own issue.** The root cost (`gh project
item-list --limit 2000`) is the SAME call and SAME limit `queue:plan` already
makes on every pass, so this is not a regression introduced by #2519 — it's
an existing `gh` CLI/network characteristic this issue's server route is the
first to expose behind a short TTL. A fix would mean either raising the TTL
(trading staleness for latency, worth deciding deliberately rather than as a
side effect) or making `fetchBoardPriority` optional/lazy on the dashboard
(e.g. render the panel without priorities first, backfill asynchronously) —
both are product decisions, not bugs.
