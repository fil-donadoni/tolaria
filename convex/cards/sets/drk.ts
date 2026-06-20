// The Dark (DRK) — the next chronological expansion after Legends (119 unique
// cards). This file follows the established set-file pattern (ADR 0014): every
// in-scope card is a new `CardDefinition`. The Dark has zero reprints of
// already-implemented cards, so the file is effectively 100% new definitions,
// mirroring `leg.ts` / `arn.ts`. Modern Scryfall oracle text is authoritative
// (ADR 0004); canonical names / costs / P/T are sourced from MTGJSON
// `data/json/DRK.json`.
//
// THIS slice is the walking skeleton (#410): it registers the `drk` set and
// wires one thin end-to-end tracer — three vanilla creatures (Squire,
// Goblin Hero, Scarwood Goblins) that are playable from the card pool through a
// preset scenario. It proves the set file, the registry entry, the pool/deck
// availability, projection, and the test harness all work before the bulk free
// tranche and the 9 feature clusters land (see PRD #409).
//
// Generic mana is encoded as `X: n` (e.g. {2}{R} → { X: 2, R: 1 }).

import type { CardDefinition } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla creatures (CR 302 — Creature cards with no rules text are pure data:
// types/subtypes + P/T only; they resolve from the stack onto the battlefield
// via the generic permanent-resolution path, CR 608.3).
// ─────────────────────────────────────────────────────────────────────────────

export const squire: CardDefinition = {
    id: "aa6cdcc7-f5ea-47bf-9448-1c63e36b18d1",
    name: "Squire",
    oracleText: "",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 2,
};

export const goblinHero: CardDefinition = {
    id: "ee969637-a20e-4163-97c0-9fd5cb17b741",
    name: "Goblin Hero",
    oracleText: "",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
};

export const scarwoodGoblins: CardDefinition = {
    id: "5314e57b-107c-4478-9cdb-51d1732f9468",
    name: "Scarwood Goblins",
    oracleText: "",
    manaCost: { R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
};
