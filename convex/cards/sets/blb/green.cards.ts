// blb — green cards (ADR 0043 colour split).

import { countCardTypesExiledWith } from "../../../gre/exileLinks";
import type { PermanentView, StaticEffectStateView } from "../../types";
import { defineCard, EFFECT_AFFECTS_SELF } from "../../types";

// "Four or more card types among cards exiled with this creature" — the ONE
// source-level gate (CR 611.3a) both layer effects read, so the +4/+4 (layer
// 7c) and trample (layer 6) always agree. Re-derived at every read from the
// linked pile (CR 607.2a, `countCardTypesExiledWith`), so an instant-speed
// exile turns it on mid-combat; a new object after CR 400.7 has an empty pile.
function fourCardTypesExiledWithSource(
    source: PermanentView,
    state: StaticEffectStateView
): boolean {
    return countCardTypesExiledWith(state, source.id) >= 4;
}

// hand-tail: As long as there are four or more card types among cards exiled with this creature, it gets +4/+4 and has trample. (#3245)
export const keenEyedCurator = defineCard(() => ({
    id: "8cf33d80-0704-4dc4-8e8d-1dcbcbc35add",
    rarity: "rare",
    name: "Keen-Eyed Curator",
    oracleText:
        "As long as there are four or more card types among cards exiled with this creature, it gets +4/+4 and has trample.\n{1}: Exile target card from a graveyard.",
    manaCost: { G: 2 },
    types: ["Creature"],
    subtypes: ["Raccoon", "Scout"],
    power: 3,
    toughness: 3,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: EFFECT_AFFECTS_SELF,
            condition: fourCardTypesExiledWithSource,
            power: 4,
            toughness: 4,
        },
        {
            kind: "keyword-grant",
            applies: EFFECT_AFFECTS_SELF,
            condition: fourCardTypesExiledWithSource,
            keyword: "trample",
        },
    ],
    activatedAbilities: [
        {
            id: "keen-eyed-curator-exile",
            oracleText: "{1}: Exile target card from a graveyard.",
            cost: { mana: { X: 1 } },
            targetRequirement: { type: "card", count: 1, zone: "graveyard" },
            useStack: true,
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "exile",
                    linkToSource: true,
                },
            ],
        },
    ],
}));
