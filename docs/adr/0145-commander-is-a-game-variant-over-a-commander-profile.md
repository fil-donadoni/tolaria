# Commander is a Game Variant over a Commander Profile, not a Format

## Status

accepted — grilled 2026-09-24. Plans v2 of ADR 0143 (Amendment III); no code
yet. Terms in `CONTEXT.md`: **Game Variant**, **Commander Profile**, **Command
Zone**, **Commander**, **Command Slot**, **Color Identity**, **Commander
Damage**, **Format Compatibility**, **Paranoid Reduction**.

## Context

CR 903.1 calls Commander a _variant_: "the Commander variant uses all the
normal rules for a Magic game, with the following additions" — a command zone
(CR 408), a commander tax (CR 903.8), life 40 (CR 903.7), a loss at 21 combat
damage from one commander (CR 903.10a), a commander that may return to the
command zone as a state-based action its owner _chooses_ (CR 903.9a) or as a
replacement effect (CR 903.9b). Every one of those is a game rule, not a
deck-construction rule. Tolaria's **Format** (ADR 0036) is deck-construction
only: "not a property of a Game, and two Players may bring Decks of different
Formats to the same Match" — true of Premodern versus Old School, false of
Commander, where the game itself must know it is one. And the family is not
one rule set: Brawl (CR 903.12) plays at 25 life with no commander damage and a
free first mulligan; Duel Commander at 20 with its own banned list; EDH at 40.

## Decision

1. **A Match carries a Game Variant** — `standard` or `commander` — fixed at
   creation; a Deck carries a Format as before. The Commander Variant reads its
   numbers (starting life, whether Commander Damage is a loss condition, the
   free first mulligan, planeswalker commanders) from a **Commander Profile**
   that is a pure function of the Deck's Format: `brawl` (Brawl, Standard
   Brawl), `duel-commander`, `edh`. Nothing is chosen at the table. A Match
   admits only Decks whose Formats map to one Profile — **Format
   Compatibility**, a predicate in one place, enforced at join (today the
   lobby only hints the host's Format; the predicate generalises to it as a
   `P1` issue).
2. **The Command Zone is a real per-player Zone holding only the Commander.**
   Emblems belong there by CR 114.1/408.2 and stay modelled apart in
   `emblems[]`, shown as a distinct area: no rule counts commander and emblems
   together, so structural fidelity buys nothing. The Companion Slot stays
   outside the game as ADR 0064 has it.
3. **The commander is designated on the Deck, in a third zone** (`commanders[]`,
   a list so Partner has a home when that mechanic ships whole; until then one),
   counted in the Format's deck size (CR 903.5a). A Commander-family Format
   refuses a non-empty Sideboard (CR 903.11).
4. **Commander status is an attribute of the card, not a characteristic**
   (CR 903.3): an uncopiable `isCommander` on the instance, invisible to the
   layer system. Commander Damage is keyed by (commander's owner, victim), never
   by object, so it survives the commander's return and recast.
5. **CR 903.9a is the first state-based action with a player choice** and is
   modelled as exactly that: the SBA pass raises a pending choice for the
   owner, at the moment the CR names ("since the last time state-based actions
   were checked"). Not auto-return (a commander left in the graveyard for
   reanimation is a real choice) and not a deferred prompt at the next priority
   window (that shifts a zone change past death triggers and LKI reads).
6. **Color Identity** (CR 903.4) is sourced from Scryfall's `color_identity` as
   a generated, name-keyed map — the Premodern-legality shape — and REPLACES
   the definition-side `getCardColorIdentity` under the same name; it is not a
   second notion beside it.
7. **Order of work**: the Variant at two players (Brawl, Duel Commander) →
   the engine at N players in the Standard Variant (Free-for-All, CR 806;
   leaving the game, CR 800.4; the Bot under Paranoid Reduction) → EDH at
   three or more, with the Focus / Mosaic board. Multiplayer is engine risk,
   Commander is rules; they are paid separately.

## Alternatives considered

- **Commander as a Format only**, the Game reading the deck's format for its
  rules. Rejected: the Game would read a deck-authoring concept for game
  rules, and two Brawl decks versus one Duel deck would have no coherent life
  total.
- **A Profile chosen at Match creation**, independent of the Formats. Rejected:
  one more prompt for a choice that never legitimately differs from the
  Formats.
- **A single `commander` Variant with fixed numbers**, Brawl and Duel as later
  variants. Rejected: the three differ in game rules, not just in deck size,
  so a binary Variant would have been wrong on the first two Formats planned.
- **Emblems migrated into the Command Zone** for CR 114 fidelity. Deferred, not
  refused: a refactor with no observable rule behind it.
- **EDH at four players first**, engine and rules together. Rejected: two
  deep changes in one milestone, with no way to attribute a regression.
