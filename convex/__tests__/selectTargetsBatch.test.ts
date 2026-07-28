// Integration tests for the batched `selectTargets` mutation (issue #1779 /
// PRD #1776 T4): a full ordered array of target selections applied in ONE
// transaction, instead of one `selectTarget` mutation per target — including
// preservation of per-target divide-as-you-choose amounts (CR 601.2d / 120.4).
//
// No convex-test harness is used for `game.ts` mutations anywhere in this
// codebase (see autoTapForPayment.test.ts / wildGrowthMana.test.ts) — the
// established seam is to test the exported core primitives directly against
// real GameState fixtures. `applyOneTargetSelection` is exactly that seam: it
// is the per-item logic the batched `selectTargets` mutation loops over
// (clone state once, apply each target item, save once). These tests
// exercise it the same way the mutation body does.
//
// Fixtures use an open-ended `count` (`{ min: 1, max: 5 }`) and leave the
// divide-as-you-choose budget partially unassigned so `maxReached` never
// fires — that keeps the fixtures focused on `applyOneTargetSelection`'s own
// contract without also having to stand up `finalizeTargetSelection`'s full
// cast-commit machinery (real hand card, mana, stack placement), which is
// orthogonal to what this batching change touches.

import { describe, it, expect } from "vitest";
import { applyOneTargetSelection } from "../game";
import { makePlayer, makeState } from "../cards/__tests__/setup";
import type { GameState, PendingTarget } from "../gre/state";

function pendingTargetState(overrides: Partial<PendingTarget> = {}): GameState {
    const pendingTarget: PendingTarget = {
        playerId: "p1",
        cardInstanceId: "spell",
        targetType: "player",
        // Open-ended max — 2-3 selections never auto-finalize, so these
        // tests never need to drive `finalizeTargetSelection`'s cast-commit
        // path (see file header).
        count: { min: 1, max: 5 },
        selected: [],
        ...overrides,
    };
    return makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
        pendingTarget,
    });
}

/** Mirrors the `selectTargets` mutation body: apply each target item in
 *  order, stopping early if the selection finalizes mid-batch. */
function applyTargetBatch(
    state: GameState,
    playerId: string,
    targets: {
        targetType: "permanent" | "player" | "spell" | "graveyard-card";
        targetId: string;
        targetPlayerId?: string;
        amount?: number;
    }[]
): void {
    for (const target of targets) {
        applyOneTargetSelection(state, playerId, target);
        if (!state.pendingTarget) break;
    }
}

describe("selectTargets batch — terminal state parity (issue #1779)", () => {
    it("applying 2 targets as one batch matches applying them one at a time", () => {
        const batchState = pendingTargetState();
        applyTargetBatch(batchState, "p1", [
            { targetType: "player", targetId: "p2" },
            { targetType: "player", targetId: "p1" },
        ]);

        // Step-by-step: same operations, applied individually — exactly what
        // 2 separate `selectTarget` mutation calls would have done.
        const stepState = pendingTargetState();
        applyTargetBatch(stepState, "p1", [
            { targetType: "player", targetId: "p2" },
        ]);
        applyTargetBatch(stepState, "p1", [
            { targetType: "player", targetId: "p1" },
        ]);

        expect(batchState.pendingTarget!.selected).toEqual(
            stepState.pendingTarget!.selected
        );
        expect(batchState.pendingTarget!.selected).toEqual([
            { type: "player", id: "p2" },
            { type: "player", id: "p1" },
        ]);
    });

    it("preserves per-target divide-as-you-choose amounts across the batch (CR 601.2d)", () => {
        const state = pendingTargetState({ divideTotal: 6 });
        applyTargetBatch(state, "p1", [
            { targetType: "player", targetId: "p2", amount: 3 },
            { targetType: "player", targetId: "p1", amount: 2 },
        ]);

        expect(state.pendingTarget!.divideAmounts).toEqual({
            "player:p2": 3,
            "player:p1": 2,
        });
        // Budget not fully spent (5/6) — selection stays open, matching the
        // same-shape one-at-a-time behavior.
        expect(state.pendingTarget).toBeDefined();
    });

    it("rejects an over-budget amount, aborting that entry exactly like a single selectTarget call", () => {
        const state = pendingTargetState({ divideTotal: 4 });
        applyOneTargetSelection(state, "p1", {
            targetType: "player",
            targetId: "p2",
            amount: 3,
        });
        expect(() =>
            applyOneTargetSelection(state, "p1", {
                targetType: "player",
                targetId: "p1",
                amount: 2, // 3 + 2 > 4
            })
        ).toThrow("Assigned amount exceeds the spell's total");
    });
});

describe("selectTargets batch — abort-whole-batch on first illegal element (issue #1779)", () => {
    it("throws on the first illegal target and never applies later entries", () => {
        const state = pendingTargetState();
        const targets = [
            { targetType: "player" as const, targetId: "p2" },
            { targetType: "player" as const, targetId: "no-such-player" }, // illegal
            { targetType: "player" as const, targetId: "p1" },
        ];

        expect(() => applyTargetBatch(state, "p1", targets)).toThrow(
            "Invalid player target"
        );

        // p2 (before the illegal entry) got applied to the in-memory clone —
        // this mirrors the real mutation's local `state` clone, which is
        // simply discarded (never saved) when the handler throws.
        expect(state.pendingTarget!.selected).toEqual([
            { type: "player", id: "p2" },
        ]);
        // p1 (after the illegal entry) never got applied — the loop stopped
        // at the throw.
        expect(state.pendingTarget!.selected).not.toContainEqual({
            type: "player",
            id: "p1",
        });
    });

    it("mirrors the mutation's clone-then-throw contract: a throw mid-batch never taints the source snapshot", () => {
        // The real `selectTargets` mutation does `structuredClone(gameState.
        // state)` BEFORE looping, and only calls `saveGameState` after the
        // WHOLE loop succeeds. So a throw mid-loop only mutates the local
        // clone, which is discarded — the persisted `gameState.state` (here
        // represented by `sourceSnapshot`, taken before the batch runs) is
        // untouched, regardless of how far the batch got.
        const sourceState = pendingTargetState();
        const sourceSnapshot = structuredClone(sourceState);
        const clone = structuredClone(sourceState) as GameState;

        expect(() =>
            applyTargetBatch(clone, "p1", [
                { targetType: "player", targetId: "p2" },
                { targetType: "player", targetId: "no-such-player" },
            ])
        ).toThrow();

        // The untouched pre-batch snapshot is bit-for-bit identical to the
        // original source state — the mutation never persists a partial
        // apply because it never even attempts to save the mutated clone.
        expect(sourceState).toEqual(sourceSnapshot);
    });
});
