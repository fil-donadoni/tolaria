// isd — black cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/loyalty are from Scryfall (id = first paper printing, ISD).

import type { CardDefinition } from "../../types";

// ─────────────────────────────────────────────────────────────────────────
// Planeswalker / loyalty framework tracer (issue #700, ADR 0058)
// ─────────────────────────────────────────────────────────────────────────
//
// Liliana of the Veil — {1}{B}{B} Legendary Planeswalker, starting loyalty 3
// (CR 306.5b, placed on ETB from `loyalty`). All three loyalty abilities
// (CR 606) carry a signed `cost.loyalty` and reuse ONLY already-exercised
// Effect Script Ops, so no hand-written per-card test is required (per-Op
// regime, ADR 0045/0046): the catalogue `validateEffectScript` sweep + the
// auto-generated smoke test cover the effect scripts, and the loyalty FRAMEWORK
// itself (cost.loyalty gates, damage→loyalty, 0-loyalty SBA) has dedicated
// tests in `convex/gre/__tests__/loyalty.test.ts`.
//   • +1 — each player discards a card: forEach{players} → choice(choose-hand-
//     card) → discard (the Blazing Specter discard pair, inv/multicolor.ts).
//   • −2 — target player sacrifices a creature: choice(sacrifice-permanents)
//     routed to the target player + sacrifice (the Innocent Blood edict shape,
//     ody/black.ts, retargeted from "each player" to `{ target: 0 }`).
//   • −6 — separate all permanents target player controls into two piles; that
//     player sacrifices the pile of their choice: `divideIntoPiles` (ADR 0053)
//     with divider = controller, chooser = the target player, chosen pile
//     sacrificed via forEach{bound} → sacrifice (the Do or Die shape,
//     inv/black.ts, destroy→sacrifice and no type filter).
export const lilianaOfTheVeil: CardDefinition = {
    id: "ac506c17-adc8-49c6-9d8d-43db7cb1ec9d",
    name: "Liliana of the Veil",
    rarity: "mythic",
    manaCost: { X: 1, B: 2 },
    types: ["Planeswalker"],
    subtypes: ["Liliana"],
    supertypes: ["Legendary"],
    loyalty: 3,
    oracleText:
        "+1: Each player discards a card.\n−2: Target player sacrifices a creature.\n−6: Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.",
    activatedAbilities: [
        {
            id: "liliana-veil-plus1",
            // CR 606.2 — loyalty ability; `+1` puts one loyalty counter on.
            cost: { loyalty: 1 },
            useStack: true,
            oracleText: "+1: Each player discards a card.",
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "choice",
                            kind: "choose-hand-card",
                            player: { ref: "$each" },
                            zone: "hand",
                            count: 1,
                            prompt: "Liliana of the Veil: discard a card.",
                            bind: "$disc",
                        },
                        {
                            op: "discard",
                            player: { ref: "$each" },
                            cards: { ref: "$disc" },
                        },
                    ],
                },
            ],
        },
        {
            id: "liliana-veil-minus2",
            // CR 606.2 / 606.5 — `-2` removes two loyalty counters.
            cost: { loyalty: -2 },
            useStack: true,
            oracleText: "−2: Target player sacrifices a creature.",
            targetRequirement: { type: "player", count: 1 },
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { target: 0 },
                    zone: "battlefield",
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Liliana of the Veil: sacrifice a creature.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        },
        {
            id: "liliana-veil-minus6",
            // CR 606.2 / 606.5 — `-6` removes six loyalty counters (the ultimate;
            // no emblem, so it is a plain effect script).
            cost: { loyalty: -6 },
            useStack: true,
            oracleText:
                "−6: Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.",
            targetRequirement: { type: "player", count: 1 },
            effects: [
                {
                    op: "divideIntoPiles",
                    objects: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: { target: 0 },
                    },
                    divider: "controller",
                    chooser: { target: 0 },
                    dividePrompt:
                        "Liliana of the Veil — divide the permanents into two piles.",
                    pickPrompt:
                        "Choose a pile: you sacrifice all permanents in it.",
                    chosenBind: "$lilianaChosen",
                    otherBind: "$lilianaOther",
                    chosenEffect: [
                        {
                            op: "forEach",
                            select: { set: "bound", ref: "$lilianaChosen" },
                            effects: [
                                {
                                    op: "sacrifice",
                                    target: { ref: "$each" },
                                },
                            ],
                        },
                    ],
                    otherEffect: [],
                },
            ],
        },
    ],
};
