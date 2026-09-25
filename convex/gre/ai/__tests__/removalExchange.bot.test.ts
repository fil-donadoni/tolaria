// Issue #4272 — `abilityIsRemovalExchange` reads a sacrifice-for-removal
// script and fails closed on everything else (CR 701.21a, CR 118.1).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type {
    ActivatedAbility,
    EffectOp,
    TargetRequirement,
} from "../../../cards/types";
import { abilityIsRemovalExchange } from "../removalExchange";

const ability = (
    effects: EffectOp[],
    targetRequirement: TargetRequirement = { type: "Creature", count: 1 }
): ActivatedAbility => ({
    id: "test-ability",
    targetRequirement,
    oracleText: "",
    cost: { sacrifice: true },
    useStack: true,
    effects,
});

describe("abilityIsRemovalExchange", () => {
    it("accepts the shipped sacrifice-and-damage outlets", () => {
        for (const name of [
            "Arms Dealer",
            "Bloodpyre Elemental",
            "Frostling",
        ]) {
            const outlet = getCardByName(name).activatedAbilities?.[0];
            expect(outlet, name).toBeDefined();
            expect(abilityIsRemovalExchange(outlet!), name).toBe(true);
        }
    });

    it("accepts a destroy of an announced target", () => {
        expect(
            abilityIsRemovalExchange(
                ability([{ op: "destroy", target: { target: 0 } }])
            )
        ).toBe(true);
    });

    it("rejects damage to a player — burn to the face creates damage", () => {
        expect(
            abilityIsRemovalExchange(
                ability([
                    {
                        op: "dealDamage",
                        amount: 2,
                        to: { player: "opponent" },
                    },
                ])
            )
        ).toBe(false);
    });

    it("rejects damage to any target — it can be a face", () => {
        expect(
            abilityIsRemovalExchange(
                ability([{ op: "dealDamage", amount: 2, to: { target: 0 } }], {
                    type: "any",
                    count: 1,
                })
            )
        ).toBe(false);
    });

    it("rejects a script with any second Op — a draw survives the trade", () => {
        expect(
            abilityIsRemovalExchange(
                ability([
                    { op: "dealDamage", amount: 1, to: { target: 0 } },
                    { op: "draw", player: "you", count: 1 },
                ])
            )
        ).toBe(false);
    });

    it("rejects an empty script and an imperative resolve()", () => {
        expect(abilityIsRemovalExchange(ability([]))).toBe(false);
        expect(
            abilityIsRemovalExchange({
                ...ability([{ op: "destroy", target: { target: 0 } }]),
                resolve: () => undefined,
            } as ActivatedAbility)
        ).toBe(false);
    });
});
