// Fallen Empires (FEM) — the 1994 faction-war expansion (102 unique cards, 187
// prints across its famous multi-art commons). This file follows the
// established set-file pattern (ADR 0014): every in-scope card is a new
// `CardDefinition` (FEM has zero reprints of already-implemented cards), and
// FEM's signature multi-artwork commons ship as ONE shared `CardDefinition`
// plus one `CardPrint` per additional artwork — all `setCode: "fem"`, all
// resolving to the single definition (mechanics come from the one def).
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical names /
// costs / P/T / subtypes are sourced from Scryfall `set:fem` (modern Oracle).
//
// THIS slice is the walking skeleton (#567): it registers the `fem` set and
// wires one thin end-to-end tracer — Vodalian Soldiers ({1}{U} 1/2 vanilla
// Merfolk Soldier) — together with its three alternate-art FEM prints. It
// proves the set file, the registry entry, the multi-art `CardPrint` plumbing,
// pool/deck availability, projection, and the test harness all work before the
// six thematic faction clusters land (see PRD #566).
//
// Generic mana is encoded as `X: n` (e.g. {1}{U} → { X: 1, U: 1 }).

import type { CardDefinition, CardPrint } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla creatures (CR 302 — Creature cards with no rules text are pure data:
// types/subtypes + P/T only; they resolve from the stack onto the battlefield
// via the generic permanent-resolution path, CR 608.3).
// ─────────────────────────────────────────────────────────────────────────────

// Vodalian Soldiers — {1}{U} 1/2 vanilla Merfolk Soldier. FEM printed it with
// four distinct artworks (collector numbers 31a–31d). The canonical
// `CardDefinition` uses the 31a print's Scryfall UUID as its id; the remaining
// three artworks are `CardPrint` entries below, all resolving to this one def.
export const vodalianSoldiers: CardDefinition = {
    id: "7eb50256-9113-4b03-bcef-9aea24be8493", // FEM 31a (canonical art)
    rarity: "common",
    name: "Vodalian Soldiers",
    oracleText: "",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Soldier"],
    power: 1,
    toughness: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// Multi-art prints (ADR 0014). Each additional FEM artwork is a `CardPrint`
// resolving to the shared definition above. The registry maps every `printId`
// to the same `CardDefinition`, so a deck/instance referencing any artwork gets
// the identical mechanics while rendering the chosen art (the instance keeps
// `card.id === printId`).
// ─────────────────────────────────────────────────────────────────────────────

export const vodalianSoldiersFemB: CardPrint = {
    printId: "bc85a68c-14d6-4447-a894-0e48d1662bc3", // FEM 31b
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};

export const vodalianSoldiersFemC: CardPrint = {
    printId: "d8d1ceac-bb75-4c46-9ab4-1ef623ed3027", // FEM 31c
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};

export const vodalianSoldiersFemD: CardPrint = {
    printId: "99d22f83-1171-4b5c-8a72-956db26d7c60", // FEM 31d
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};
