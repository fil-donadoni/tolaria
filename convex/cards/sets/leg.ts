// Legends (LEG) — the game's first multicolor, "legendary matters" set (310
// unique cards). This file follows the established set-file pattern (ADR 0014):
// every in-scope card is either a new `CardDefinition` (Legends has no reprints
// of already-implemented cards, so it is effectively 100% new definitions) or,
// where it reprints an implemented card, a thin `CardPrint` stub. Modern
// Scryfall oracle text is authoritative (ADR 0004); canonical names / costs /
// P/T are sourced from MTGJSON `data/json/LEG.json`.
//
// THIS slice is the walking skeleton (#370): it registers the `leg` set and
// wires one thin end-to-end tracer — a pair of vanilla legendary creatures that
// carry the `Legendary` supertype as data and are playable from the card pool
// through a preset scenario. It proves the set file, the registry entry, the
// pool/deck availability, projection, and the test harness all work before the
// bulk free tranche and the 9 feature clusters land (see PRD #369).
//
// Generic mana is encoded as `X: n` (e.g. {3}{G}{W} → { X: 3, G: 1, W: 1 }).
//
// Out of scope for the whole set (per #369): Rebirth and Tempest Efreet (ante,
// ADR 0010). They stay absent so "Legends complete" means complete minus those
// two named exclusions. The remaining cards land in later batches.

import type { CardDefinition } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla legendary creatures (CR 205.4a — Legendary supertype; CR 704.5j legend
// rule lands as an SBA in cluster C1, #369. A legendary vanilla creature is
// playable before that SBA ships and fully correct after — legendary-ness does
// not gate the card's release.)
// ─────────────────────────────────────────────────────────────────────────────

export const jasmineBoreal: CardDefinition = {
    id: "db6ef678-4ce9-48d6-aa4f-2afd9a1ad724",
    name: "Jasmine Boreal",
    oracleText: "",
    manaCost: { X: 3, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human"],
    power: 4,
    toughness: 5,
};

export const ladyOrca: CardDefinition = {
    id: "b2779553-74eb-42ba-97d0-96269f48c269",
    name: "Lady Orca",
    oracleText: "",
    manaCost: { X: 5, B: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Demon"],
    power: 7,
    toughness: 4,
};
