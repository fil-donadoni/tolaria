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
// restricted by `excludeSupertypes: "Basic"` (CR 205.4a: only lands are basic,
// so "other than a basic land card" is exactly "not basic"). The first Op
// exiles the target and snapshots it (`bind`, CR 608.2h last-known
// information) BEFORE it leaves: the owner is the graveyard's owner (CR 108.3 /
// 404.1), which no live ref can name once the card is gone, and its name keys
// the rest of the sweep (CR 201.2). The target is itself one of the same-named
// cards to exile.
//
// CR 701.23a — the library leg is an explicit `search-library` choice so the
// searcher looks at the owner's library, as Lobotomy's does (`count.min: 0`:
// CR 701.23b, the searcher is never compelled to find a card). The graveyard
// and hand legs sweep every same-named card in one filtered pass. CR 701.24a —
// the shuffle ends the instruction.
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
            op: "moveZone",
            target: { target: 0 },
            to: "exile",
            bind: "$t",
        },
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            zoneOwnerId: { ref: "$t.owner" },
            filter: { name: { ref: "$t.name" } },
            count: { min: 0, max: 999 },
            prompt: "Search their library and exile every copy",
            bind: "$fromLibrary",
        },
        {
            op: "moveZone",
            cards: { ref: "$fromLibrary" },
            player: { ref: "$t.owner" },
            from: "library",
            to: "exile",
        },
        {
            op: "moveZone",
            player: { ref: "$t.owner" },
            fromZones: ["graveyard", "hand"],
            filter: { name: { ref: "$t.name" } },
            to: "exile",
        },
        {
            op: "libraryLook",
            action: "shuffle",
            player: { ref: "$t.owner" },
        },
    ],
}));
