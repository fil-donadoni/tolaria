// Per-card behaviour test for vis/red.ts — Fireblast, the red alternative-cost
// card (CR 118.9 "sacrifice two Mountains rather than pay this spell's mana
// cost", then deal 4 damage to any target). The alt-cost payment happens at
// cast commit, so this exercises the real commit path
// (`finalizeTargetSelection`) plus the shared cost helper and dealDamage Op.
// The sacrifice-lands cost-system primitive is covered by
// `convex/gre/__tests__/alternative-cost.test.ts`.
import { describe, it, expect } from "vitest";
import { fireblast } from "..";
import { mountain } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";
import type { PendingTarget } from "../../../../gre/state";
import { finalizeTargetSelection } from "../../../../game";
import { getLegalActions } from "../../../../gre/rules";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

function mountains(playerId: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(mountain.id, {
            id: `${playerId}-mountain-${i}`,
            controllerId: playerId,
            ownerId: playerId,
        })
    );
}

describe("Fireblast ({4}{R}{R} instant — sacrifice two Mountains rather than pay mana, 4 to any target; CR 118.9 / 120.1)", () => {
    it("declares the sacrifice-two-Mountains alternative cost and an any-target requirement", () => {
        expect(fireblast.targetRequirement).toEqual({ type: "any", count: 1 });
        expect(fireblast.alternativeCosts?.[0]).toMatchObject({
            action: "sacrifice",
            count: 2,
            filter: { subtypes: "Mountain" },
        });
    });

    it("cast is legal with two Mountains and no mana (alt cost affordable)", () => {
        const fbInHand = makeInstance(fireblast.id, {
            id: "fb-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [fbInHand],
                    battlefield: mountains("p1", 2),
                }),
                makePlayer("p2"),
            ],
        });
        expect(getLegalActions(state, state.players[0], fbInHand)).toContain(
            "cast"
        );
    });

    it("is NOT castable with only one Mountain and no mana", () => {
        const fbInHand = makeInstance(fireblast.id, {
            id: "fb-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [fbInHand],
                    battlefield: mountains("p1", 1),
                }),
                makePlayer("p2"),
            ],
        });
        expect(
            getLegalActions(state, state.players[0], fbInHand)
        ).not.toContain("cast");
    });

    it("sacrifices two Mountains at commit and deals 4 to any target", () => {
        const fbInHand = makeInstance(fireblast.id, {
            id: "fb-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [fbInHand],
                    battlefield: mountains("p1", 2),
                }),
                makePlayer("p2"),
            ],
        });

        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "fb-1",
            targetType: "any",
            count: 1,
            selected: [{ type: "player", id: "p2" }],
            kind: "cast",
            alternativeCostId: "sacrifice-two-mountains",
        };
        finalizeTargetSelection(state, pt, "p1");

        // Two Mountains sacrificed to the graveyard.
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(2);
        // Fireblast on the stack; resolving deals 4 to p2.
        expect(state.stack[state.stack.length - 1].id).toBe("fb-1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(16);
    });
});
