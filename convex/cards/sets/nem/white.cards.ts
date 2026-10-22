// NEM — white cards, split by colour per ADR 0043. The registry's
// `import * as nem from "./sets/nem/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

// Parallax Wave — "Fading 5 (…) Remove a fade counter from this enchantment:
// Exile target creature. When this enchantment leaves the battlefield, each
// player returns to the battlefield all cards they own exiled with it."
// (CR 702.32 Fading; CR 701.13 exile; CR 607.2a linked abilities.)
//
// Fading 5 is expanded implicitly at the getDefinition seam (ADR 0054): the
// "fading 5" string injects `entersWith` five fade counters + the upkeep
// remove-or-sacrifice trigger. The repeatable exile mode spends those same fade
// counters as an activation cost (`cost.removeCounter`), racing the fading
// clock — every exile brings the sacrifice one upkeep closer.
//
// DSL-first (ADR 0045): the exile and the return are two LINKED abilities with
// no duration (CR 607.2a), not an O-Ring "until" exile (CR 610.3): the
// activated `exile` stamps its card with this source (`linkToSource`), and the
// leaves trigger returns every stamped card, each under its owner's control,
// as one event. An exile that resolves after the Wave has left still exiles —
// and nothing returns that card.
const PARALLAX_WAVE_ID = "cef789e8-e4cc-4f61-bc15-debc2487777f"; // NEM 17
export const parallaxWave = defineCard(() => ({
    id: PARALLAX_WAVE_ID,
    name: "Parallax Wave",
    rarity: "rare",
    oracleText:
        "Fading 5 (This enchantment enters with five fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)\nRemove a fade counter from this enchantment: Exile target creature.\nWhen this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    staticAbilities: ["fading 5"],
    activatedAbilities: [
        {
            id: "parallax-wave-exile",
            oracleText:
                "Remove a fade counter from this enchantment: Exile target creature.",
            cost: { removeCounter: { type: "fade", count: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // CR 607.2a — the linked exile instruction.
            effects: [
                { op: "exile", target: { target: 0 }, linkToSource: true },
            ],
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            // CR 607.2a + CR 110.2a — every card exiled with this returns,
            // each put onto the battlefield by (so under) its owner.
            id: "parallax-wave-return",
            oracleText:
                "When this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.",
            scope: "self",
            effects: [
                {
                    op: "forEach",
                    select: { set: "exiledWithSource" },
                    simultaneous: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            from: "exile",
                            to: "battlefield",
                        },
                    ],
                },
            ],
        }),
    ],
}));
