---
title: Premodern deck-builder search/import still filters by PREMODERN_LEGAL_SETS, which can now disagree with the real validator
discoveredBy: 2695
status: draft
confidence: medium
---

**What is wrong.** #2695 moved Premodern deck LEGALITY off `PREMODERN_LEGAL_SETS`
entirely (`premodernValidate` now calls `checkOracleLegality` against a
generated Scryfall-legality map, never `checkSets`/`allowedSets`). But
`FORMAT_RULES.premodern.allowedSets` still derives from `PREMODERN_LEGAL_SETS`
(kept on purpose — see the doc comment on the const,
`convex/formats.ts:1057-1073`) and two frontend consumers still read it:

- `src/components/lobby/deck-builder/useCardSearch.ts` (`matchesFormatSets`)
  pre-filters which printings the Premodern deck-builder search surfaces.
- `src/lib/deckImport.ts` (`preferredPrintId`-style ordering) picks which
  printing a name-based import prefers when a card has multiple.

So a card that is genuinely Premodern-legal (per Scryfall, per the real
validator) but whose only built printing sits outside `PREMODERN_LEGAL_SETS`
(472 such cards exist in the catalogue today as of the 2026-08-25 corpus —
Animate Dead, Air Elemental, Swords to Plowshares's non-legal-set reprints,
etc.) will validate fine if added to a deck, but may not surface prominently
in the Premodern deck-builder's OWN search, or may import with a
non-obviously-preferred printing. The two systems (legality vs. search/import
convenience) are now allowed to diverge, whereas before #2695 they were
definitionally the same list.

**Evidence.** `convex/formats.ts` doc comment on `PREMODERN_LEGAL_SETS`
(post-#2695) says explicitly: _"A card correctly legal-by-Scryfall but
printed only outside this list will still validate even where the
search/import UI doesn't surface it as prominently."_ Cross-referenced against
`src/components/lobby/deck-builder/useCardSearch.ts:352-353` and
`src/lib/deckImport.ts:51-53`, both of which read
`FORMAT_RULES[format].allowedSets` unchanged.

**Why it may not deserve its own issue yet.** It is a UX polish gap, not a
correctness bug — every card that's actually legal still validates when
played, and the deck stays legal at every gate that matters (save, game
start). It only affects how easily a player finds/imports a legal card whose
BUILT printing sits outside the old hand-maintained set list. Worth a ticket
once #2696 (the Tier 1 deck report) or a later slice shows this actually
blocks a real deck from being built through the UI in practice — right now
it's a theoretical UX rough edge, not a demonstrated one.
