// CNS (Conspiracy) — multicolor cards, split by colour per ADR 0043. The
// registry's `import * as cns from "./sets/cns"` resolves through cns/index.ts.

import type { CardDefinition } from "../../types";
import { DACK_FAYDEN_EMBLEM_ID } from "../../emblems";

// Dack Fayden — {1}{U}{R} Legendary Planeswalker — Dack, loyalty 3
// (issues #2360 / #1571, ADR 0058 loyalty framework). CNS is the home set:
// Conspiracy (2014-06-06) is the earliest paper printing (ADR 0041).
//
//   • +1 — "Target player draws two cards, then discards two cards." CR 608.2
//     sequencing: the whole draw happens before the discard, so the two fresh
//     cards are discardable. The discard is MANDATORY and the discarding player
//     picks (CR 701.9b), which is the `choice(discard-hand)` + `discard` pair
//     Urza's Guilt (pls/multicolor.ts) already exercises — here scoped to the
//     announced target player (CR 115.1) instead of a `forEach` over players.
//   • −2 — "Gain control of target artifact." `gainControl` with no `duration`
//     is the INDEFINITE layer-2 reassignment (CR 613.1b) — it never reverts.
//   • −6 — the emblem (CR 114.1). The trigger seam, the CR 603.2c one-vs-N
//     reasoning and the deliberate divergence (tracked-by: #2785) are documented in full on the
//     emblem definition itself (`convex/cards/emblems.ts`,
//     `DACK_FAYDEN_EMBLEM_ID`).
export const dackFayden: CardDefinition = {
    id: "3fcb7810-1054-4001-855c-6e17939b3d3f", // CNS printing (scryfallId)
    name: "Dack Fayden",
    rarity: "mythic",
    manaCost: { generic: 1, U: 1, R: 1 },
    types: ["Planeswalker"],
    subtypes: ["Dack"],
    supertypes: ["Legendary"],
    loyalty: 3,
    oracleText:
        '+1: Target player draws two cards, then discards two cards.\n−2: Gain control of target artifact.\n−6: You get an emblem with "Whenever you cast a spell that targets one or more permanents, gain control of those permanents."',
    activatedAbilities: [
        {
            id: "dack-fayden-plus1",
            // CR 606.2 / 606.4 — loyalty ability; `+1` adds one counter.
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                "+1: Target player draws two cards, then discards two cards.",
            // CR 115.1 — "target player" is any player, the controller included.
            targetRequirement: { type: "player", count: 1 },
            effects: [
                { op: "draw", player: { target: 0 }, count: 2 },
                {
                    // CR 701.9b — the DISCARDING player chooses which cards go.
                    // A plain numeric `count` is an exact count the submit path
                    // enforces as floor and ceiling, clamped down to the hand
                    // actually held (a range would let them submit `[]`).
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 2,
                    prompt: "Dack Fayden: discard two cards.",
                    bind: "$dackDiscard",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$dackDiscard" },
                },
            ],
        },
        {
            id: "dack-fayden-minus2",
            // CR 606.2 / 606.4 — `-2` removes two counters.
            cost: { loyalty: -2 },
            useStack: true,
            oracleText: "−2: Gain control of target artifact.",
            targetRequirement: { type: "Artifact", count: 1 },
            // CR 613.1b — indefinite layer-2 control change (no `duration`).
            effects: [
                {
                    op: "gainControl",
                    target: { target: 0 },
                    controller: "controller",
                },
            ],
        },
        {
            id: "dack-fayden-minus6",
            // CR 606.2 / 606.4 — `-6` removes six counters (the ultimate).
            cost: { loyalty: -6 },
            useStack: true,
            oracleText:
                '−6: You get an emblem with "Whenever you cast a spell that targets one or more permanents, gain control of those permanents."',
            // CR 114.1 / 114.3 — the emblem goes to its owner's command zone.
            effects: [{ op: "emblem", emblem: DACK_FAYDEN_EMBLEM_ID }],
        },
    ],
};
