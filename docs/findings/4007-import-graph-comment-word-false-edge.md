---
title: The import scanner reads the word "import" in a comment as the start of a runtime import
discoveredBy: 4007
status: draft
confidence: high
---

**What is wrong.** The first of `SPECIFIER_PATTERNS` in
`scripts/lib/import-graph.ts` runs over raw source with comments left in. A
comment line ending in the word `import` starts a match, the optional `type`
group fails on the comment's next word, and the lazy span runs on to the next
`from "…"`. An `import type` below that comment is recorded as a RUNTIME edge.

**Evidence.** The comment above the compiled-trigger imports in
`convex/cards/types.ts` ends `…and neither import` / `// survives compilation.`.
PR #8151 placed its `import type` of `./abilities/splitSecond` directly below
it, which gave the graph the false edge `types.ts → splitSecond.ts →
gre/constants.ts → cards/index.ts → catalogue.ts`. That redded
`scripts/__tests__/match-setup-light-surface.test.ts` in the queue, though the
build erases the statement. Moving the line away from the comment cleared it, so
the same false edge now points at `./compiledTriggers`, where it costs nothing
today.

**Why it may not deserve its own issue.** It only over-approximates: the closure
gains edges, so reachable tests are never lost, and the worst case is a loud red
on a light-surface test or a wider lane. Fixing it means stripping comments
before scanning, which can change the plan of every lane that reads the graph.
