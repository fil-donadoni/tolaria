// Issue #4272 — `abilityIsRemovalExchange` reads a sacrifice-for-removal
// script and fails closed on everything else (CR 701.21a, CR 118.1).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ActivatedAbility, EffectOp } from "../../../cards/types";
import { abilityIsRemovalExchange } from "../removalExchange";

const ability = (effects: EffectOp[]): ActivatedAbility => ({
    id: "test-ability",
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

    it("rejects a script with any second Op — a draw survives the trade", () => {
        expect(
            abilityIsRemovalExchange(
                ability([
                    { op: "dealDamage", amount: 1, to: { target: 0 } },
                    { op: "draw", count: 1 },
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
