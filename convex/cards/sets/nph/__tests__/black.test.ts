// nph black — Dismember. Exercises the Phyrexian-mana CAST path end to end
// (announce → finalizeTargetSelection → commit → resolve): the -5/-5 effect (a
// reused `pump` Op) plus the {B/P}{B/P} pip payment resolved as life or mana
// (CR 107.4f). The generic cost-system pieces are covered in
// convex/gre/__tests__/phyrexian.test.ts.
import { describe, it, expect } from "vitest";
import { dismember } from "../black";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { finalizeTargetSelection } from "../../../../game";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

function setup(opts: {
    life: number;
    manaPool?: Partial<Record<"W" | "U" | "B" | "R" | "G" | "C", number>>;
    phyrexianLifePips?: number;
}) {
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
        power: 6,
        toughness: 6,
    });
    const spell = makeInstance(dismember.id, {
        id: "dismember",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                life: opts.life,
                hand: [spell],
                manaPool: {
                    W: 0,
                    U: 0,
                    B: 0,
                    R: 0,
                    G: 0,
                    C: 0,
                    ...opts.manaPool,
                },
            }),
            makePlayer("p2", { battlefield: [bear] }),
        ],
    });
    state.pendingTarget = {
        playerId: "p1",
        cardInstanceId: "dismember",
        targetType: "Creature",
        count: 1,
        selected: [{ type: "permanent", id: "bear" }],
        ...(opts.phyrexianLifePips !== undefined
            ? { phyrexianLifePips: opts.phyrexianLifePips }
            : {}),
    };
    finalizeTargetSelection(state, state.pendingTarget!, "p1");
    return state;
}

describe("Dismember (-5/-5, {1}{B/P}{B/P}, CR 107.4f)", () => {
    it("default split pays both {B/P} with life and gives -5/-5", () => {
        // 20 life, only {C} for the {1} generic → both Phyrexian pips paid with
        // 4 life; the target (6/6) becomes 1/1.
        const state = setup({ life: 20, manaPool: { C: 1 } });
        expect(state.players[0].life).toBe(16); // 20 - 2 pips × 2 life
        resolveTopOfStack(state);
        const bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(1);
        expect(getEffectiveToughness(state, bear)).toBe(1);
    });

    it("explicit phyrexianLifePips:0 pays the pips with {B} mana, no life lost", () => {
        // 20 life, pool {C}{B}{B} → {1} from {C}, each {B/P} from {B}, 0 life.
        const state = setup({
            life: 20,
            manaPool: { C: 1, B: 2 },
            phyrexianLifePips: 0,
        });
        expect(state.players[0].life).toBe(20);
        expect(state.players[0].manaPool.B).toBe(0);
        resolveTopOfStack(state);
        const bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectiveToughness(state, bear)).toBe(1);
    });

    it("wire format: the -5/-5 survives projection (mandatory)", () => {
        const state = setup({ life: 20, manaPool: { C: 1 } });
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 2, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });
});
