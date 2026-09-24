---
title: The search clone is a generic deep copy linear in library size; copy-on-write library sharing would cut ~10 % but risks silent aliasing
discoveredBy: 4454
status: draft
confidence: medium
---

**What is wrong.** `cloneGameState` is a recursive `Object.keys` deep copy
sharing only `card` refs: 15–20 µs on a 20-card library, 34–40 µs at 53 cards,
about 215 objects per clone, 10.7 % of search time; a live 60-card game has
~2.5× the library objects.

**Evidence.** `convex/gre/clone.ts` (~35–60); measurements in the 2026-09-23
audit.

**Why it may not deserve its own issue.** The in-place engine rules out
copy-on-write at the state level (the module header says so); sharing library
card objects specifically (draw/shuffle replace entries, rarely mutate) is
plausible but an aliasing bug there is silent. Worth an issue only with a
mutation-isolation property test in the same ticket, and after PRD (b) #4454's
counters show the clone share on real 60-card positions.
