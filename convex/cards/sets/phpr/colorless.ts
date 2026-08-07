// PHPR (HarperPrism Book Promos) — colorless cards, split by colour per ADR
// 0043. The registry's `import * as phpr from "./sets/phpr"` resolves
// through phpr/index.ts. Lands and colourless artifacts (no coloured cost)
// live here per the colour-split convention.

import type { CardDefinition } from "../../types";

// Mana Crypt — {0} Artifact. "At the beginning of your upkeep, flip a coin.
// If you lose the flip, Mana Crypt deals 3 damage to you.\n{T}: Add {C}{C}."
// (CR 705 coin flip via the shipped `coinFlip` Op, #851; the {T} mana ability
// is trivial, useStack:false CR 605.3a.) The upkeep clause's WIN branch does
// nothing at all — "if you LOSE, deal 3 damage", nothing on a win — which
// `isCoinFlipBranch` could not express until issue #1367 relaxed the branch
// contract to accept `effects: []` (a deliberate no-op branch, documented on
// `EffectCoinFlipBranch`). Tracer card for that relaxation.
//
// Home set = earliest paper printing (ADR 0041) = HarperPrism Book Promos
// (a 1994 promotional insert bundled with the novel "Arena" — Scryfall's own
// `reprint` flag confirms it, not the more familiar Eternal Masters print).
// It was first drafted against the EMA reprint; that printing now rides
// along as a `CardPrint` in `ema/colorless.ts`.
export const manaCrypt: CardDefinition = {
    id: "160cf235-6463-4e16-a426-8b5be76b10d2", // PHPR
    name: "Mana Crypt",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, flip a coin. If you lose the flip, Mana Crypt deals 3 damage to you.\n{T}: Add {C}{C}.",
    manaCost: { X: 0 },
    types: ["Artifact"],
    triggeredAbilities: [
        {
            id: "mana-crypt-upkeep-flip",
            oracleText:
                "At the beginning of your upkeep, flip a coin. If you lose the flip, Mana Crypt deals 3 damage to you.",
            event: "PHASE_BEGIN",
            matches: (event, self) =>
                event.type === "PHASE_BEGIN" &&
                event.phase === "UPKEEP" &&
                event.activePlayerId === self.controllerId,
            effects: [
                {
                    op: "coinFlip",
                    win: {
                        consequence: "Nothing happens.",
                        effects: [],
                    },
                    loss: {
                        consequence: "Mana Crypt deals 3 damage to you.",
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
        },
    ],
    activatedAbilities: [
        {
            id: "mana-crypt-mana",
            oracleText: "{T}: Add {C}{C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 2 }),
            manaProduced: { C: 2 },
        },
    ],
};
