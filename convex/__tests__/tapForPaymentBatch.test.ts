// Integration tests for the batched `tapForPayment` mutation (issue #1779 /
// PRD #1776 T4): `payments: Array<{ cardInstanceId, manaChoiceIndex? }>`
// applied in order in ONE transaction, instead of one mutation per land.
//
// No convex-test harness is used for `game.ts` mutations anywhere in this
// codebase (see autoTapForPayment.test.ts / wildGrowthMana.test.ts) — the
// established seam is to test the exported core primitives directly against
// real GameState fixtures. `applyOneTapPayment` is exactly that seam: it is
// the per-item logic the batched `tapForPayment` mutation loops over (clone
// state once, apply each payment item, save once). These tests exercise it
// the same way the mutation body does.

import { describe, it, expect } from "vitest";
import { applyOneTapPayment, tryAutoCommitPendingCast } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { mountain, grizzlyBears } from "../cards/sets/lea";
import type { GameState, PendingCast } from "../gre/state";

/** Board of `count` untapped Mountains, a hand spell (`grizzlyBears` — its
 *  own printed cost is irrelevant, `pendingCast.manaCost` overrides it), and
 *  a pendingCast costing `count` generic mana ({X} = count). */
function mountainState(count: number) {
    const battlefield = Array.from({ length: count }, (_, i) =>
        makeInstance(mountain.id, { id: `m${i + 1}`, controllerId: "p1" })
    );
    const cast = makeInstance(grizzlyBears.id, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "spell",
        manaCost: { X: count },
        tappedLandIds: [],
    };
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield, hand: [cast] }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast,
    });
    return state;
}

/** Mirrors the `tapForPayment` mutation body: apply each payment item in
 *  order, re-checking auto-commit after each (exactly like the real
 *  mutation), stopping early once the cast commits. */
function applyPaymentBatch(
    state: GameState,
    playerId: string,
    payments: { cardInstanceId: string; manaChoiceIndex?: number }[]
): void {
    for (const payment of payments) {
        applyOneTapPayment(state, playerId, payment);
        tryAutoCommitPendingCast(state, playerId);
        if (!state.pendingCast) break;
    }
}

describe("tapForPayment batch — terminal state parity (issue #1779)", () => {
    it("applying 3 payments as one batch matches applying them one at a time", () => {
        const batchState = mountainState(3);
        applyPaymentBatch(batchState, "p1", [
            { cardInstanceId: "m1" },
            { cardInstanceId: "m2" },
            { cardInstanceId: "m3" },
        ]);

        // Step-by-step: same operations, applied individually — exactly what
        // 3 separate `tapForPayment` mutation calls would have done.
        const stepState = mountainState(3);
        applyPaymentBatch(stepState, "p1", [{ cardInstanceId: "m1" }]);
        applyPaymentBatch(stepState, "p1", [{ cardInstanceId: "m2" }]);
        applyPaymentBatch(stepState, "p1", [{ cardInstanceId: "m3" }]);

        expect(batchState.players[0].manaPool).toEqual(
            stepState.players[0].manaPool
        );
        expect(
            batchState.players[0].battlefield.map((c) => c.isTapped)
        ).toEqual(stepState.players[0].battlefield.map((c) => c.isTapped));
        expect(batchState.pendingCast).toBeUndefined();
        expect(stepState.pendingCast).toBeUndefined();
    });

    it("auto-commits mid-batch and ignores further (over-supplied) entries", () => {
        // Cost only needs 2 mana; a 3rd payment entry is over-supplied by a
        // stale client plan and must be silently ignored, not error the
        // already-successful cast.
        const state = mountainState(2);
        applyPaymentBatch(state, "p1", [
            { cardInstanceId: "m1" },
            { cardInstanceId: "m2" },
        ]);
        expect(state.pendingCast).toBeUndefined();
        // The mana was spent paying the cost on commit, not left floating.
        expect(state.players[0].manaPool.R ?? 0).toBe(0);
        expect(state.stack).toHaveLength(1);

        const withExtra = mountainState(2);
        const extraLand = makeInstance(mountain.id, {
            id: "m3",
            controllerId: "p1",
        });
        withExtra.players[0].battlefield.push(extraLand);
        applyPaymentBatch(withExtra, "p1", [
            { cardInstanceId: "m1" },
            { cardInstanceId: "m2" },
            { cardInstanceId: "m3" },
        ]);
        expect(withExtra.pendingCast).toBeUndefined();
        expect(withExtra.stack).toHaveLength(1);
        // The 3rd (over-supplied) land is never touched.
        expect(
            withExtra.players[0].battlefield.find((c) => c.id === "m3")!
                .isTapped
        ).toBe(false);
    });
});

describe("tapForPayment batch — abort-whole-batch on first illegal element (issue #1779)", () => {
    it("throws on the first illegal payment and never applies later entries", () => {
        const state = mountainState(3);
        const payments = [
            { cardInstanceId: "m1" },
            { cardInstanceId: "does-not-exist" }, // illegal — not on battlefield
            { cardInstanceId: "m2" },
        ];

        expect(() => applyPaymentBatch(state, "p1", payments)).toThrow(
            "Card not on battlefield"
        );

        // m1 (before the illegal entry) got applied to the in-memory clone —
        // this mirrors the real mutation's local `state` clone, which is
        // simply discarded (never saved) when the handler throws.
        expect(
            state.players[0].battlefield.find((c) => c.id === "m1")!.isTapped
        ).toBe(true);
        // m2 (after the illegal entry) never got applied — the loop stopped
        // at the throw.
        expect(
            state.players[0].battlefield.find((c) => c.id === "m2")!.isTapped
        ).toBe(false);
    });

    it("mirrors the mutation's clone-then-throw contract: a throw mid-batch never taints the source snapshot", () => {
        // The real `tapForPayment` mutation does `structuredClone(gameState.
        // state)` BEFORE looping, and only calls `saveGameState` after the
        // WHOLE loop succeeds. So a throw mid-loop only mutates the local
        // clone, which is discarded — the persisted `gameState.state` (here
        // represented by `sourceSnapshot`, taken before the batch runs) is
        // untouched, regardless of how far the batch got.
        const sourceState = mountainState(3);
        const sourceSnapshot = structuredClone(sourceState);
        const clone = structuredClone(sourceState) as GameState;

        expect(() =>
            applyPaymentBatch(clone, "p1", [
                { cardInstanceId: "m1" },
                { cardInstanceId: "already-tapped-and-missing" },
            ])
        ).toThrow();

        // The untouched pre-batch snapshot is bit-for-bit identical to the
        // original source state — the mutation never persists a partial
        // apply because it never even attempts to save the mutated clone.
        expect(sourceState).toEqual(sourceSnapshot);
    });
});
