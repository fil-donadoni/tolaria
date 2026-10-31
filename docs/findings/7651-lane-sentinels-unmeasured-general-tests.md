---
title: Lane sentinels never admit a node or dom test — health records file walls for bot projects only
discoveredBy: 7651
status: draft
confidence: high
---

**What is wrong.** The sentinel set (`data/lane-sentinels.json`) admits a
candidate only by its measured cost, and the one per-file cost table,
`data/bot-test-costs.json`, holds bot files alone: `FILE_WALL_PROJECT` is
`/^bot-/` (`scripts/lib/test-headroom.ts`), so health writes no `FileWall` for a
`node-engine`, `node-tooling` or `dom` file. On 2026-10-31, 15 of the 28
candidates were such files, `unmeasured` and never run by the lane. Among them
were `raw-card-display-scan.test.ts` (5 REDs) and `no-bare-100vh.guard.test.ts`
(2 REDs, 2 lane reds).

**Evidence.** Run `bun run lane:sentinels` and read the `unmeasured` list. See
also `collectFileWalls` in `scripts/lib/vitest-duration-reporter.ts`.

**Fix sketch.** Widen `FILE_WALL_PROJECT` to the five lane projects, and keep
`buildCostTable` bot-only (filter on `FileWall.project`) so the bot admission's
table does not grow. Then `lane:sentinels` joins its costs from the same sealed
runs' medians.

**Why it may not deserve its own issue.** It could be one line on PRD issue
#7645's next sentinel slice instead.
