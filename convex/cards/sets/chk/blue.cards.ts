// chk — blue cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import { defineCard } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Honden of Seeing Winds — "At the beginning of your upkeep, draw a card for
// each Shrine you control." DSL-only TRIGGERED ability (ADR 0045, issue #803):
// the effect is a declarative Effect Script executed by the interpreter through
// the SAME code path as spell-site scripts. The "for each Shrine" is the frozen
// `count` construct (CR 122) — a battlefield count of the controller's Shrines
// (the Honden itself is a Shrine, CR 205.3, so it counts) — feeding the `draw`
// Op's count (CR 121.1). `scope: "your"` makes the trigger's controller the
// upkeep player, so the script's `player: "controller"` is exactly "you"
// (CR 603.6a).
export const hondenOfSeeingWinds = defineCard(() => ({
    id: "ad732186-eeb9-4edb-a17a-51f8bac71802",
    rarity: "uncommon",
    name: "Honden of Seeing Winds",
    oracleText:
        "At the beginning of your upkeep, draw a card for each Shrine you control.",
    manaCost: { X: 4, U: 1 },
    types: ["Enchantment"],
    supertypes: ["Legendary"],
    subtypes: ["Shrine"],
    triggeredAbilities: [
        phaseTrigger({
            id: "honden-of-seeing-winds-upkeep",
            oracleText:
                "At the beginning of your upkeep, draw a card for each Shrine you control.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "draw",
                    player: "controller",
                    count: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { subtype: "Shrine" },
                        },
                    },
                },
            ],
        }),
    ],
}));

// Gifts Ungiven — {3}{U} Instant. "Search your library for up to four cards
// with different names and reveal them. Target opponent chooses two of those
// cards. Put the chosen cards into your graveyard and the rest into your hand.
// Then shuffle."
//
// Intuition's shape (search -> reveal -> the target opponent picks from the
// revealed pile -> split -> shuffle) with the one new thing: the search's
// description is on the SET. `distinctBy: "name"` (CR 701.23a, issue #6475)
// makes the found cards pairwise distinct by name, and `count: { min: 0,
// max: 4 }` is a ceiling because the zone is hidden and the searcher may find
// fewer (CR 701.23b). The opponent's pick of two clamps to however many were
// found; the picks go to the graveyard, and the rest — still in the library
// after the first `moveZone` — go to hand.
//
// The compiler reads the line to this same definition
// (`search-reveal-pile-pick`, issues #5254 and #6475).
export const giftsUngiven = defineCard(() => ({
    id: "cc950b6c-0346-4939-b36b-9f10a75f7a32",
    rarity: "rare",
    name: "Gifts Ungiven",
    oracleText:
        "Search your library for up to four cards with different names and reveal them. Target opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest into your hand. Then shuffle.",
    manaCost: { X: 3, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            count: { min: 0, max: 4 },
            distinctBy: "name",
            prompt: "Search your library for up to four cards with different names.",
            bind: "$found1",
        },
        { op: "reveal", player: "controller", cards: { ref: "$found1" } },
        {
            op: "choice",
            kind: "choose-library-card",
            player: { target: 0 },
            zoneOwnerId: "controller",
            zone: "library",
            candidates: [{ ref: "$found1" }],
            count: 2,
            prompt: "Choose two of the revealed cards. Its owner puts the chosen cards into their graveyard and the rest into their hand.",
            bind: "$picked2",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked2" },
            player: "controller",
            from: "library",
            to: "graveyard",
        },
        {
            op: "moveZone",
            cards: { ref: "$found1" },
            player: "controller",
            from: "library",
            to: "hand",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
}));
