// Issue #4277 — `abilityIsDrainExchange` reads a sacrifice-for-drain script
// and fails closed on everything else (CR 701.21a, CR 119.3).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ActivatedAbility, EffectOp } from "../../../cards/types";
import { enumerateMoves } from "../../moves";
import { buildStateFromScenario } from "../../scenarioBuilder";
import { isDrainExchangeSacrifice } from "../../search";
import { buildBladeBaseState } from "../blade/baseState";
import { abilityIsDrainExchange } from "../drainExchange";

const ability = (effects: EffectOp[]): ActivatedAbility => ({
    id: "test-ability",
    targetRequirement: { type: "player", count: 1 },
    oracleText: "",
    cost: { sacrifice: true },
    useStack: true,
    effects,
});

const drain: EffectOp[] = [
    { op: "loseLife", player: { target: 0 }, amount: 1 },
    { op: "gainLife", player: "controller", amount: 1 },
] as EffectOp[];

describe("abilityIsDrainExchange", () => {
    it("accepts the shipped sacrifice-for-drain outlets", () => {
        for (const name of ["Cabal Archon", "Death Cultist"]) {
            const outlet = getCardByName(name).activatedAbilities?.[0];
            expect(outlet, name).toBeDefined();
            expect(abilityIsDrainExchange(outlet!), name).toBe(true);
        }
    });

    it("rejects a lone loss or a lone gain — not a drain", () => {
        expect(abilityIsDrainExchange(ability([drain[0]!]))).toBe(false);
        expect(abilityIsDrainExchange(ability([drain[1]!]))).toBe(false);
    });

    it("rejects a gain aimed at the announced target", () => {
        expect(
            abilityIsDrainExchange(
                ability([
                    drain[0]!,
                    { op: "gainLife", player: { target: 0 }, amount: 1 },
                ] as EffectOp[])
            )
        ).toBe(false);
    });

    it("rejects a script with any third Op — a draw survives the trade", () => {
        expect(
            abilityIsDrainExchange(
                ability([
                    ...drain,
                    { op: "draw", player: "controller", count: 1 },
                ])
            )
        ).toBe(false);
    });

    it("rejects an empty script and an imperative resolve()", () => {
        expect(abilityIsDrainExchange(ability([]))).toBe(false);
        expect(
            abilityIsDrainExchange({
                ...ability(drain),
                resolve: () => undefined,
            } as ActivatedAbility)
        ).toBe(false);
    });
});

describe("isDrainExchangeSacrifice — where the prune applies (issue #4277)", () => {
    const position = () => {
        const base = buildBladeBaseState();
        const meId = base.players[0]!.id;
        const state = buildStateFromScenario(
            base,
            {
                cards: [
                    { name: "Death Cultist", owner: "me", zone: "battlefield" },
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
        expect(isDrainExchangeSacrifice(state, meId, meId, move)).toBe(true);
    });

    it("keeps the OPPONENT's exchange in the tree", () => {
        const { state, meId, oppId, move } = position();
        expect(isDrainExchangeSacrifice(state, meId, oppId, move)).toBe(false);
    });
});
