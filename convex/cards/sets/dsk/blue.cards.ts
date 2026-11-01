// dsk — blue cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/P-T are from Scryfall (id = DSK paper printing).

import { defineCard } from "../../types";
import { enduringReturnTrigger } from "../../abilities/enduringReturn";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Enduring Curiosity — {2}{U}{U} Enchantment Creature — Cat Glimmer, 4/3
// (issue #2085, the DSK "Enduring" cycle; the shared dies-trigger and its
// CR 205.1a / 613.1d derivation live in `abilities/enduringReturn.ts`).
//
// "Flash" — CR 702.8a, a `staticAbilities` keyword; the registry row is
// `implemented`, so no allowlist entry is owed (Guard A).
//
// "Whenever a creature you control deals combat damage to a player, draw a
// card." — CR 120.3 / 603.2 damage-dealt trigger, the exact `damageDealtTrigger`
// shape Psychic Frog already ships (`sets/mh3/multicolor.cards.ts`) with two axes
// widened:
//
//   `source: "yours"` + `sourceFilter: { types: "Creature" }` — the damage
//   SOURCE is any creature its controller controls (CR 109.5 — "you" on an
//   object refers to that object's controller), not the enchantment itself.
//   Enduring Curiosity is a creature you control, so its
//   OWN combat damage fires this too (the Oracle says "a creature", not
//   "another creature"); once it has returned as an enchantment it no longer
//   matches its own filter, but it still watches every other creature.
//
//   `target: { kind: "player", player: { relation: "any" } }` — the printed
//   clause names "a player" flat, with no controller relation and no
//   planeswalker leg (contrast Psychic Frog's "player or planeswalker"), so
//   the discriminator must not narrow to `opponent`: in a mirror where an
//   effect points a creature you control at yourself, the draw still happens.
//
//   `isCombat: true` — CR 510.1 combat damage only.
//
// Guard C (issue #2701) — the Oracle compiler's grammar has no slot for
// either half of this card yet, so the fragments are named here for the
// corpus backlog PRD #2693 ranks the next grammar rule by. The shared
// dies-trigger fragment is the cycle's, quoted as printed for THIS card;
// Enduring Innocence carries its own line in the
// one-time baseline instead, which only ever shrinks.
// compiler-gap: Whenever a creature you control deals combat damage to a player, draw a card. (#2693)
// compiler-gap: When Enduring Curiosity dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (It's not a creature.) (#2693)
export const enduringCuriosity = defineCard(() => ({
    id: "8616629e-08f9-41ad-bfec-f86c8096f1cb",
    name: "Enduring Curiosity",
    rarity: "rare",
    manaCost: { X: 2, U: 2 },
    types: ["Enchantment", "Creature"],
    subtypes: ["Cat", "Glimmer"],
    power: 4,
    toughness: 3,
    oracleText:
        "Flash\nWhenever a creature you control deals combat damage to a player, draw a card.\nWhen Enduring Curiosity dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (It's not a creature.)",
    staticAbilities: ["flash"],
    triggeredAbilities: [
        damageDealtTrigger({
            id: "enduring-curiosity-draw",
            oracleText:
                "Whenever a creature you control deals combat damage to a player, draw a card.",
            source: "yours",
            sourceFilter: { types: "Creature" },
            isCombat: true,
            target: { kind: "player", player: { relation: "any" } },
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
        // The cycle's shared dies-trigger (CR 700.4 / 603.4 intervening-if,
        // CR 205.1a / 613.1d type-line SET) — `abilities/enduringReturn.ts`.
        enduringReturnTrigger({
            id: "enduring-curiosity-return",
            cardName: "Enduring Curiosity",
        }),
    ],
}));

// Abhorrent Oculus — {2}{U} Creature — Eye, 5/5 (issue #2072).
//
// "As an additional cost to cast this spell, exile six cards from your
// graveyard." — CR 601.2f / 118.8, `additionalCosts.exileFromGraveyard`:
// owed by every cast, paid through the one graveyard-exile cast picker
// (`PendingCast.exileFromGraveyardChoice`), and the cast is illegal with fewer
// than six other cards in the graveyard (CR 601.2h).
//
// "Flying" — CR 702.9a, an `implemented` keyword (Guard A).
//
// "At the beginning of each opponent's upkeep, manifest dread." — CR 503.1a /
// 603.2 upkeep trigger, `scope: "opponents"` (once per opponent's upkeep, the
// Dark Suspicions shape). The body is the CR 701.62a `manifestDread` Op for the
// CONTROLLER: "manifest dread" reads "your library" (CR 701.62a), never the
// opponent whose upkeep it is.
//
// Guard C (issue #2701) — both clauses are sub-floor Grammar Gaps today: the
// additional-cost static and the opponent-upkeep trigger head (#4582).
// compiler-gap: As an additional cost to cast this spell, exile six cards from your graveyard. (#2693)
// compiler-gap: At the beginning of each opponent's upkeep, manifest dread. (#4582)
export const abhorrentOculus = defineCard(() => ({
    id: "d2705b43-a94a-44c0-8740-82e0b296820c",
    name: "Abhorrent Oculus",
    rarity: "mythic",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Eye"],
    power: 5,
    toughness: 5,
    oracleText:
        "As an additional cost to cast this spell, exile six cards from your graveyard.\nFlying\nAt the beginning of each opponent's upkeep, manifest dread. (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)",
    staticAbilities: ["flying"],
    additionalCosts: { exileFromGraveyard: { count: 6 } },
    triggeredAbilities: [
        phaseTrigger({
            id: "abhorrent-oculus-manifest-dread",
            oracleText:
                "At the beginning of each opponent's upkeep, manifest dread.",
            phase: "UPKEEP",
            scope: "opponents",
            effects: [{ op: "manifestDread", player: "controller" }],
        }),
    ],
}));
