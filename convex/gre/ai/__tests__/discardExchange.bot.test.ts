// Issue #4276 — `abilityIsDiscardExchange` reads a sacrifice-for-discard
// script and fails closed on everything else (CR 701.21a, CR 701.9a).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ActivatedAbility, EffectOp } from "../../../cards/types";
import { enumerateMoves } from "../../moves";
import { buildStateFromScenario } from "../../scenarioBuilder";
import { isDiscardExchangeSacrifice } from "../../search";
import { buildBladeBaseState } from "../blade/baseState";
import { abilityIsDiscardExchange } from "../discardExchange";

const ability = (effects: EffectOp[]): ActivatedAbility => ({
    id: "test-ability",
    targetRequirement: { type: "player", count: 1 },
    oracleText: "",
    cost: { sacrifice: true },
    useStack: true,
    effects,
});

const targetDiscard: EffectOp[] = [
    {
        op: "choice",
        kind: "discard-hand",
        player: { target: 0 },
        zone: "hand",
        count: 1,
        prompt: "Discard a card.",
        bind: "$discard1",
    },
    { op: "discard", player: { target: 0 }, cards: { ref: "$discard1" } },
] as EffectOp[];

describe("abilityIsDiscardExchange", () => {
    it("accepts the shipped sacrifice-for-discard outlets", () => {
        for (const name of ["Nezumi Bone-Reader", "Sadistic Hypnotist"]) {
            const outlet = getCardByName(name).activatedAbilities?.[0];
            expect(outlet, name).toBeDefined();
            expect(abilityIsDiscardExchange(outlet!), name).toBe(true);
        }
    });

    it("rejects a discard the controller makes themselves", () => {
        expect(
            abilityIsDiscardExchange(
                ability([
                    {
                        op: "discard",
                        player: "controller",
                        cards: { ref: "$x" },
                    },
                ] as EffectOp[])
            )
        ).toBe(false);
    });

    it("rejects a script with any second Op — a draw survives the trade", () => {
        expect(
            abilityIsDiscardExchange(
                ability([
                    ...targetDiscard,
                    { op: "draw", player: "controller", count: 1 },
                ])
            )
        ).toBe(false);
    });

    it("rejects an empty script, a lone choice and an imperative resolve()", () => {
        expect(abilityIsDiscardExchange(ability([]))).toBe(false);
        expect(abilityIsDiscardExchange(ability([targetDiscard[0]!]))).toBe(
            false
        );
        expect(
            abilityIsDiscardExchange({
                ...ability(targetDiscard),
                resolve: () => undefined,
            } as ActivatedAbility)
        ).toBe(false);
    });
});

describe("isDiscardExchangeSacrifice — where the prune applies (issue #4276)", () => {
    const position = () => {
        const base = buildBladeBaseState();
        const meId = base.players[0]!.id;
        const state = buildStateFromScenario(
            base,
            {
                cards: [
                    {
                        name: "Sadistic Hypnotist",
                        owner: "me",
                        zone: "battlefield",
                    },
                    { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                    { name: "Grizzly Bears", owner: "opp", zone: "hand" },
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
        expect(isDiscardExchangeSacrifice(state, meId, meId, move)).toBe(true);
    });

    it("keeps the OPPONENT's exchange in the tree", () => {
        const { state, meId, oppId, move } = position();
        expect(isDiscardExchangeSacrifice(state, meId, oppId, move)).toBe(
            false
        );
    });
});
