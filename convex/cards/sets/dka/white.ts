// dka — white cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Lingering Souls — {2}{W} Sorcery. "Create two 1/1 white Spirit creature
// tokens with flying." with Flashback {1}{B} (CR 702.34 — cast from the
// graveyard for the flashback cost, then exile it). The token creation is a
// plain DSL `createToken` (CR 111 / 707.2) with `count: 2`; the tokens enter
// with flying via `staticAbilities`. Flashback is the engine capability
// (convex/gre/flashback.ts); the `flashback` field carries the alternative,
// off-colour cost — the DKA gold-standard "cast it white, flash it back black".
export const lingeringSouls: CardDefinition = {
    id: "891a92d7-9ccf-4de1-8286-aa5254f27ba9",
    rarity: "uncommon",
    name: "Lingering Souls",
    oracleText:
        "Create two 1/1 white Spirit creature tokens with flying.\nFlashback {1}{B}",
    manaCost: { X: 2, W: 1 },
    types: ["Sorcery"],
    flashback: { X: 1, B: 1 },
    effects: [
        {
            op: "createToken",
            controller: "controller",
            count: 2,
            token: {
                name: "Spirit",
                types: ["Creature"],
                subtypes: ["Spirit"],
                power: 1,
                toughness: 1,
                colors: ["W"],
                staticAbilities: ["flying"],
            },
        },
    ],
};
