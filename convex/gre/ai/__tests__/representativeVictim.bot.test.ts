// The Representative Victim is typed (issue #4903): an ETB Ability whose
// target can only be an artifact, an enchantment or a land is priced in hand
// at a representative permanent of THAT type, the way `permanentRealisedValue`
// prices one — never at the vanilla 2/2 a creature kill is worth.

import { describe, expect, it } from "vitest";
import { getCardByName, tryGetDefinition } from "../../../cards";
import type { TargetRequirement } from "../../../cards/types";
import { creatureValueRaw, nonCreatureBodyRaw } from "../../creatureBody";
import { dslAbilityScriptValue } from "../cardScriptValue";
import { DEFAULT_EVAL_WEIGHTS, FIT_BASE_EVAL_WEIGHTS } from "../evalWeights";
import {
    representativeVictimLoss,
    representativeVictimUnits,
} from "../representativeVictim";

const W = FIT_BASE_EVAL_WEIGHTS;
const req = (type: TargetRequirement["type"]): TargetRequirement => ({
    type,
    count: 1,
});

describe("representativeVictimUnits — one victim of the requirement's type (issue #4903)", () => {
    it("an enchantment or an artifact is a script-less MV 2 non-creature plus its presence", () => {
        const expected =
            (W.permanentWeight + nonCreatureBodyRaw(2)) /
            representativeVictimLoss(W);
        expect(representativeVictimUnits(req("Enchantment"), W)).toBe(expected);
        expect(representativeVictimUnits(req("Artifact"), W)).toBe(expected);
        expect(expected).toBeLessThan(1);
    });

    it("a land is its presence plus one untapped mana source", () => {
        expect(representativeVictimUnits(req("Land"), W)).toBe(
            (W.permanentWeight + W.manaWeight) / representativeVictimLoss(W)
        );
    });

    it("several types take the costliest representative among them", () => {
        expect(
            representativeVictimUnits(
                req(["Artifact", "Enchantment", "Land"]),
                W
            )
        ).toBe(representativeVictimUnits(req("Enchantment"), W));
    });

    it("a requirement that can name a creature, a planeswalker or a non-permanent keeps the 2/2", () => {
        expect(representativeVictimUnits(req("Creature"), W)).toBeUndefined();
        expect(
            representativeVictimUnits(req(["Artifact", "Creature"]), W)
        ).toBeUndefined();
        expect(
            representativeVictimUnits(req("Planeswalker"), W)
        ).toBeUndefined();
        expect(representativeVictimUnits(req("any"), W)).toBeUndefined();
        expect(
            representativeVictimUnits(
                { ...req("Enchantment"), zone: "graveyard" },
                W
            )
        ).toBeUndefined();
    });

    it("the denominator is still the vanilla 2/2", () => {
        expect(representativeVictimLoss(W)).toBe(
            creatureValueRaw(2, 2, 2, []) + W.permanentWeight
        );
    });
});

describe("an ETB Ability's potential reads the typed victim (issue #4903)", () => {
    it("Monk Realist's 'destroy target enchantment' is one representative enchantment's worth of boardRemoval, not a 2/2's", () => {
        const units = representativeVictimUnits(req("Enchantment"), W) ?? 1;
        // The registry definition, as the engine reads it (the compiled
        // abilities ride on the id, not the name row).
        const def = tryGetDefinition(getCardByName("Monk Realist").id);
        if (!def) throw new Error("Monk Realist has no definition");
        expect(dslAbilityScriptValue(def)).toBe(
            DEFAULT_EVAL_WEIGHTS.latent.boardRemoval * units
        );
    });
});
