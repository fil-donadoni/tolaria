// SOS (Secrets of Strixhaven) — green cards, split by colour per ADR 0043. The
// registry's `import * as sos from "./sets/sos/index.cards"` resolves through
// sos/index.cards.ts. Cards are classified by the colour identity of their mana
// cost (CR 202.2): lands and colourless artifacts (no coloured cost) live in
// colorless.ts.

import { defineCard } from "../../types";

// Vastlands Scavenger // Bind to Life is one card (CR 722.2c): the prepare
// spell is declared on `insetSpell` with `kind: "prepare"`, and "This creature
// enters prepared" is `entersPrepared` (CR 722.3a), as on Skycoach Conductor
// (`blue.cards.ts`).
//
// Bind to Life is `mill` binding the cards it milled, then a mandatory pick of
// a creature card from among THEM (the `$milled` bound set, not the whole
// graveyard — CR 701.17a, a card milled earlier is not "among them"), then a
// graveyard → battlefield `moveZone` of the pick. No creature milled = empty
// candidate set = the `choice` binds nothing and the move skips (CR 608.2d).
export const vastlandsScavenger = defineCard(() => ({
    id: "91db5c3d-45ab-440f-8568-a2837aee1fca",
    rarity: "rare",
    name: "Vastlands Scavenger",
    oracleText:
        "Deathtouch\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Bear", "Druid"],
    power: 4,
    toughness: 4,
    staticAbilities: ["deathtouch"],
    entersPrepared: true,
    insetSpell: {
        kind: "prepare",
        name: "Bind to Life",
        manaCost: { X: 4, G: 1 },
        types: ["Instant"],
        oracleText:
            "Mill seven cards. Then put a creature card from among them onto the battlefield.",
        effects: [
            {
                op: "mill",
                player: "controller",
                count: 7,
                bindAll: "$milled1",
            },
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: "controller",
                zone: "graveyard",
                candidates: [{ ref: "$milled1" }],
                filter: { type: "Creature" },
                count: 1,
                prompt: "Put a creature card from among the milled cards onto the battlefield.",
                bind: "$chosen",
            },
            {
                op: "moveZone",
                cards: { ref: "$chosen" },
                player: "controller",
                from: "graveyard",
                to: "battlefield",
            },
        ],
    },
}));
