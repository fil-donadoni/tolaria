// nph — black cards (ADR 0043 colour split). New Phyrexia (2011) is the home
// set (earliest paper printing) for this Phyrexian-mana cube cluster (issue
// #696). Dismember is black even though it can be cast for life: its Phyrexian
// pips `{B/P}` are black mana symbols (CR 105.2 — `getColorsFromCost` counts
// them).
import { defineCard } from "../../types";

// Dismember — "Target creature gets -5/-5 until end of turn." Phyrexian mana
// `{1}{B/P}{B/P}` (CR 107.4f): each `{B/P}` is paid with {B} or 2 life, the
// caster's per-pip choice, resolved in the cost system (`convex/gre/phyrexian.
// ts`, threaded through `announceCast.phyrexianLifePips`). The on-resolution
// effect is a plain -5/-5 until end of turn via the `pump` Op (CR 611.1 layer
// 7c temporary P/T modification) — DSL-first, no closure needed.
export const dismember = defineCard(() => ({
    id: "064dfdeb-485f-473e-9fa0-8fdb7638cdc6",
    rarity: "uncommon",
    name: "Dismember",
    oracleText:
        "({B/P} can be paid with either {B} or 2 life.)\nTarget creature gets -5/-5 until end of turn.",
    manaCost: { X: 1, phyrexian: { B: 2 } },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "pump",
            target: { target: 0 },
            power: -5,
            toughness: -5,
            duration: { phase: "end-of-turn" },
        },
    ],
}));

// Surgical Extraction — "({B/P} can be paid with either {B} or 2 life.)
// Choose target card in a graveyard other than a basic land card. Search its
// owner's graveyard, hand, and library for any number of cards with the same
// name as that card and exile them. Then that player shuffles."
// Phyrexian `{B/P}` (CR 107.4f) is paid in the cost system, as Dismember's.
//
// CR 115.1 — the card is a real announced target (a response can remove it),
// restricted by `excludeSupertypes: "Basic"` (CR 205.4a lists basic as a
// supertype; CR 205.4c makes it a land's; no nonland card is basic).
// `{ ownerOf: { target: 0 } }` is the owner of the zone the card was chosen in
// (CR 404.1) and `{ ref: "$target0.name" }` its live name (CR 201.2).
//
// CR 701.23a / 701.23b — "any number" is the searcher's choice in each of the
// three zones, so each leg is a `count.min: 0` choice: the graveyard (which
// includes the targeted card itself), the owner's hand (looked at, as
// searching a hidden zone shows it), and the library. All three picks are made
// before anything is exiled, so the name stays readable. CR 701.24a — the
// owner then shuffles.
//
// hand-tail: Choose target card in a graveyard other than a basic land card. Search its owner's graveyard, hand, and library for any number of cards with the same name as that card and exile them. Then that player shuffles. (#8604)
export const surgicalExtraction = defineCard(() => ({
    id: "dca7e072-edb5-4f7e-bdec-a3a393053c80", // NPH 74
    rarity: "rare",
    name: "Surgical Extraction",
    oracleText:
        "({B/P} can be paid with either {B} or 2 life.)\nChoose target card in a graveyard other than a basic land card. Search its owner's graveyard, hand, and library for any number of cards with the same name as that card and exile them. Then that player shuffles.",
    manaCost: { phyrexian: { B: 1 } },
    types: ["Instant"],
    targetRequirement: {
        type: "card",
        count: 1,
        zone: "graveyard",
        controller: "any",
        excludeSupertypes: "Basic",
    },
    effects: [
        {
            op: "choice",
            kind: "choose-graveyard-card",
            player: "controller",
            zone: "graveyard",
            zoneOwnerId: { ownerOf: { target: 0 } },
            filter: { name: { ref: "$target0.name" } },
            count: { min: 0, max: 999 },
            prompt: "Exile any number of cards with that name from the graveyard",
            bind: "$fromGraveyard",
        },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            zoneOwnerId: { ownerOf: { target: 0 } },
            filter: { name: { ref: "$target0.name" } },
            count: { min: 0, max: 999 },
            prompt: "Exile any number of cards with that name from the hand",
            bind: "$fromHand",
        },
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            zoneOwnerId: { ownerOf: { target: 0 } },
            filter: { name: { ref: "$target0.name" } },
            count: { min: 0, max: 999 },
            prompt: "Search their library and exile any number of copies",
            bind: "$fromLibrary",
        },
        {
            op: "moveZone",
            cards: { ref: "$fromGraveyard" },
            player: { ownerOf: { target: 0 } },
            from: "graveyard",
            to: "exile",
        },
        {
            op: "moveZone",
            cards: { ref: "$fromHand" },
            player: { ownerOf: { target: 0 } },
            from: "hand",
            to: "exile",
        },
        {
            op: "moveZone",
            cards: { ref: "$fromLibrary" },
            player: { ownerOf: { target: 0 } },
            from: "library",
            to: "exile",
        },
        {
            op: "libraryLook",
            action: "shuffle",
            player: { ownerOf: { target: 0 } },
        },
    ],
}));
