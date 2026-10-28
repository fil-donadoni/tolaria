// Integration tests for the `deselectTarget` mutation (issue #2302): un-pick a
// target of the CURRENT group of an open target selection (CR 601.2c — the
// choice is not final until the announcement completes). Drives the REGISTERED
// mutation's `_handler` through the shared stub harness, so the seat check,
// the expected-input assertion and `saveGameState` are all real.

import { describe, it, expect } from "vitest";
import { deselectTarget, selectTarget } from "../game";
import { makePlayer, makeState } from "../cards/__tests__/setup.helper";
import type { GameState, PendingTarget } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

type TargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
};

const runDeselect = (
    ctx: Parameters<typeof runMutation>[1],
    args: Pick<TargetArgs, "targetType" | "targetId"> &
        Partial<Pick<TargetArgs, "playerId">>
) =>
    runMutation<TargetArgs, void>(
        deselectTarget as unknown as Handler<TargetArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

const runSelect = (
    ctx: Parameters<typeof runMutation>[1],
    args: Pick<TargetArgs, "targetType" | "targetId">
) =>
    runMutation<TargetArgs, void>(
        selectTarget as unknown as Handler<TargetArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

function pendingState(overrides: Partial<PendingTarget> = {}): GameState {
    return makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
        pendingTarget: {
            playerId: "p1",
            cardInstanceId: "spell",
            targetType: "player",
            // Open-ended max — a pick never auto-finalizes.
            count: { min: 1, max: 5 },
            selected: [],
            ...overrides,
        },
    });
}

describe("deselectTarget (CR 601.2c, issue #2302)", () => {
    it("removes a picked target and offers it again as a legal pick", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(pendingState())]);
        await runSelect(stub.ctx, { targetType: "player", targetId: "p2" });
        await runSelect(stub.ctx, { targetType: "player", targetId: "p1" });
        // Distinct-targets (CR 601.2c): a repeat pick is refused while picked.
        await expect(
            runSelect(stub.ctx, { targetType: "player", targetId: "p2" })
        ).rejects.toThrow(/already been chosen/i);

        await runDeselect(stub.ctx, { targetType: "player", targetId: "p2" });
        expect(stub.state().pendingTarget!.selected).toEqual([
            { type: "player", id: "p1" },
        ]);

        // Legal again: re-picking is accepted.
        await runSelect(stub.ctx, { targetType: "player", targetId: "p2" });
        expect(stub.state().pendingTarget!.selected).toHaveLength(2);
    });

    it("never finalizes the selection", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(
                pendingState({
                    selected: [{ type: "player", id: "p2" }],
                })
            ),
        ]);
        await runDeselect(stub.ctx, { targetType: "player", targetId: "p2" });
        expect(stub.state().pendingTarget).toBeDefined();
        expect(stub.state().pendingTarget!.selected).toEqual([]);
    });

    it("touches only the current group — earlier groups' picks are unreachable", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(
                pendingState({
                    priorSelected: [{ type: "player", id: "p2" }],
                    selected: [{ type: "player", id: "p1" }],
                })
            ),
        ]);
        await expect(
            runDeselect(stub.ctx, { targetType: "player", targetId: "p2" })
        ).rejects.toThrow(/not currently selected/i);
        expect(stub.state().pendingTarget!.priorSelected).toEqual([
            { type: "player", id: "p2" },
        ]);
        await runDeselect(stub.ctx, { targetType: "player", targetId: "p1" });
        expect(stub.state().pendingTarget!.priorSelected).toEqual([
            { type: "player", id: "p2" },
        ]);
        expect(stub.state().pendingTarget!.selected).toEqual([]);
    });

    it("drops the target's divide amount so `divideAmounts` stays keyed to `selected`", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(
                pendingState({
                    divideTotal: 6,
                    selected: [
                        { type: "player", id: "p2" },
                        { type: "player", id: "p1" },
                    ],
                    divideAmounts: { "player:p2": 3, "player:p1": 2 },
                })
            ),
        ]);
        await runDeselect(stub.ctx, { targetType: "player", targetId: "p2" });
        expect(stub.state().pendingTarget!.divideAmounts).toEqual({
            "player:p1": 2,
        });
    });

    it("rejects a caller who does not own the named seat", async () => {
        const stub = makeMutationCtx("p2", [
            gameStateSeed(
                pendingState({ selected: [{ type: "player", id: "p2" }] })
            ),
        ]);
        await expect(
            runDeselect(stub.ctx, { targetType: "player", targetId: "p2" })
        ).rejects.toThrow(/cannot act as another player/i);
        expect(stub.state().pendingTarget!.selected).toHaveLength(1);
    });

    it("rejects when no target selection is pending", async () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            runDeselect(stub.ctx, { targetType: "player", targetId: "p2" })
        ).rejects.toThrow();
    });
});
