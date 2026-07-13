// MH3 — black cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { EFFECT_AFFECTS_SELF } from "../../types";

// Nethergoyf — {B} Creature — Lhurgoyf, printed */1+*.
// "Nethergoyf's power is equal to the number of card types among cards in your
//  graveyard and its toughness is equal to that number plus 1." (CR 604.3 /
//  613.4c CDA P/T, layer 7a — a `pt-cda` whose `compute` counts DISTINCT card
//  types among the controller's graveyard, printed 0/0 base as the CDA target.)
// "Escape—{2}{B}, Exile any number of other cards from your graveyard with four
//  or more card types among them." (CR 702.138 — the escape capability, engine
//  infra; the variable "any number … with N+ card types" exile cost is the
//  `minCardTypes` picker mode. No on-resolution DSL effect — the card simply
//  enters as a creature.)
export const nethergoyf: CardDefinition = {
    id: "3ee3945e-5089-4751-b7b3-5961c39d2a33",
    name: "Nethergoyf",
    rarity: "mythic",
    oracleText:
        "Nethergoyf's power is equal to the number of card types among cards in your graveyard and its toughness is equal to that number plus 1.\nEscape—{2}{B}, Exile any number of other cards from your graveyard with four or more card types among them. (You may cast this card from your graveyard for its escape cost.)",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Lhurgoyf"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            // CR 604.3 — power = distinct card types among cards in the
            // controller's OWN graveyard; toughness = that + 1.
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                // "your graveyard" — the graveyard of Nethergoyf's controller,
                // identified as the player whose battlefield holds the source
                // (the state view's players carry no id).
                const types = new Set<string>();
                const controller = state.players.find((p) =>
                    p.battlefield.some((b) => b.id === source.id)
                );
                if (controller) {
                    for (const c of controller.graveyard) {
                        for (const t of c.types) types.add(t);
                    }
                }
                const n = types.size;
                return { power: n, toughness: n + 1 };
            },
        },
    ],
    // CR 702.138 — Escape. Variable exile cost: any number of OTHER graveyard
    // cards with 4+ card types among them (the `minCardTypes` picker mode).
    escape: { mana: { X: 2, B: 1 }, exile: { minCardTypes: 4 } },
};
