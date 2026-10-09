# A Match carries a Match Format; Decks are admitted against it, never against each other

## Status

accepted — grilled 2026-10-09 (lobby / Play vs Bot session). Supersedes the
pairwise **Format Compatibility** predicate shipped by issue #4611 (PR #5313).
Amends ADR 0145 § Decision 1 (how a Commander Profile is reached). Prototype:
branch `prototype/match-setup-wizard` (throwaway, never merged).

## Context

Issue #4611 enforced which Decks may meet as a pure function of the two
Decks' Formats, `formatsCompatible(a, b)`: every Standard-Variant Format met
every other (Premodern met Old School, Alpha 40 and Freeform), Limited met
Limited, Manual met Manual. The joiner's deck list was filtered against the
host's deck. It did not reach the Play vs Bot dialog, whose opponent-deck
picker still offered every deck, and `createSoloGame` never checked `deck2`.

The owner's premise was different: a player decides up front what kind of
game this is, and is then offered only the Decks that belong to it. "Which two
Decks may meet" is the wrong question; "which Decks may sit at this Match" is
the right one. Two seats never need to agree with each other — each agrees
with the Match. The pairwise family table also answered the question too
loosely: a Premodern player picking a Bot opponent was shown Alpha 40 and
Freeform decks.

`Match Format` already named the Limited Event's Bo1/Bo3 setting; the setting
is renamed **Games Format** so the name is free for this decision.

## Decision

1. **A Match carries a Match Format**, chosen when the Match is set up and
   stored on the Match. Every seated Deck is admitted against it: a Deck is
   admitted when its Format equals the Match Format. **Freeform is the one
   exception: a Freeform Match Format admits every playable Deck** (not
   Manual — the engine cannot play it). To pit a Premodern list against an
   Old School one, the player picks Freeform.
2. **The server is the authority** (ADR 0074). Every creating mutation
   (`createGame`, `createSoloGame` with or without the Bot, the Manual
   variants) checks every seat's Deck against the Match Format it is given,
   `deck2` included; every join checks the joiner's Deck against the Match
   Format the host's Match stores. Client filtering is a convenience.
3. **`formatsCompatible` is retired**, replaced by one admission predicate
   (Deck, Match Format) in `convex/formats.ts`.
4. **Cockatrice fixes the Match Format to Manual; a join inherits the host's**
   — neither asks for it.
5. **A Commander Profile is itself a Match Format** (amends ADR 0145 § 1): a
   Profile-level Match Format admits every Deck whose Format maps to that
   Profile, so Brawl still meets Standard Brawl. ADR 0145 rejected a Profile
   chosen at the table as "one more prompt"; this is not one — the Match
   Format step already exists, and whether the Profile is shown as its own
   label or reached through the Format is a UX decision left to the
   implementation.
6. **The lobby's Constructed setup is a linear flow** whose third step is the
   Match Format: game mode → opponent (Bot / Solo / Host / Join) → Match
   Format + Games Format → your Deck → the Bot's Deck (or the second seat's).
   Limited is a separate branch.

## Consequences

- Premodern no longer meets Old School, Alpha 40 or a Freeform deck unless
  the Match Format is Freeform — a deliberate narrowing of #4611's table.
- An open table advertises its Match Format, not its host's Deck Format.
- Existing waiting Matches carry no stored Match Format; the implementation
  derives one from the host's Deck Format for them (a read-time default, no
  migration of finished Matches).
- The Bo1/Bo3 identifiers (`MatchFormat`, `match-format-selector`, the Limited
  Event's `matchFormat`) are renamed to Games Format.

## Considered options

- **Keep the pairwise family table, add it to the Bot picker.** Rejected: it
  answers "may these two Decks meet", which no player asks, and it is too wide
  (Premodern vs Freeform) for a Bot opponent.
- **Exact Format equality with no exception.** Rejected: leaves no way to play
  across Formats; Freeform already means "no constraint" at deck authoring
  and carries the same meaning at the Match.
- **A separate "Game Format" on the Game.** Rejected: a Format governs the
  whole Match (every Game of a Bo3 uses the same Decks).
