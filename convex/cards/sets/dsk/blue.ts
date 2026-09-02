// dsk — blue cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/P-T are from Scryfall (id = DSK paper printing).

import type { CardDefinition } from "../../types";
import { enduringReturnTrigger } from "../../abilities/enduringReturn";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

// Enduring Curiosity — {2}{U}{U} Enchantment Creature — Cat Glimmer, 4/3
// (issue #2085, the DSK "Enduring" cycle; the shared dies-trigger and its
// CR 205.1a / 613.1d derivation live in `abilities/enduringReturn.ts`).
//
// "Flash" — CR 702.8a, a `staticAbilities` keyword; the registry row is
// `implemented`, so no allowlist entry is owed (Guard A).
//
// "Whenever a creature you control deals combat damage to a player, draw a
// card." — CR 120.3 / 603.2 damage-dealt trigger, the exact `damageDealtTrigger`
// shape Psychic Frog already ships (`sets/mh3/multicolor.ts`) with two axes
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
export const enduringCuriosity: CardDefinition = {
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
};
