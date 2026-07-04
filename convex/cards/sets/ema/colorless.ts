// ema (Eternal Masters) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { makeTapForMana } from "../../abilities";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Mana Crypt — "At the beginning of your upkeep, flip a coin. If you lose
// the flip, this artifact deals 3 damage to you.\n{T}: Add {C}{C}." The
// upkeep trigger composes the shipped `coinFlip` Op (issue #851) with the
// `phaseTrigger` factory (CR 603.6a "at the beginning of your upkeep",
// CR 705.2 coin flip). Vintage Cube free tranche (issue #675, ADR 0041).
export const manaCrypt: CardDefinition = {
    id: "0cb33b46-4d1b-4f97-bfdc-d815aee111da",
    rarity: "mythic",
    name: "Mana Crypt",
    oracleText:
        "At the beginning of your upkeep, flip a coin. If you lose the flip, this artifact deals 3 damage to you.\n{T}: Add {C}{C}.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        makeTapForMana({
            id: "mana-crypt-mana",
            oracleText: "{T}: Add {C}{C}.",
            produces: { C: 2 },
        }),
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "mana-crypt-upkeep-flip",
            oracleText:
                "At the beginning of your upkeep, flip a coin. If you lose the flip, this artifact deals 3 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "coinFlip",
                    win: { consequence: "Nothing happens", effects: [] },
                    loss: {
                        consequence: "Mana Crypt deals 3 damage to you",
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 3,
                                to: { player: "controller" },
                            },
                        ],
                    },
                },
            ],
        }),
    ],
};
