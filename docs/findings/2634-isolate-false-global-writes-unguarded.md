---
title: vitest.config.ts justifies isolate:false on a "zero global writes" claim that three test files now falsify
discoveredBy: 2634
status: draft
confidence: medium
---

**What is wrong.** `vitest.config.ts:69-78` justifies `isolate: false` on the
node projects by asserting those tests do "ZERO ... global writes". Three
`scripts/__tests__` dashboard files now write globals and restore the
postcondition only through a hand-maintained `INSTALLED_GLOBALS` list. Nothing
guards a future mount helper that gains a global the list forgets.

**Evidence.** PR #2849 shipped exactly that regression before review caught it:
`scripts/__tests__/history-tables.test.ts` assigned `globalThis.document` in
`mountPage()` and never removed it, so under `isolate: false` the happy-dom
document outlived the file inside its worker. Any later node-project file
importing `~/router` then took `@tanstack/router-core`'s browser branch
(`this.isServer = typeof document === "undefined"`, `router.ts:1063`) and died
in `createBrowserHistory` with `ReferenceError: window is not defined`.
Reproduced deterministically with
`bunx vitest run --project node scripts/__tests__/history-tables.test.ts src/routes/__tests__/router-limited-precedence.test.ts --no-file-parallelism --maxWorkers=1`.
It was order-dependent, so a clean rerun was green — the first fixup dismissed
it as a harness flake on exactly that basis.

**Why it may not deserve its own issue.** The convention (`INSTALLED_GLOBALS` +
`afterEach` delete, rationale written out at
`scripts/__tests__/dashboard-glossary.test.ts:66-70`) already exists and all
current files follow it. A repo-wide guard — assert after each node-project file
that the global set is unchanged from the start of the run — would be its own
ticket, and is only worth it if a second file drifts. Until then this is a line
on whatever tracker owns test-infra hygiene.
