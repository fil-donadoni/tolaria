---
title: `CR 702.D` is not a rule id — Delirium is an ability word (CR 207.2c) and `cr:lint`'s id regex does not see the letter suffix
discoveredBy: 2150
status: draft
confidence: medium
---

**What is wrong.** Several comments annotate Delirium as `CR 702.D`. That is not
a rule id: `bun run cr 702.D` prints the usage banner, and Delirium has no
Comprehensive Rules entry at all — `CR 207.2c` lists it among the ability words,
which "have no special rules meaning and no individual entries in the
Comprehensive Rules". `cr:lint`'s id regex stops at `702`, which resolves
("Keyword Abilities"), so the citation passes the guard while naming a section
Delirium is not in.

**Evidence.** `convex/gre/effects/interpreter.ts` (the `countTypes` branch of
`countZoneForPlayer`) is the pre-existing site. PR #4412 re-pointed the four
lines it authored to `CR 207.2c` and left that one, since it is untouched by the
diff.

**Why it may not deserve its own issue.** One line, no behaviour. The reusable
half is the guard gap: `cr:lint` could reject a `CR <digits>.<letter>` spelling
outright, which is a cheap addition to `scripts/check-cr-citations.ts` and would
stop the class rather than this instance.
