// stx — blue cards (ADR 0043 colour split).
import { defineCard } from "../../types";

// Test of Talents — {1}{U} Instant. "Counter target instant or sorcery spell.
// Search its controller's graveyard, hand, and library for any number of cards
// with the same name as that spell and exile them. That player shuffles, then
// draws a card for each card exiled from their hand this way."
//
// CR 701.6a — the counter; `bind` snapshots the spell's name and controller
// first (CR 608.2h), because both are unreadable once it has left the stack.
// CR 701.23a / 701.23b — "any number" is the searcher's choice in each zone,
// so each leg is a `count.min: 0` choice (the hand is looked at, as searching
// a hidden zone shows it); the graveyard leg runs AFTER the counter, so it
// includes the countered spell itself. CR 701.24a — the controller shuffles,
// then draws one card per card exiled from hand (`setSize` of that pick).
//
// hand-tail: Counter target instant or sorcery spell. Search its controller's graveyard, hand, and library for any number of cards with the same name as that spell and exile them. That player shuffles, then draws a card for each card exiled from their hand this way. (#8637)
export const testOfTalents = defineCard(() => ({
    id: "6e2b6236-b40c-430c-98b0-7940b942657a", // STX 59
    rarity: "uncommon",
    name: "Test of Talents",
    oracleText:
        "Counter target instant or sorcery spell. Search its controller's graveyard, hand, and library for any number of cards with the same name as that spell and exile them. That player shuffles, then draws a card for each card exiled from their hand this way.",
    manaCost: { generic: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: ["Instant", "Sorcery"],
    },
    effects: [
        {
            op: "counter",
            target: { target: 0 },
            bind: "$countered",
        },
        {
            op: "choice",
            kind: "choose-graveyard-card",
            player: "controller",
            zone: "graveyard",
            zoneOwnerId: { ref: "$countered.controller" },
            filter: { name: { ref: "$countered.name" } },
            count: { min: 0, max: 999 },
            prompt: "Exile any number of cards with that name from the graveyard",
            bind: "$fromGraveyard",
        },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            zoneOwnerId: { ref: "$countered.controller" },
            filter: { name: { ref: "$countered.name" } },
            count: { min: 0, max: 999 },
            prompt: "Exile any number of cards with that name from the hand",
            bind: "$fromHand",
        },
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            zoneOwnerId: { ref: "$countered.controller" },
            filter: { name: { ref: "$countered.name" } },
            count: { min: 0, max: 999 },
            prompt: "Search their library and exile any number of copies",
            bind: "$fromLibrary",
        },
        {
            op: "moveZone",
            cards: { ref: "$fromGraveyard" },
            player: { ref: "$countered.controller" },
            from: "graveyard",
            to: "exile",
        },
        {
            op: "moveZone",
            cards: { ref: "$fromHand" },
            player: { ref: "$countered.controller" },
            from: "hand",
            to: "exile",
        },
        {
            op: "moveZone",
            cards: { ref: "$fromLibrary" },
            player: { ref: "$countered.controller" },
            from: "library",
            to: "exile",
        },
        {
            op: "libraryLook",
            action: "shuffle",
            player: { ref: "$countered.controller" },
        },
        {
            op: "draw",
            player: { ref: "$countered.controller" },
            count: { setSize: { of: { ref: "$fromHand" } } },
        },
    ],
}));
