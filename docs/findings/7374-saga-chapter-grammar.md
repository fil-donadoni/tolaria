---
title: The Oracle compiler has no Saga chapter grammar, and no gap row or open issue says so
discoveredBy: 7374
status: triaged
issue: 8056
confidence: high
---

**What is wrong.** No compiler path lowers a Saga chapter line to `chapterAbilities`. The whole `saga` layout is refused, and the Sagas on the front or back of a `transform` card fail line by line. Neither shows up as a `data/grammar-gaps.json` row, and no open issue has "saga" in its title or "saga chapter" in its text (GitHub search, 2026-11-04).

**Evidence.** Measured on `staging` @ `92a7e4bbf` with `compileCard` over `data/oracle-corpus.json.gz`:

- All 204 `layout: "saga"` cards are `unparsed`, with `layout "saga" is not in grammar v0 (multi-faced cards)` (`compileCard`, `SUPPORTED_LAYOUTS` holds only `normal`).
- 29 of the 54 corpus lines "exile …, then return … transformed" are chapter lines (`III — Exile this Saga, …`). They report `no slot consumed the line`, attributed to the `static` slot.
- The only mention of chapters in the compiler is a comment in `convex/oracle/lowerStatic.ts` noting that `expandChapterAbilities` reads `chapterAbilities`. The engine side exists; the grammar side does not.

**Why no row exists (investigated).** Working as designed. `buildFragmentGapFilings` files a fragment gap only for cards of an `enforced` Target; the only one is `set-apc`, with 0 Sagas, and `check:gaps` reads the same scope. Priority Targets are claimed by hand and only for non-playable cards (PR #7196): the one `saga`-layout card in `vintage-cube`, Urza's Saga, ships by hand, and `format-premodern` holds none. `gaps:sync` would therefore file nothing until a Target holding an unshipped Saga is enforced. `layout "class"` (issue #8046) and `layout "leveler"` have the same shape: one hand-shipped `vintage-cube` card each. Filed by hand as issue #8056.
