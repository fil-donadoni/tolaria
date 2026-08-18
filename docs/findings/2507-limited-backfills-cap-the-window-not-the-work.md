---
title: The limitedEvents backfills bound the SCAN, so re-running never reaches row 501
discoveredBy: 2507
status: draft
confidence: medium
---

**What is wrong.** All four one-shot backfills in `convex/limitedEvents.ts`
follow the same shape: `take(SCAN_LIMIT)`, then migrate up to `limit` of the
rows in that window and report `remaining` so the operator re-runs. But the
scan is unordered and always starts from the same place, so `remaining`
converges to 0 while the rows _beyond_ the window are never seen at all. The
docs read "run it again until `remaining` is 0", which is a true statement
about the window and a false one about the table.

**Evidence.** `convex/limitedEvents.ts:2145` (`migrateSeatPayload`),
`:2231` (`migrateSelections`) and `:2296` (`migrateCubePool`) all
`ctx.db.query("limitedEvents").take(MY_EVENTS_SCAN_LIMIT)` with
`MY_EVENTS_SCAN_LIMIT = 500` (`:538`). `migrateSeatCardPayload`, added by this
issue, inherits the pattern against `limitedSeats` with a 4000-row cap. Once
the first 500 events are migrated every subsequent invocation returns
`{ migrated: 0, remaining: 0 }` — indistinguishable from "done" — even with
event 501 still un-migrated. The correct shape is a cursor (`paginate`, or a
`by_creation_time` range resumed from the last `_id`), which none of them use.

**Why it may not deserve its own issue.** The deployment has never been near
500 Limited events — events are short-lived and GC'd (`convex/crons.ts`) — so
today every backfill's window IS the whole table, and the bug is latent. If a
human is confident that stays true, this is a comment correction on four
docstrings rather than a ticket. It becomes real the moment a backfill is
written against a table that is not GC'd.
