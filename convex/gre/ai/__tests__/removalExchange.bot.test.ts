// Issue #4272 — `abilityIsRemovalExchange` reads a sacrifice-for-removal
// script and fails closed on everything else (CR 701.21a, CR 118.1).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type {
    ActivatedAbility,
    EffectOp,
    TargetRequirement,
} from "../../../cards/types";
import { enumerateMoves } from "../../moves";
import { buildStateFromScenario } from "../../scenarioBuilder";
import { isRemovalExchangeSacrifice } from "../../search";
import type { GameState } from "../../state";
import { buildBladeBaseState } from "../blade/baseState";
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
                    { op: "draw", player: "controller", count: 1 },
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

describe("isRemovalExchangeSacrifice — where the prune applies (issue #4272)", () => {
    const position = () => {
        const base = buildBladeBaseState();
        const meId = base.players[0]!.id;
        const state = buildStateFromScenario(
            base,
            {
                cards: [
                    { name: "Frostling", owner: "me", zone: "battlefield" },
                    { name: "Mountain", owner: "me", zone: "battlefield" },
                    {
                        name: "Grizzly Bears",
                        owner: "opp",
                        zone: "battlefield",
                    },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                libraryCount: 20,
            },
            meId
        );
        const oppId = state.players.find((p) => p.id !== meId)!.id;
        const move = enumerateMoves(state, meId).find(
            (m) => m.kind === "activate-ability"
        )!;
        expect(move).toBeDefined();
        return { state, meId, oppId, move };
    };

    it("prunes the bot's own exchange in a main phase", () => {
        const { state, meId, move } = position();
        expect(isRemovalExchangeSacrifice(state, meId, meId, move)).toBe(true);
    });

    it("keeps the OPPONENT's exchange in the tree", () => {
        const { state, meId, oppId, move } = position();
        expect(isRemovalExchangeSacrifice(state, meId, oppId, move)).toBe(
            false
        );
    });

    it("keeps an exchange in a live combat", () => {
        const { state, meId, move } = position();
        state.phase = "DECLARE_BLOCKERS";
        state.combat = { attackerIds: ["attacker-1"] } as GameState["combat"];
        expect(isRemovalExchangeSacrifice(state, meId, meId, move)).toBe(false);
    });
});
