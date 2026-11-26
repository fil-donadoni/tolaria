// Aetherdrift (DFT) — blue cards, split by colour per ADR 0043. The registry's
// `import * as dft from "./sets/dft/index.cards"` re-exports this module. Modern
// Scryfall oracle text is authoritative (ADR 0004).
import { defineCard } from "../../types";

// Stock Up — {2}{U} Sorcery. "Look at the top five cards of your library. Put
// two of them into your hand and the rest on the bottom of your library in any
// order." (CR 401.4 look.) The already-censused `lookDistribute` Op (issue #984)
// with look 5 / take 2: it reveals the top five (projected face-up as
// `libraryPeek` — never the whole library, the `search-library` over-exposure),
// drives the unified HAND/BOTTOM pick (two to hand), bottoms the rest in the
// player's chosen order (CR 401.4 "in any order" is a real choice — ADR 0026)
// and marks those bottomed cards known to the controller.
export const stockUp = defineCard(() => ({
    id: "0a786855-6eb4-42c0-a528-4842db46809d",
    name: "Stock Up",
    rarity: "rare",
    oracleText:
        "Look at the top five cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.",
    manaCost: { X: 2, U: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "lookDistribute",
            keepTo: "hand",
            player: "controller",
            look: 5,
            take: 2,
        },
    ],
}));

// Mindspring Merfolk — {U} Creature — Merfolk Wizard 1/1. "Exhaust — {X}{U}{U},
// {T}: Draw X cards. Put a +1/+1 counter on each Merfolk creature you control."
// CR 702.177a: the `exhaust` gate makes the ability "Activate only once"; CR
// 107.3k: the X in its activation cost is chosen for this activation alone and
// read back by `draw`'s `{ X: true }` count. CR 122.1a: the mass +1/+1 counter
// placement is `forEach` over the Merfolk creatures its controller controls on
// resolution.
// hand-tail: Exhaust — {X}{U}{U}, {T}: Draw X cards. Put a +1/+1 counter on each Merfolk creature you control. (#10510)
export const mindspringMerfolk = defineCard(() => ({
    id: "b6250b8b-1943-445f-ada9-30b41eb6d29b",
    name: "Mindspring Merfolk",
    rarity: "rare",
    oracleText:
        "Exhaust — {X}{U}{U}, {T}: Draw X cards. Put a +1/+1 counter on each Merfolk creature you control. (Activate each exhaust ability only once.)",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "mindspring-merfolk-ability",
            oracleText:
                "Exhaust — {X}{U}{U}, {T}: Draw X cards. Put a +1/+1 counter on each Merfolk creature you control.",
            cost: { mana: { X: "X", U: 2 }, tap: true },
            useStack: true,
            exhaust: true,
            effects: [
                { op: "draw", player: "controller", count: { X: true } },
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature", subtype: "Merfolk" },
                    },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$each" },
                            count: 1,
                        },
                    ],
                },
            ],
        },
    ],
}));
