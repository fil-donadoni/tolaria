// Per-card behaviour tests for mmq/blue.ts — Gush and Thwart, the two blue
// alternative-cost cards (CR 118.9 "return N Islands rather than pay this
// spell's mana cost"). The alt-cost payment happens at cast commit, so these
// exercise the real commit path (`finalizeTargetSelection` for the targeted
// Thwart) plus the shared cost helpers and effect resolution. The
// return/sacrifice cost-system primitive itself is covered by
// `convex/gre/__tests__/alternative-cost.test.ts`; the draw/counter Ops are
// covered catalogue-wide by the interpreter + smoke suites.
import { describe, it, expect } from "vitest";
import { gush, thwart } from "..";
import { island, lightningBolt } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";
import type { PendingTarget } from "../../../../gre/state";
import {
    finalizeTargetSelection,
    tryAutoCommitPendingCast,
} from "../../../../game";
import {
    canPayAlternativeCost,
    buildAlternativeCostChoice,
} from "../../../../gre/alternativeCost";
import {
    applySacrificeSelection,
    isSacrificeSelectionComplete,
} from "../../../../gre/sacrificeChoice";
import { getLegalActions } from "../../../../gre/rules";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

function islands(playerId: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(island.id, {
            id: `${playerId}-island-${i}`,
            controllerId: playerId,
            ownerId: playerId,
        })
    );
}

describe("Gush ({4}{U} instant — return two Islands rather than pay mana, draw two; CR 118.9)", () => {
    it("declares the return-two-Islands alternative cost", () => {
        expect(gush.alternativeCosts).toEqual([
            {
                id: "return-two-islands",
                description:
                    "Return two Islands you control to their owner's hand",
                action: "return",
                count: 2,
                filter: { subtypes: "Island" },
            },
        ]);
    });

    it("cast is legal with two Islands and no mana (alt cost affordable)", () => {
        const gushInHand = makeInstance(gush.id, {
            id: "gush-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [gushInHand],
                    battlefield: islands("p1", 2),
                    // No blue mana in pool — only the alt cost makes it castable.
                }),
                makePlayer("p2"),
            ],
        });
        expect(getLegalActions(state, state.players[0], gushInHand)).toContain(
            "cast"
        );
    });

    it("pays the alt cost (player chooses which Islands to return) and draws two on resolution", () => {
        const alt = gush.alternativeCosts![0];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: islands("p1", 3),
                    library: [
                        makeInstance(island.id, {
                            id: "lib-1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                        makeInstance(island.id, {
                            id: "lib-2",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(canPayAlternativeCost(state, "p1", alt)).toBe(true);
        // CR 118.9 / 701.21a — WHICH Islands to return is the caster's choice,
        // routed through the unified layer. Three indistinguishable Islands
        // returning 2 auto-resolves (no real choice), then the picks are applied.
        const choice = buildAlternativeCostChoice(state, "p1", alt, "Gush")!;
        expect(choice.action).toBe("return");
        applySacrificeSelection(state, choice);
        expect(state.players[0].battlefield).toHaveLength(1); // 3 − 2 returned
        expect(state.players[0].hand).toHaveLength(2);
        // … then the spell resolves and draws two.
        const item = {
            ...makeInstance(gush.id, {
                id: "gush-cast",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            }),
            castById: "p1",
            targets: [],
        };
        state.stack.push(item);
        resolveTopOfStack(state);
        // Two library cards drawn into hand (2 returned Islands + 2 drawn = 4).
        expect(state.players[0].hand).toHaveLength(4);
        expect(state.players[0].library).toHaveLength(0);
    });
});

describe("Thwart ({2}{U}{U} instant — return three Islands rather than pay mana, counter target spell; CR 118.9 / 701.5a)", () => {
    it("declares the return-three-Islands alternative cost and a spell target", () => {
        expect(thwart.targetRequirement).toEqual({ type: "spell", count: 1 });
        expect(thwart.alternativeCosts?.[0]).toMatchObject({
            action: "return",
            count: 3,
            filter: { subtypes: "Island" },
        });
    });

    it("returns three Islands at commit and counters the target spell", () => {
        const thwartInHand = makeInstance(thwart.id, {
            id: "thwart-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [thwartInHand],
                    battlefield: islands("p1", 3),
                }),
                makePlayer("p2"),
            ],
        });
        // Opponent's Lightning Bolt on the stack, targeting p1.
        const bolt = {
            ...makeInstance(lightningBolt.id, {
                id: "bolt-1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
            castById: "p2",
            targets: [{ type: "player" as const, id: "p1" }],
        };
        state.stack.push(bolt);

        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "thwart-1",
            targetType: "spell",
            count: 1,
            selected: [{ type: "spell", id: "bolt-1" }],
            kind: "cast",
            alternativeCostId: "return-three-islands",
        };
        finalizeTargetSelection(state, pt, "p1");

        // Alt cost paid: three Islands returned to p1's hand (Thwart left hand
        // for the stack, so hand = 3 returned Islands).
        expect(
            state.players[0].hand.filter((c) => c.subtypes.includes("Island"))
        ).toHaveLength(3);
        expect(state.players[0].battlefield).toHaveLength(0);
        // Thwart is on the stack above the Bolt.
        expect(state.stack[state.stack.length - 1].id).toBe("thwart-1");

        // Thwart resolves → Bolt countered (removed from the stack).
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === "bolt-1")).toBeUndefined();
    });

    it("parks for an explicit choice when more Islands than the cost are distinguishable, then resumes on the pick", () => {
        const thwartInHand = makeInstance(thwart.id, {
            id: "thwart-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        // Four Islands, one tapped → returning 3 is a REAL choice (the tapped
        // one is distinguishable), so the cast must park rather than auto-pick.
        const untapped = islands("p1", 3);
        const tapped = makeInstance(island.id, {
            id: "p1-island-tapped",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [thwartInHand],
                    battlefield: [...untapped, tapped],
                }),
                makePlayer("p2"),
            ],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        const bolt = {
            ...makeInstance(lightningBolt.id, {
                id: "bolt-1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
            castById: "p2",
            targets: [{ type: "player" as const, id: "p1" }],
        };
        state.stack.push(bolt);

        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "thwart-1",
            targetType: "spell",
            count: 1,
            selected: [{ type: "spell", id: "bolt-1" }],
            kind: "cast",
            alternativeCostId: "return-three-islands",
        };
        finalizeTargetSelection(state, pt, "p1");

        // Parked: Thwart is still in hand, no Islands moved yet, and a return
        // choice awaits the player (CR 118.9 / 701.21a).
        expect(state.stack.find((s) => s.id === "thwart-1")).toBeUndefined();
        expect(state.players[0].hand.some((c) => c.id === "thwart-1")).toBe(
            true
        );
        expect(state.players[0].battlefield).toHaveLength(4);
        const sel = state.pendingCast?.sacrificeSelection;
        expect(sel).toBeDefined();
        expect(sel!.action).toBe("return");
        expect(isSacrificeSelectionComplete(sel!)).toBe(false);

        // Player picks the three UNTAPPED Islands, leaving the tapped one.
        sel!.picked.push(...untapped.map((c) => c.id));
        expect(isSacrificeSelectionComplete(sel!)).toBe(true);

        // Resume the parked cast: the chosen Islands return, Thwart hits the
        // stack (mana cost zeroed), and resolving counters the Bolt.
        tryAutoCommitPendingCast(state, "p1");
        expect(
            state.players[0].hand.filter((c) => c.subtypes.includes("Island"))
        ).toHaveLength(3);
        // The tapped Island stayed on the battlefield (the player's choice).
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "p1-island-tapped",
        ]);
        expect(state.stack[state.stack.length - 1].id).toBe("thwart-1");
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === "bolt-1")).toBeUndefined();
    });
});
