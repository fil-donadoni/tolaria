// DSK — red cards, split by colour per ADR 0043. The registry's
// `import * as dsk from "./sets/dsk"` resolves through dsk/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Fear of Missing Out — {1}{R} Enchantment Creature — Nightmare, 2/3.
// "When this creature enters, discard a card, then draw a card."
// Delirium — additional combat phase not yet modeled; attack trigger stubbed.
//
// The ETB discard-then-draw is DSL-expressible via choice + discard + draw.
// The delirium attack trigger ("Whenever this creature attacks for the first
// time each turn, if there are four or more card types among cards in your
// graveyard, untap target creature. After this phase, there is an additional
// combat phase.") requires an additional combat phase system (not yet modeled)
// and is therefore stubbed.
export const fearOfMissingOut: CardDefinition = {
    id: "9d48aaff-46ab-411b-9456-171d4709f951",
    rarity: "rare",
    name: "Fear of Missing Out",
    oracleText:
        "When this creature enters, discard a card, then draw a card.\nDelirium — Whenever this creature attacks for the first time each turn, if there are four or more card types among cards in your graveyard, untap target creature. After this phase, there is an additional combat phase.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment", "Creature"],
    subtypes: ["Nightmare"],
    power: 2,
    toughness: 3,
    effects: [
        {
            op: "choice",
            player: "controller",
            zone: "hand",
            kind: "discard-hand",
            count: 1,
            prompt: "Discard a card",
            bind: "$disc",
        },
        {
            op: "discard",
            player: "controller",
            cards: { ref: "$disc" },
        },
        {
            op: "draw",
            player: "controller",
            count: 1,
        },
    ],
    // TODO (tracked-by: #2494): Delirium attack trigger — "Whenever this
    // creature attacks for the first time each turn, if there are four or
    // more card types among cards in your graveyard, untap target creature.
    // After this phase, there is an additional combat phase." Blocked on:
    // additional combat phase system not modeled.
};

// Silence — {W} Instant. "Your opponents can't cast spells this turn."
//
// FREED 2026-08-25 (#1841 audit): the old marker read "Blocked on:
// spell-cast restriction infrastructure for opponents". That is WRONG at
// HEAD — the `restrictCasting` Op is `status: "implemented"` (CR 601.3a),
// and `player: "opponent"` is exactly the shape Xantid Swarm ships; Orim's
// Chant (`convex/cards/sets/pls/white.ts`) uses the Op today. The card is a
// one-Op Effect Script.
//
// It is ALSO in the wrong file: Silence is not a Duskmourn card. Its
// earliest paper printing is M10 (2009-07-17), reprinted in M11; there is no
// m10 module but m11 exists. Shipping it relocates this note.
// tracked-by: #2761
