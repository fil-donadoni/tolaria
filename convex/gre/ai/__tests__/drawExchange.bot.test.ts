// Issue #4279 — `abilityIsDrawExchange` reads a sacrifice-for-draw script
// and fails closed on everything else (CR 701.21a, CR 121.1).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ActivatedAbility, EffectOp } from "../../../cards/types";
import { enumerateMoves } from "../../moves";
import { buildStateFromScenario } from "../../scenarioBuilder";
import { isDrawExchangeSacrifice } from "../../search";
import { buildBladeBaseState } from "../blade/baseState";
import { abilityIsDrawExchange } from "../drawExchange";

const ability = (effects: EffectOp[]): ActivatedAbility => ({
    id: "test-ability",
    targetRequirement: { type: "player", count: 1 },
    oracleText: "",
    cost: { sacrifice: true },
    useStack: true,
    effects,
});

const draw: EffectOp = {
    op: "draw",
    player: { target: 0 },
    count: 1,
} as EffectOp;

describe("abilityIsDrawExchange", () => {
    it("accepts the shipped sacrifice-for-draw outlet", () => {
        const outlet = getCardByName("Limestone Golem").activatedAbilities?.[0];
        expect(outlet).toBeDefined();
        expect(abilityIsDrawExchange(outlet!)).toBe(true);
    });

    it("accepts a draw aimed at the controller", () => {
        expect(
            abilityIsDrawExchange(
                ability([{ op: "draw", player: "controller", count: 1 }])
            )
        ).toBe(true);
    });

    it("rejects a draw aimed at the opponent seat by name", () => {
        expect(
            abilityIsDrawExchange(
                ability([{ op: "draw", player: "opponent", count: 1 }])
            )
        ).toBe(false);
    });

    it("rejects a script with any second Op — a life swing rides along", () => {
        expect(
            abilityIsDrawExchange(
                ability([
                    draw,
                    { op: "gainLife", player: "controller", amount: 1 },
                ] as EffectOp[])
            )
        ).toBe(false);
    });

    it("rejects an empty script and an imperative resolve()", () => {
        expect(abilityIsDrawExchange(ability([]))).toBe(false);
        expect(
            abilityIsDrawExchange({
                ...ability([draw]),
                resolve: () => undefined,
            } as ActivatedAbility)
        ).toBe(false);
    });
});

describe("isDrawExchangeSacrifice — where the prune applies (issue #4279)", () => {
    const position = () => {
        const base = buildBladeBaseState();
        const meId = base.players[0]!.id;
        const state = buildStateFromScenario(
            base,
            {
                cards: [
                    {
                        name: "Limestone Golem",
                        owner: "me",
                        zone: "battlefield",
                    },
                    { name: "Swamp", owner: "me", zone: "battlefield" },
                    { name: "Swamp", owner: "me", zone: "battlefield" },
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
        expect(isDrawExchangeSacrifice(state, meId, meId, move)).toBe(true);
    });

    it("keeps the OPPONENT's exchange in the tree", () => {
        const { state, meId, oppId, move } = position();
        expect(isDrawExchangeSacrifice(state, meId, oppId, move)).toBe(false);
    });
});
