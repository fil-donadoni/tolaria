---
title: Colour indicators (CR 202.2b) are not modelled, so the three shipped Kobolds read as colourless to every cost-derived colour check
discoveredBy: 3229
status: draft
confidence: medium
---

**What is wrong.** `CardDefinition` carries no colour indicator, and
`convex/cards/colors.ts` documents the omission. Every colour answer the engine
gives for a card in a non-battlefield zone is therefore derived from the MANA
COST: `emitSpellCastEvent` sets `SpellCastEvent.spellColors` from
`getColorsFromCost(def.manaCost)` (`convex/gre/state.ts`), and
`matchesSpellFilter` reads that field.

CR 105.2 gives an object its colour from its mana cost **or** a colour indicator
**or** a characteristic-defining ability. A card with an empty mana cost and a
colour indicator is coloured; the engine says it is colourless.

**Evidence.** Three shipped cards hit it exactly: Crimson Kobolds, Crookshank
Kobolds and Kobolds of Kher Keep (`convex/cards/sets/leg/colorless.ts`) are
defined with `manaCost: {}` and no colour, but Scryfall gives all three
`colors: ["R"]` / `color_indicator: ["R"]`. They are also filed under
`colorless.ts`, which ADR 0043's "colour identity of the mana cost" rule makes
locally consistent and globally wrong.

The first card to CARE landed with issue #3229: Ugin, Eye of the Storms'
`Whenever you cast a colorless spell, exile up to one target permanent that's one
or more colors` (`convex/cards/sets/tdm/colorless.ts`) uses
`SpellFilter.excludeColors: ["W","U","B","R","G"]`, which is the exact reading of
CR 105.2c — and will fire on a Kobold, where paper says it must not. No other
shipped card asks "is this spell colourless", and no devoid card ships, so the
reverse direction (a coloured mana cost on a colourless object) is currently
unreachable.

**Why this is invisible to the gate.** Nothing cross-checks a definition's
derived colours against Scryfall's `colors`. `catalogue:check` joins on names and
oracle text; the compiler round-trip compares a definition to its own Oracle
text, which does not mention colour.

**Why it may not deserve its own issue.** Three cards, one shipped consumer, and
the interaction (cast a Kobold with Ugin on the battlefield) is a corner even in
Legacy. Against that: the fix is small and mechanical if scoped to what is
needed — a `colorIndicator?: Color[]` on `CardDefinition`, honoured by
`getColorsFromCost`'s callers and by `effectiveColors` — and it also unblocks
devoid (CR 702.114), which is a whole keyword rather than three cards. That
argues for one ticket named after the CAPABILITY (colour indicators), with the
Kobolds as its first three rows, rather than a Kobold bug report.
