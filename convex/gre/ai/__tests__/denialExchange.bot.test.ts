// Issue #5431 — `abilityIsDenialExchange` reads a sacrifice-for-denial script
// and fails closed on everything else (CR 701.21a, CR 305.1).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ActivatedAbility, EffectOp } from "../../../cards/types";
import { enumerateMoves } from "../../moves";
import { buildStateFromScenario } from "../../scenarioBuilder";
import { isDenialExchangeSacrifice } from "../../search";
import { buildBladeBaseState } from "../blade/baseState";
import { abilityIsDenialExchange } from "../denialExchange";

const ability = (effects: EffectOp[]): ActivatedAbility => ({
    id: "test-ability",
    targetRequirement: { type: "player", count: 1 },
    oracleText: "",
    cost: { sacrifice: true },
    useStack: true,
    effects,
});

const noLands: EffectOp = { op: "restrictLandPlay", player: { target: 0 } };

describe("abilityIsDenialExchange", () => {
    it("accepts the shipped sacrifice-for-denial outlet", () => {
        const outlet = getCardByName("Pardic Miner").activatedAbilities?.[0];
        expect(outlet).toBeDefined();
        expect(abilityIsDenialExchange(outlet!)).toBe(true);
    });

    it("accepts the other turn-scoped restrictions on the announced target", () => {
        expect(
            abilityIsDenialExchange(
                ability([{ op: "restrictCasting", player: { target: 0 } }])
            )
        ).toBe(true);
        expect(
            abilityIsDenialExchange(
                ability([{ op: "restrictActivation", player: { target: 0 } }])
            )
        ).toBe(true);
    });

    it("rejects a restriction aimed at the controller", () => {
        expect(
            abilityIsDenialExchange(
                ability([{ op: "restrictLandPlay", player: "controller" }])
            )
        ).toBe(false);
    });

    it("rejects a script with any extra Op — a draw survives the trade", () => {
        expect(
            abilityIsDenialExchange(
                ability([
                    noLands,
                    { op: "draw", player: "controller", count: 1 },
                ])
            )
        ).toBe(false);
    });

    it("rejects an empty script and an imperative resolve()", () => {
        expect(abilityIsDenialExchange(ability([]))).toBe(false);
        expect(
            abilityIsDenialExchange({
                ...ability([noLands]),
                resolve: () => undefined,
            } as ActivatedAbility)
        ).toBe(false);
    });
});

describe("isDenialExchangeSacrifice — where the prune applies (issue #5431)", () => {
    const position = () => {
        const base = buildBladeBaseState();
        const meId = base.players[0]!.id;
        const state = buildStateFromScenario(
            base,
            {
                cards: [
                    { name: "Pardic Miner", owner: "me", zone: "battlefield" },
                    { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
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
        expect(isDenialExchangeSacrifice(state, meId, meId, move)).toBe(true);
    });

    it("keeps the OPPONENT's exchange in the tree", () => {
        const { state, meId, oppId, move } = position();
        expect(isDenialExchangeSacrifice(state, meId, oppId, move)).toBe(false);
    });
});
