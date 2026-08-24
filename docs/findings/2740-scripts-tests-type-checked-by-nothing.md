---
title: scripts/__tests__/** is type-checked by no tsconfig project
discoveredBy: 2740
status: draft
confidence: high
---

**What is wrong.** `bun run check:ts` (`tsc -b --noEmit` over the four
referenced projects) never sees a single file under `scripts/__tests__/`.
`tsconfig.scripts.json` is the only project that includes `scripts`, and it
excludes the test directory outright; no other project picks it up. Vitest then
runs those files through esbuild, which strips types without checking them — so
a type error in a scripts guard test is invisible to the whole gate until it
happens to produce a runtime failure.

**Evidence.** `tsconfig.scripts.json:33-34` — `"include": ["scripts"]`,
`"exclude": ["scripts/__tests__"]`. Measured on this branch:

```
bunx tsc -b tsconfig.scripts.json --noEmit --listFiles | grep -c __tests__   # 0
bunx tsc -b tsconfig.app.json     --noEmit --listFiles | grep -c 'scripts/'  # 0
```

`tsconfig.json:8-13` references exactly `tsconfig.app.json`,
`tsconfig.node.json` (`include: ["vite.config.ts"]`), `tsconfig.scripts.json`
and `convex/`, so nothing else can be covering it. This is 60+ guard test files
— including `land.test.ts`, `check-guards-scope.test.ts` and every census guard
the merge-train depends on.

**Why it may not deserve its own issue.** The exclusion may be deliberate and
load-bearing: test files import `vitest` globals and use `expect(...)` chains
that could need a different `types` array, and adding them could red the gate on
pre-existing errors that nobody has budget to fix. Someone should first measure
how many errors appear when the exclusion is dropped — if it is zero or near it,
this is a one-line fix; if it is large, it is a tracker, not a ticket. Adjacent
to #2738's slice 1 (tsconfig incremental build state), which is already editing
these files.
