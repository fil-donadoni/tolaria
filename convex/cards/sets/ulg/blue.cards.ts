// Urza's Legacy (ULG) — blue cards, split by colour per ADR 0043. The
// registry's `import * as ulg from "./sets/ulg/index.cards"` re-exports this module.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import { defineCard } from "../../types";

// Frantic Search — {2}{U} Instant. "Draw two cards, then discard two cards.
// Untap up to three lands." (CR 121.1 draw, CR 701.9 discard, CR 701.26
// untap.) DSL Effect Script (ADR 0045): `draw` runs first (the hand always
// grows by 2 before the discard pick, so the fixed `count: 2` on the
// following `choose-hand-card` choice never over-asks), then a `choice(
// choose-hand-card)` + `discard` looter pair (the shipped Vodalian Merchant
// template, inv/blue.cards.ts), then a `choice(choose-permanents, zone:
// "battlefield", filter: { type: "Land" }, allControllers: true)` picks up to
// three lands — ANY player's, since the Oracle prints no "you control"
// (CR 109.2), the same reading Time Spiral's "untap up to six lands" takes
// (usg/blue.cards.ts) — and a `forEach { set: "bound" }`
// over that PICKS binding untaps each pick (`tapUntap`, CR 701.26). Was
// `resolveSteps` until issue #1284 widened `forEach { set: "bound" }`'s
// validator to accept a `choice` Op's picks binding directly (previously
// LIST-family only, ADR 0049) — the runtime binding store
// (`readBinding`/`recallChoice`) was always shape-identical for both
// families; only the static validator was restrictive.
export const franticSearch = defineCard(() => ({
    id: "1904db14-6df7-424f-afa5-e3dfab31300a",
    name: "Frantic Search",
    rarity: "common",
    oracleText:
        "Draw two cards, then discard two cards. Untap up to three lands.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    effects: [
        { op: "draw", player: "controller", count: 2 },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            count: 2,
            prompt: "Discard two cards (Frantic Search).",
            bind: "$discards",
        },
        {
            op: "discard",
            player: "controller",
            cards: { ref: "$discards" },
        },
        {
            op: "choice",
            kind: "choose-permanents",
            player: "controller",
            zone: "battlefield",
            allControllers: true,
            filter: { type: "Land" },
            count: { min: 0, max: 3 },
            prompt: "Untap up to three lands (Frantic Search).",
            bind: "$lands",
        },
        {
            op: "forEach",
            select: { set: "bound", ref: "$lands" },
            effects: [
                { op: "tapUntap", action: "untap", target: { ref: "$each" } },
            ],
        },
    ],
}));

// Tinker — {2}{U} Sorcery. "As an additional cost to cast this spell,
// sacrifice an artifact. Search your library for an artifact card, put that
// card onto the battlefield, then shuffle." (CR 118.8 additional cost /
// 701.23 / 400.7 / 701.24.) The additional cost reuses
// `additionalCosts.sacrificeFilter` (a plain `PermanentFilter`); the search
// is an unrestricted-by-value type filter (`type: "Artifact"`) straight to
// the battlefield.
export const tinker = defineCard(() => ({
    id: "7da23b15-dfb8-4267-9b33-d7a4c035c434",
    name: "Tinker",
    rarity: "uncommon",
    manaCost: { X: 2, U: 1 },
    types: ["Sorcery"],
    oracleText:
        "As an additional cost to cast this spell, sacrifice an artifact.\nSearch your library for an artifact card, put that card onto the battlefield, then shuffle.",
    additionalCosts: {
        sacrificeFilter: { types: "Artifact" },
    },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { type: "Artifact" },
            // CR 701.23b — a stated quality never compels the find.
            count: { min: 0, max: 1 },
            prompt: "Search your library for an artifact card.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "battlefield",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
}));
