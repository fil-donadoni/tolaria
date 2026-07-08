// Dark Ascension (DKA) — blue cards, split by colour per ADR 0043. The
// registry's `import * as dka from "./sets/dka"` resolves through dka/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition } from "../../types";

// Thought Scour — {U} Instant. "Target player mills two cards. Draw a card."
// Authored DSL-first as an Effect Script (ADR 0045, issue #885): the `mill` Op
// (CR 701.17 — move the top library cards to their owner's graveyard, the
// Millstone / peek+move loop) mills the announced target player; then the draw
// (CR 121.1) for the caster.
export const thoughtScour: CardDefinition = {
    id: "88bf1ebb-9d85-4b9b-a614-c7f965c0893d",
    name: "Thought Scour",
    rarity: "common",
    oracleText: "Target player mills two cards.\nDraw a card.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        { op: "mill", player: { target: 0 }, count: 2 },
        { op: "draw", player: "controller", count: 1 },
    ],
};
