---
title: The Oracle compiler has no Saga chapter grammar, and no gap row or open issue says so
discoveredBy: 7374
status: draft
confidence: high
---

**What is wrong.** No compiler path lowers a Saga chapter line to `chapterAbilities`. The whole `saga` layout is refused, and the Sagas on the front or back of a `transform` card fail line by line. Neither shows up as a `data/grammar-gaps.json` row, and no open issue has "saga" in its title or "saga chapter" in its text (GitHub search, 2026-11-04).

**Evidence.** Measured on `staging` @ `92a7e4bbf` with `compileCard` over `data/oracle-corpus.json.gz`:

- All 204 `layout: "saga"` cards are `unparsed`, with `layout "saga" is not in grammar v0 (multi-faced cards)` (`compileCard`, `SUPPORTED_LAYOUTS` holds only `normal`).
- 29 of the 54 corpus lines "exile …, then return … transformed" are chapter lines (`III — Exile this Saga, …`). They report `no slot consumed the line`, attributed to the `static` slot.
- The only mention of chapters in the compiler is a comment in `convex/oracle/lowerStatic.ts` noting that `expandChapterAbilities` reads `chapterAbilities`. The engine side exists; the grammar side does not.

**Why it may not deserve its own issue.** The `(card) › layout …` rows may be ranked per Target rather than listed for every layout: `layout "class"` (35 cards) has no row either, until issue #8046. `gaps:sync` could therefore file this by itself once a ranked Target needs a Saga, in which case a hand-filed ticket would duplicate it. Why the two layouts have no row was not investigated. Issue #7374 left chapter lines out of its scope for this reason.
