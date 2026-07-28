// Integration tests for the batched `tapForPayment` mutation (issue #1779 /
// PRD #1776 T4): `payments: Array<{ cardInstanceId, manaChoiceIndex? }>`
// applied in order in ONE transaction, instead of one mutation per land.
//
// Same harness discipline as `seatOwnership.test.ts` / `limitedPairingMatch.
// test.ts` — this project has no convex-test harness, so the established
// seam for `game.ts` mutation coverage is a stub `MutationCtx` driving the
// REGISTERED mutation's own `_handler` (`gameMutationHarness.ts`). An earlier
// revision of this file reimplemented the batch loop inline and asserted
// against a hand-mutated clone — that never drove `saveGameState`, so the
// issue's actual requirement (one `seq` bump per batched submission, no
// partial persisted write on a mid-batch throw) went untested. Fixed per
// issue #1779 review findings 2-4.

import { describe, it, expect } from "vitest";
import { tapForPayment } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { mountain, grizzlyBears } from "../cards/sets/lea";
import { ancientTomb } from "../cards/sets/tmp/colorless";
import type { GameState, PendingCast } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type TapForPaymentArgs = {
    gameId: Id<"games">;
    playerId: string;
    payments: { cardInstanceId: string; manaChoiceIndex?: number }[];
};

const runTapForPayment = (
    ctx: Parameters<typeof runMutation>[1],
    payments: TapForPaymentArgs["payments"]
) =>
    runMutation<TapForPaymentArgs, void>(
        tapForPayment as unknown as Handler<TapForPaymentArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", payments }
    );

/** Board of `count` untapped Mountains, a hand spell (`grizzlyBears` — its
 *  own printed cost is irrelevant, `pendingCast.manaCost` overrides it), and
 *  a pendingCast costing `count` generic mana ({X} = count). */
function mountainState(count: number): GameState {
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
    return makeState({
        players: [
            makePlayer("p1", { battlefield, hand: [cast] }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast,
    });
}

describe("tapForPayment batch — single seq bump (issue #1779 review findings 2-4)", () => {
    it("a 3-payment batch produces exactly ONE seq bump and matches 3 sequential single-payment calls' terminal state", async () => {
        const batch = makeMutationCtx("p1", [gameStateSeed(mountainState(3))]);
        await runTapForPayment(batch.ctx, [
            { cardInstanceId: "m1" },
            { cardInstanceId: "m2" },
            { cardInstanceId: "m3" },
        ]);
        // One mutation call → exactly one seq bump (1 -> 2), not one per land.
        expect(batch.doc("gs-1").seq).toBe(2);

        const stepped = makeMutationCtx("p1", [
            gameStateSeed(mountainState(3)),
        ]);
        await runTapForPayment(stepped.ctx, [{ cardInstanceId: "m1" }]);
        await runTapForPayment(stepped.ctx, [{ cardInstanceId: "m2" }]);
        await runTapForPayment(stepped.ctx, [{ cardInstanceId: "m3" }]);
        // Three separate mutation calls → three seq bumps (1 -> 4).
        expect(stepped.doc("gs-1").seq).toBe(4);

        const batchState = batch.state();
        const steppedState = stepped.state();
        expect(batchState.players[0].manaPool).toEqual(
            steppedState.players[0].manaPool
        );
        expect(
            batchState.players[0].battlefield.map((c) => c.isTapped)
        ).toEqual(steppedState.players[0].battlefield.map((c) => c.isTapped));
        expect(batchState.pendingCast).toBeUndefined();
        expect(steppedState.pendingCast).toBeUndefined();
    });

    it("auto-commits mid-batch and ignores further (over-supplied) entries submitted in the SAME call", async () => {
        // Cost only needs 2 mana; a 3rd payment entry is over-supplied by a
        // stale client plan and must be silently ignored WITHIN this one
        // atomic submission, not error the already-successful cast.
        const seedState = mountainState(2);
        const extraLand = makeInstance(mountain.id, {
            id: "m3",
            controllerId: "p1",
        });
        // Mutate BEFORE seeding — the harness's `state()` reader expands the
        // persisted (possibly compact) doc on every read, which returns a
        // fresh object each time, not the seeded reference.
        seedState.players[0].battlefield.push(extraLand);
        const stub = makeMutationCtx("p1", [gameStateSeed(seedState)]);

        await runTapForPayment(stub.ctx, [
            { cardInstanceId: "m1" },
            { cardInstanceId: "m2" },
            { cardInstanceId: "m3" },
        ]);

        const state = stub.state();
        expect(state.pendingCast).toBeUndefined();
        // The mana was spent paying the cost on commit, not left floating.
        expect(state.players[0].manaPool.R ?? 0).toBe(0);
        expect(state.stack).toHaveLength(1);
        // The 3rd (over-supplied) land is never touched.
        expect(
            state.players[0].battlefield.find((c) => c.id === "m3")!.isTapped
        ).toBe(false);
    });
});

describe("tapForPayment batch — abort-whole-batch on first illegal element (issue #1779 review finding 3)", () => {
    it("throws on the first illegal payment and leaves the PERSISTED state completely untouched", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(mountainState(3))]);

        await expect(
            runTapForPayment(stub.ctx, [
                { cardInstanceId: "m1" },
                { cardInstanceId: "does-not-exist" }, // illegal — not on battlefield
                { cardInstanceId: "m2" },
            ])
        ).rejects.toThrow("Card not on battlefield");

        // The mutation clones `gameState.state` before looping and only calls
        // `saveGameState` after the WHOLE loop succeeds — a throw mid-batch
        // must leave the PERSISTED doc exactly as it was: seq unchanged, no
        // land tapped (not even m1, which "succeeded" inside the discarded
        // in-memory clone), no mana added.
        expect(stub.doc("gs-1").seq).toBe(1);
        const state = stub.state();
        expect(
            state.players[0].battlefield.find((c) => c.id === "m1")!.isTapped
        ).toBe(false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "m2")!.isTapped
        ).toBe(false);
        expect(state.players[0].manaPool.R ?? 0).toBe(0);
        expect(state.pendingCast).toBeDefined();
    });
});

describe("tapForPayment — batch vs. separate-call over-supply is an INTENTIONAL, tested divergence (issue #1779 review finding 4)", () => {
    // Decision: a surplus entry INSIDE one batched submission is harmless
    // (the same atomic client plan just over-shot) and is silently ignored —
    // covered above. A surplus entry as its OWN, SEPARATE `tapForPayment`
    // call is never silently ignored — it is ALWAYS rejected, through one of
    // two gates depending on whether priority moved away in between:
    //   1. Immediately after a commit, `commitSpellCast` hands priority to
    //      the OPPONENT (`getOpponentId`) — so a stale 3rd call from the
    //      caster is rejected by the OUTER Expected Input gate (ADR 0047)
    //      before it ever reaches the pendingCast-specific check.
    //   2. Once priority is back with the right player but nothing is being
    //      cast (the general "your priority, nothing pending" state — the
    //      `expect: "priority"` kind is OVERLOADED: it covers both "mid-
    //      payment" and "ordinary priority", so the outer gate alone can't
    //      tell them apart), the INNER `!state.pendingCast` check is what
    //      catches it, throwing "No spell being cast".
    // Both are exercised below so the "separate call is never silently
    // ignored" decision is pinned regardless of which gate ends up firing.
    it("a THIRD, separate tapForPayment call right after the cast committed is rejected — priority already moved to the opponent", async () => {
        const seedState = mountainState(2);
        const extraLand = makeInstance(mountain.id, {
            id: "m3",
            controllerId: "p1",
        });
        seedState.players[0].battlefield.push(extraLand);
        const stub = makeMutationCtx("p1", [gameStateSeed(seedState)]);

        await runTapForPayment(stub.ctx, [{ cardInstanceId: "m1" }]);
        await runTapForPayment(stub.ctx, [{ cardInstanceId: "m2" }]);
        expect(stub.state().pendingCast).toBeUndefined();
        expect(stub.state().stack).toHaveLength(1);
        // Committing handed priority to p2 — never silently absorbed.
        expect(stub.state().priorityPlayerId).toBe("p2");

        await expect(
            runTapForPayment(stub.ctx, [{ cardInstanceId: "m3" }])
        ).rejects.toThrow(/waiting for priority input from another player/i);
        // The stale extra call changed nothing.
        expect(
            stub.state().players[0].battlefield.find((c) => c.id === "m3")!
                .isTapped
        ).toBe(false);
    });

    it('a separate tapForPayment call with NOTHING being cast (ordinary priority) throws "No spell being cast"', async () => {
        // The `expect: "priority"` gate is overloaded — it also passes for
        // plain, nothing-pending priority — so THIS is the inner defensive
        // check a stale UI trips once priority genuinely is back with the
        // right player. Distinct from `selectTarget` (finding 6 / below in
        // `selectTargetsBatch.test.ts`), whose `expect: "target"` kind is
        // EXCLUSIVE to a live `pendingTarget` and so is always caught by the
        // outer gate instead — an inherent asymmetry, not a bug.
        const seedState = mountainState(1);
        // No cast in progress at all.
        seedState.pendingCast = undefined;
        const stub = makeMutationCtx("p1", [gameStateSeed(seedState)]);

        await expect(
            runTapForPayment(stub.ctx, [{ cardInstanceId: "m1" }])
        ).rejects.toThrow("No spell being cast");
    });
});

describe("tapForPayment batch — routes through the shared tap primitive (issue #1779 review finding 1)", () => {
    it("tapping Ancient Tomb through the BATCHED path costs 2 life, exactly like the manual/auto-tap paths (CR 605.1a / 106.4)", async () => {
        // Regression for the finding: `applyOneTapPayment` was a SECOND,
        // divergent copy of `tapSourceIntoPayment` that dropped every inline
        // rider — including Ancient Tomb's unconditional self-damage
        // (`applyUnconditionalTapSelfDamage`). Tapping it through the
        // pre-fix batched path cost 0 life; through the shared primitive
        // (`tapForActivationPayment` / `autoTapForPayment`) it costs 2. This
        // test proves the batched path now converges on the SAME primitive.
        const tomb = makeInstance(ancientTomb.id, {
            id: "tomb",
            controllerId: "p1",
            ownerId: "p1",
        });
        const cast = makeInstance(grizzlyBears.id, {
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "spell",
            manaCost: { C: 2 },
            tappedLandIds: [],
        };
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [tomb],
                    hand: [cast],
                    life: 20,
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            pendingCast,
        });
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runTapForPayment(stub.ctx, [{ cardInstanceId: "tomb" }]);

        const after = stub.state();
        expect(after.players[0].life).toBe(18);
        expect(
            after.players[0].battlefield.find((c) => c.id === "tomb")!.isTapped
        ).toBe(true);
        // The mana was spent on commit (cost fully covered by the single
        // tap), and the spell landed on the stack.
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack).toHaveLength(1);
    });
});
