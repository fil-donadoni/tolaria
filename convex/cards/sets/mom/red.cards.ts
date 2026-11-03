// mom — red cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

const ETALI_PRIMAL_CONQUEROR_ID = "95c14c4d-6c16-4826-8d93-d89ad04aee09";

// Etali, Primal Conqueror // Etali, Primal Sickness (issue #2608) — a
// transforming double-faced card (CR 712), both faces pure Effect Script.
//
// Front ETB: "each player exiles cards from the top of their library until
// they exile a nonland card" is `revealUntilMatch` (match and rest both to
// exile, CR 406.3 — face up, public) inside `forEach { set: "players" }`
// (APNAP, CR 101.4); each walk binds its nonland card into `$etaliHit`. Read
// past the construct, the binding is the UNION of every player's card — "the
// nonland cards exiled this way" — and `castDuringResolution { anyNumber }`
// offers them one at a time, free, to Etali's controller (CR 608.2g),
// whoever owns them. A player whose library holds no nonland card exiles all
// of it and contributes nothing; an empty library exiles nothing — never a
// loss (CR 101.3 / 609.3; drawing from an empty library is the loss, CR
// 704.5b, and nothing here draws).
//
// "{9}{G/P}: Transform Etali. Activate only as a sorcery." — the Phyrexian
// pip in an activated cost is the mana-or-2-life split (CR 107.4f, issue
// #7830); `transform` flips it in place (CR 701.27a).
//
// Back face: "they get that many poison counters" is `addPlayerCounter` on
// the damaged player for the event's amount, on combat damage only (CR
// 510.2); ten poison counters is the shipped CR 704.5c loss.
//
// hand-tail: "When {self} enters, each player exiles cards from the top of their library until they exile a nonland card. You may cast any number of spells from among the nonland cards exiled this way without paying their mana costs." (#2608)
// hand-tail: "Whenever {self} deals combat damage to a player, they get that many poison counters." (#2608)
export const etaliPrimalConqueror = defineCard(() => ({
    id: ETALI_PRIMAL_CONQUEROR_ID,
    name: "Etali, Primal Conqueror",
    rarity: "rare",
    oracleText:
        "Trample\nWhen Etali enters, each player exiles cards from the top of their library until they exile a nonland card. You may cast any number of spells from among the nonland cards exiled this way without paying their mana costs.\n{9}{G/P}: Transform Etali. Activate only as a sorcery.",
    manaCost: { X: 5, R: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elder", "Dinosaur"],
    power: 7,
    toughness: 7,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        enteredTrigger({
            id: "etali-primal-conqueror-etb",
            oracleText:
                "When Etali enters, each player exiles cards from the top of their library until they exile a nonland card. You may cast any number of spells from among the nonland cards exiled this way without paying their mana costs.",
            scope: "self",
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "revealUntilMatch",
                            player: { ref: "$each" },
                            filter: { excludeType: "Land" },
                            match: "exile",
                            rest: "exile",
                            bind: "$etaliHit",
                        },
                    ],
                },
                {
                    op: "castDuringResolution",
                    player: "controller",
                    card: { ref: "$etaliHit" },
                    source: "exile",
                    free: true,
                    anyNumber: true,
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "etali-primal-conqueror-transform",
            oracleText:
                "{9}{G/P}: Transform Etali. Activate only as a sorcery.",
            cost: { mana: { X: 9, phyrexian: { G: 1 } } },
            sorcerySpeedOnly: true,
            useStack: true,
            effects: [{ op: "transform", target: { ref: "$source" } }],
        },
    ],
    backFace: {
        name: "Etali, Primal Sickness",
        types: ["Creature"],
        supertypes: ["Legendary"],
        subtypes: ["Phyrexian", "Elder", "Dinosaur"],
        colors: ["G", "R"],
        power: 11,
        toughness: 11,
        staticAbilities: ["trample", "indestructible"],
        oracleText:
            "Trample, indestructible\nWhenever Etali deals combat damage to a player, they get that many poison counters. (A player with ten or more poison counters loses the game.)",
        imagePrintId: ETALI_PRIMAL_CONQUEROR_ID,
        triggeredAbilities: [
            damageDealtTrigger({
                id: "etali-primal-sickness-poison",
                oracleText:
                    "Whenever Etali deals combat damage to a player, they get that many poison counters.",
                source: "self",
                isCombat: true,
                target: { kind: "player", player: { relation: "any" } },
                effects: [
                    {
                        op: "addPlayerCounter",
                        player: { ref: "$event.damagedPlayer" },
                        counter: "poison",
                        amount: { ref: "$event.amount" },
                    },
                ],
            }),
        ],
    },
}));
