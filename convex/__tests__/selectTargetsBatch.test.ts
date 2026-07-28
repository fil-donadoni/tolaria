// Integration tests for the batched `selectTargets` mutation (issue #1779 /
// PRD #1776 T4): a full ordered array of target selections applied in ONE
// transaction, instead of one `selectTarget` mutation per target — including
// preservation of per-target divide-as-you-choose amounts (CR 601.2d / 120.4).
//
// Same harness discipline as `seatOwnership.test.ts` / `limitedPairingMatch.
// test.ts` — this project has no convex-test harness, so the established
// seam for `game.ts` mutation coverage is a stub `MutationCtx` driving the
// REGISTERED mutation's own `_handler` (`gameMutationHarness.ts`). An earlier
// revision of this file reimplemented the batch loop inline and asserted
// against a hand-mutated clone — that never drove `saveGameState`, so the
// issue's actual requirement (one `seq` bump per batched submission, no
// partial persisted write on a mid-batch throw) went untested, and the
// "batch matches step-by-step" tests drove BOTH sides through the same
// helper, which cannot detect a real divergence between the two paths.
// Fixed per issue #1779 review findings 2-6.

import { describe, it, expect } from "vitest";
import { selectTarget, selectTargets } from "../game";
import { raiseTriggerTargetSelection } from "../gre/rules";
import { makePlayer, makeState, pushSpell } from "../cards/__tests__/setup";
import { mountain } from "../cards/sets/lea";
import type { GameState, PendingTarget, StackItem } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type TargetItem = {
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
    targetPlayerId?: string;
    amount?: number;
};

type SelectTargetsArgs = {
    gameId: Id<"games">;
    playerId: string;
    targets: TargetItem[];
};

type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
} & TargetItem;

const runSelectTargets = (
    ctx: Parameters<typeof runMutation>[1],
    targets: TargetItem[]
) =>
    runMutation<SelectTargetsArgs, void>(
        selectTargets as unknown as Handler<SelectTargetsArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", targets }
    );

const runSelectTarget = (
    ctx: Parameters<typeof runMutation>[1],
    target: TargetItem
) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...target }
    );

function pendingTargetState(overrides: Partial<PendingTarget> = {}): GameState {
    const pendingTarget: PendingTarget = {
        playerId: "p1",
        cardInstanceId: "spell",
        targetType: "player",
        // Open-ended max — 2-3 selections never auto-finalize.
        count: { min: 1, max: 5 },
        selected: [],
        ...overrides,
    };
    return makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
        pendingTarget,
    });
}

/** A single untargeted `kind: "trigger"` prompt carrying a divide-as-you-
 *  choose budget (CR 601.2d / 603.3d) — the SAME shared `divideBudgetSpent`
 *  -> `advanceTargetGroupOrFinalize` -> `applyOneTargetSelection` path a real
 *  divide spell's cast-commit finalize takes, without also having to stand
 *  up `finalizeTargetSelection`'s cast-commit machinery (real hand card,
 *  mana, stack placement) — orthogonal to what this batching change touches
 *  (real production divide traffic isn't only spells either: Fury's
 *  triggered-ability divide prompt takes this exact "trigger" branch).
 *  `inlineTargetRequirement` (reflexive-trigger shape) means no card-def
 *  ability is ever consulted, so any real card id works as the stack item's
 *  identity. */
function singleDivideTriggerState(
    divideTotal: number,
    count: PendingTarget["count"],
    playerIds: string[] = ["p1", "p2"]
): GameState {
    const state = makeState({
        players: playerIds.map((id) => makePlayer(id)),
    });
    const item = pushSpell(state, mountain.id, "p1");
    item.id = "trig";
    item.targets = undefined;
    item.inlineTargetRequirement = {
        type: "player",
        count,
        divideAsChosen: { total: divideTotal },
    };
    expect(raiseTriggerTargetSelection(state)).toBe(true);
    return state;
}

describe("selectTargets batch — single seq bump (issue #1779 review findings 2 & 4)", () => {
    it("a 2-target batch produces exactly ONE seq bump and matches 2 sequential single-target calls' terminal state", async () => {
        const batch = makeMutationCtx("p1", [
            gameStateSeed(pendingTargetState()),
        ]);
        await runSelectTargets(batch.ctx, [
            { targetType: "player", targetId: "p2" },
            { targetType: "player", targetId: "p1" },
        ]);
        // One mutation call → exactly one seq bump (1 -> 2), not one per
        // target — the issue's core requirement.
        expect(batch.doc("gs-1").seq).toBe(2);

        // Step-by-step: TWO SEPARATE real `selectTarget` mutation calls —
        // what the client did before batching existed. Driving both sides
        // through independent calls (not the same shared loop helper) is
        // what actually proves the two paths converge (finding 4).
        const stepped = makeMutationCtx("p1", [
            gameStateSeed(pendingTargetState()),
        ]);
        await runSelectTarget(stepped.ctx, {
            targetType: "player",
            targetId: "p2",
        });
        await runSelectTarget(stepped.ctx, {
            targetType: "player",
            targetId: "p1",
        });
        expect(stepped.doc("gs-1").seq).toBe(3);

        expect(batch.state().pendingTarget!.selected).toEqual(
            stepped.state().pendingTarget!.selected
        );
        expect(batch.state().pendingTarget!.selected).toEqual([
            { type: "player", id: "p2" },
            { type: "player", id: "p1" },
        ]);
    });

    it("preserves per-target divide-as-you-choose amounts across the batch (CR 601.2d)", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(pendingTargetState({ divideTotal: 6 })),
        ]);
        await runSelectTargets(stub.ctx, [
            { targetType: "player", targetId: "p2", amount: 3 },
            { targetType: "player", targetId: "p1", amount: 2 },
        ]);

        const state = stub.state();
        expect(state.pendingTarget!.divideAmounts).toEqual({
            "player:p2": 3,
            "player:p1": 2,
        });
        // Budget not fully spent (5/6) — selection stays open, matching the
        // same-shape one-at-a-time behavior.
        expect(state.pendingTarget).toBeDefined();
    });
});

describe("selectTargets batch — CR 601.2d full-budget auto-finalize (issue #1779 review finding 5)", () => {
    // The only PRODUCTION caller of `selectTargets` for a divide spell is
    // `useDivideBuffer.submit`, gated on `canSubmit` = the FULL budget
    // assigned — it never sends a partial batch. The pre-fix tests only
    // covered a deliberately-unspent budget (finalize never fires), which
    // never exercises `divideBudgetSpent` -> `advanceTargetGroupOrFinalize`,
    // the only path real traffic takes.
    it("a full-budget batch auto-finalizes on the LAST entry, exactly like `useDivideBuffer.submit`'s real traffic", async () => {
        const seedState = singleDivideTriggerState(6, { min: 1, max: 3 });
        const stub = makeMutationCtx("p1", [gameStateSeed(seedState)]);

        await runSelectTargets(stub.ctx, [
            { targetType: "player", targetId: "p2", amount: 4 },
            { targetType: "player", targetId: "p1", amount: 2 },
        ]);

        const state = stub.state();
        // The whole budget (6/6) was assigned on the last entry — the
        // selection finalizes INSIDE the batch, same as two individual
        // `selectTarget` calls would (the second one crossing the budget and
        // finalizing): `pendingTarget` clears, and the answered prompt
        // recorded BOTH targets, in order, with their amounts.
        expect(state.pendingTarget).toBeUndefined();
        const trig = state.stack.find((s) => s.id === "trig")!;
        expect(trig.targets).toEqual([
            { type: "player", id: "p2" },
            { type: "player", id: "p1" },
        ]);
        expect(trig.targetAmounts).toEqual({
            "player:p2": 4,
            "player:p1": 2,
        });
    });

    it("a >2-target full-budget batch preserves selection ORDER and per-target amounts through auto-finalize", async () => {
        // 3 targets, budget spent exactly on the 3rd — covers the ordering
        // requirement explicitly (not just "any 2 targets").
        const seedState = singleDivideTriggerState(6, { min: 1, max: 3 }, [
            "p1",
            "p2",
            "p3",
        ]);
        const stub = makeMutationCtx("p1", [gameStateSeed(seedState)]);

        await runSelectTargets(stub.ctx, [
            { targetType: "player", targetId: "p2", amount: 1 },
            { targetType: "player", targetId: "p3", amount: 2 },
            { targetType: "player", targetId: "p1", amount: 3 },
        ]);

        const state = stub.state();
        expect(state.pendingTarget).toBeUndefined();
        const trig = state.stack.find((s) => s.id === "trig")!;
        // Order is exactly as submitted — 1st entry first, never re-sorted.
        expect(trig.targets).toEqual([
            { type: "player", id: "p2" },
            { type: "player", id: "p3" },
            { type: "player", id: "p1" },
        ]);
        expect(trig.targetAmounts).toEqual({
            "player:p2": 1,
            "player:p3": 2,
            "player:p1": 3,
        });
    });
});

describe("selectTargets batch — abort-whole-batch on first illegal element (issue #1779 review finding 3)", () => {
    it("throws on the first illegal target and leaves the PERSISTED state completely untouched", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(pendingTargetState()),
        ]);

        await expect(
            runSelectTargets(stub.ctx, [
                { targetType: "player", targetId: "p2" },
                { targetType: "player", targetId: "no-such-player" }, // illegal
                { targetType: "player", targetId: "p1" },
            ])
        ).rejects.toThrow("Invalid player target");

        // The mutation clones `gameState.state` before looping and only
        // calls `saveGameState` after the WHOLE loop succeeds — a throw
        // mid-batch must leave the PERSISTED doc exactly as it was: seq
        // unchanged, no target recorded (not even the p2 pick that
        // "succeeded" inside the discarded in-memory clone).
        expect(stub.doc("gs-1").seq).toBe(1);
        expect(stub.state().pendingTarget!.selected).toEqual([]);
    });
});

describe("selectTargets — batch vs. separate-call over-supply is an INTENTIONAL, tested divergence (issue #1779 review finding 4)", () => {
    // Same decision as `tapForPaymentBatch.test.ts`: a surplus entry INSIDE
    // one batched submission is harmless (silently ignored, covered above);
    // a surplus entry as its OWN, SEPARATE `selectTarget` call is NEVER
    // silently ignored. Unlike `tapForPayment`'s `expect: "priority"` (which
    // is overloaded — it also matches plain nothing-pending priority), the
    // `expect: "target"` Expected Input kind is EXCLUSIVE to a live
    // `pendingTarget` (`computeExpectedInput` only returns it when
    // `state.pendingTarget` is set). So a genuinely separate call after the
    // selection already finalized is caught by the OUTER Expected Input gate
    // (ADR 0047) — it never even reaches `applyOneTargetSelection`'s inner
    // `"No target selection in progress"` check, which is unreachable
    // through this mutation's real entry point (that check exists for the
    // BATCH's own multi-entry loop, where finding 6's identity guard is what
    // actually protects it).
    it("a separate selectTarget call after the selection already finalized is rejected by the outer Expected Input gate", async () => {
        const seedState = singleDivideTriggerState(4, { min: 1, max: 1 });
        const stub = makeMutationCtx("p1", [gameStateSeed(seedState)]);

        await runSelectTarget(stub.ctx, {
            targetType: "player",
            targetId: "p2",
            amount: 4,
        });
        expect(stub.state().pendingTarget).toBeUndefined();

        await expect(
            runSelectTarget(stub.ctx, {
                targetType: "player",
                targetId: "p1",
                amount: 1,
            })
        ).rejects.toThrow(/waiting for priority input, not target/i);
    });
});

describe("selectTargets batch — the abort guard rejects a surplus entry spilling onto a NEW prompt (issue #1779 review finding 6)", () => {
    // Real bug: the pre-fix guard was only `!state.pendingTarget`. Finalizing
    // the FIRST target selection in a batch can immediately raise a NEW
    // `pendingTarget` for a chained targeted trigger
    // (`raiseTriggerTargetSelection`, CR 603.3d) — a prompt this batch never
    // knew about. The old guard passed (pendingTarget is truthy again, just
    // a DIFFERENT one) and silently applied the surplus entry to the wrong
    // selection. A single-call `selectTarget` cannot do this — each call
    // reads state fresh for its OWN prompt.
    function twoUntargetedTriggers(): GameState {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // Bottom of stack: pushed first, so it sits BELOW "top" — the
        // trigger `raiseTriggerTargetSelection` finds SECOND (it scans
        // top-down). Any real card id works; `inlineTargetRequirement`
        // (reflexive-trigger shape, CR 603.3d) overrides the lookup so no
        // card-def ability is ever consulted.
        const bottom: StackItem = pushSpell(state, mountain.id, "p1");
        bottom.id = "trig-bottom";
        bottom.targets = undefined;
        bottom.inlineTargetRequirement = { type: "player", count: 1 };

        const top: StackItem = pushSpell(state, mountain.id, "p1");
        top.id = "trig-top";
        top.targets = undefined;
        top.inlineTargetRequirement = { type: "player", count: 1 };

        // Raise the FIRST pendingTarget (for "trig-top") exactly like the
        // engine does right after both triggers went on the stack — outside
        // the mutation under test, mirroring how a real chained-trigger
        // prompt is already live before the player's first `selectTargets`
        // call.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget!.cardInstanceId).toBe("trig-top");
        return state;
    }

    it("rejects a 2nd batch entry that would land on the NEWLY-raised prompt for the next trigger, instead of misapplying it", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(twoUntargetedTriggers()),
        ]);

        // Entry 1 fills "trig-top"'s single mandatory target and finalizes
        // it, which chains straight into raising a pendingTarget for
        // "trig-bottom". Entry 2 was written for the ORIGINAL ("trig-top")
        // prompt and must be REJECTED, not silently answer "trig-bottom".
        await expect(
            runSelectTargets(stub.ctx, [
                { targetType: "player", targetId: "p2" },
                { targetType: "player", targetId: "p1" },
            ])
        ).rejects.toThrow(
            "Target selection was already completed by an earlier entry in this batch"
        );

        // Nothing persisted — the whole batch aborted, including the first
        // (individually legal) entry.
        expect(stub.doc("gs-1").seq).toBe(1);
    });

    it("a batch with only the ONE entry the opened prompt needs still finalizes cleanly and chains to the next trigger's prompt", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(twoUntargetedTriggers()),
        ]);

        await runSelectTargets(stub.ctx, [
            { targetType: "player", targetId: "p2" },
        ]);

        const state = stub.state();
        // "trig-top" got its target…
        const top = state.stack.find((s) => s.id === "trig-top")!;
        expect(top.targets).toEqual([{ type: "player", id: "p2" }]);
        // …and the chain raised a NEW prompt for "trig-bottom" — this batch
        // is done (1 entry, 1 seq bump), the new prompt awaits its OWN call.
        expect(state.pendingTarget).toBeDefined();
        expect(state.pendingTarget!.cardInstanceId).toBe("trig-bottom");
        expect(stub.doc("gs-1").seq).toBe(2);
    });
});
