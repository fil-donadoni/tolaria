---
title: deckStats has no catalogue fallback for a Tabletop (manual-format) deck's unimplemented cards
discoveredBy: 1630
status: draft
confidence: medium
---

**What is wrong.** `computeDeckStats` (`src/lib/deckStats.ts`) resolves each
`DeckCard` through the registry only (`tryGetDefinition`, default `resolve`
param). Its sibling `computeDeckColors` (`src/lib/deckColors.ts`) instead
takes a `DeckCardShapeResolver` that chains registry → Full Catalogue
(`makeDeckCardShapeResolver`, `deckCardShape.ts`), so a Tabletop (`manual`
format, ADR 0080) deck's uncatalogued/unimplemented cards still contribute a
colour. `deckStats.ts` has no such fallback: a Tabletop deck's unimplemented
cards silently contribute nothing to the curve, pip counts, sources, or
type/subtype maps — the Stats dialog would under-report for exactly the deck
shape ADR 0080 was written to support.

**Evidence.** `src/lib/deckCardShape.ts:21-56` — `DeckCardShape` /
`catalogueRowShape` cover `isLand`, `manaValue`, `colors` (identity) off a
`FullCatalogueRow`. There is no catalogue-row equivalent for pip counts,
producible colours, or type/subtype maps: a `FullCatalogueRow` (`fullCatalogue.ts`)
carries `typeLine`, `cmc`, `colourIdentity` — no `manaCost` structured pips
(hybrid/Phyrexian breakdown), no `activatedAbilities`/`subtypes` mana data
`getDefinitionProducibleColors` needs. `deckStats.ts:19-21`'s
`DeckCardDefinitionResolver` type is registry-only by construction
(`CardDefinition | null`), so there is no seam today to plug a catalogue
fallback into even if the row shape existed.

**Why it may not deserve its own issue.** Issue #1630 scoped this ticket to
"pure module, no UI" and its acceptance criteria never mention Tabletop
decks; PRD #1617's "Stats dialog" section (as read for this ticket) doesn't
call out manual-format coverage either. Building the fallback would first
need a richer `FullCatalogueRow`-equivalent (type line parsing already gives
crude type/subtype counts for free via `parseTypeLine`, but pip counts and
mana-producing abilities are not derivable from a Scryfall type line/mana
cost string alone — a rock/dork's `{T}: Add …` text isn't structured data in
the catalogue). Whether the Stats dialog needs full parity for Tabletop decks
at all — vs. just showing "N/A" or a partial curve for that format — is a
product decision, not obviously a ticket floor. Low urgency: Tabletop is one
deck format among several, and today's deckbuilder Stats dialog does not
exist yet (this is groundwork for it), so nothing regresses.
