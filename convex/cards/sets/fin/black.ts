// FIN — black cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Dark Confidant — {1}{B} Creature, Vintage Cube residue (issue #1302, parent
// PRD #620). "At the beginning of your upkeep, reveal the top card of your
// library and put that card into your hand. You lose life equal to its mana
// value." (CR 401.4 look/reveal + CR 202.3 mana value.) DSL-first: mirrors
// Reviving Vapors' shipped `digToHand` + manaValue-of-`bind` pattern
// (inv/multicolor.ts, issue #1101) exactly — `digToHand` with `look: 1,
// take: 1` looks at (and puts into hand) the single top card with no real
// leftover-distribution choice, snapshot-binds it, and the trailing
// `loseLife` reads `manaValue: { of: { ref: "$revealed" } } }` to size the
// life loss off that card's mana value (CR 202.3b — an {X} in a library
// card's cost counts as 0, per the card's own ruling). Both Ops are already
// exercised by the interpreter suite (digToHand+bind, issue #1101;
// loseLife+manaValue-of-ref, Reanimate) — no hand-written per-card test
// required (per-Op test regime, gre-development.md).
export const darkConfidant: CardDefinition = {
    id: "2520ab23-a068-4462-b261-2754409b4108",
    name: "Dark Confidant",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 1,
    triggeredAbilities: [
        phaseTrigger({
            id: "dark-confidant-upkeep",
            oracleText:
                "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "digToHand",
                    player: "controller",
                    look: 1,
                    take: 1,
                    bind: "$revealed",
                },
                {
                    op: "loseLife",
                    player: "controller",
                    amount: { manaValue: { of: { ref: "$revealed" } } },
                },
            ],
        }),
    ],
};
