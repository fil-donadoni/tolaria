---
title: history-filters.test.ts deletes Node's native fetch from the worker realm
discoveredBy: 2634
status: draft
confidence: low
---

**What is wrong.** `scripts/__tests__/history-filters.test.ts:80-85` carries
`"fetch"` inside its own `INSTALLED_GLOBALS` and `delete`s it in cleanup. That
removes Node's **native** `fetch` from the worker realm, not just the test's
stub — under `isolate: false` the deletion outlives the file.

**Evidence.** The identical bug was found and fixed in
`scripts/__tests__/history-tables.test.ts` during PR #2849 round-2 review
(snapshot in `beforeEach`, restore in `afterEach`, instead of `delete`);
probing confirmed the pre-fix version left `typeof globalThis.fetch ===
"undefined"` for subsequent files in the same worker. `history-filters.test.ts`
is pre-existing and was outside that PR's diff, so it still does it.

**Why it may not deserve its own issue.** Currently harmless: no node-project
test consumes `fetch`, proved by a whole-suite single-worker run (77 files /
1544 tests green). It is a latent, order-dependent trap rather than a live
failure, and the fix is a three-line edit that could ride along with any future
change to that file.
