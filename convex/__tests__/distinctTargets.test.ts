// CR 601.2c — every target chosen for a SINGLE instance of the word "target"
// must be distinct (a `count > 1` `TargetRequirement` models ONE instance
// with N targets, never N independent instances). This is a general engine
// invariant, not a card-specific check — the bot path (`legalActions.ts`)
// already implemented it (`getLegalTargets` review); this file proves the
// HUMAN path end to end through the real `selectTarget` mutation, the exact
// boundary a card-level test cannot exercise (Magma Burst's kicked "another
// target": clicking the same opponent's avatar twice must not deal 6 damage
// to one target).
//
// Same harness discipline as `selectTargetsBatch.test.ts` — this project has
// no convex-test harness, so the established seam for `game.ts` mutation
// coverage is a stub `MutationCtx` driving the REGISTERED mutation's own
// `_handler` (`gameMutationHarness.ts`).

import { describe, it, expect } from "vitest";
import { selectTarget } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { blackLotus } from "../cards/sets/lea/colorless";
import type { GameState, PendingTarget } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
    targetPlayerId?: string;
    amount?: number;
};

const runSelectTarget = (
    ctx: Parameters<typeof runMutation>[1],
    target: Omit<SelectTargetArgs, "gameId" | "playerId">
) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...target }
    );

/** A 2-target "any target" pending selection (Magma Burst's kicked mode
 *  shape — `kickedTargetRequirement: { type: "any", count: 2 }`). */
function twoTargetAnyState(overrides: Partial<PendingTarget> = {}): GameState {
    const pendingTarget: PendingTarget = {
        playerId: "p1",
        cardInstanceId: "spell",
        targetType: "any",
        count: 2,
        selected: [],
        ...overrides,
    };
    return makeState({
        players: [
            makePlayer("p1", { life: 20 }),
            makePlayer("p2", { life: 20 }),
        ],
        pendingTarget,
    });
}

describe("selectTarget — distinct targets within one requirement (CR 601.2c)", () => {
    it("rejects picking the SAME player twice for a 2-target requirement (Magma Burst's kicked 'another target')", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(twoTargetAnyState()),
        ]);
        await runSelectTarget(harness.ctx, {
            targetType: "player",
            targetId: "p2",
        });
        // Two-target requirement, one pick made — still mid-selection.
        expect(harness.state().pendingTarget?.selected).toHaveLength(1);

        await expect(
            runSelectTarget(harness.ctx, {
                targetType: "player",
                targetId: "p2",
            })
        ).rejects.toThrow(/already been chosen/);

        // The rejected duplicate never landed — still exactly one selection,
        // and (the actual failure mode this closes) a single p2 could never
        // silently accumulate two damage instances from one spell.
        expect(harness.state().pendingTarget?.selected).toHaveLength(1);
    });

    it("accepts two DIFFERENT players for the same 2-target requirement", async () => {
        // Open-ended max (not reached at 2 picks), so target selection
        // doesn't auto-finalize through the cast-commit path (which needs a
        // real hand card this harness doesn't seed) — mirrors
        // `selectTargetsBatch.test.ts`'s `pendingTargetState` convention.
        // The distinctness check under test doesn't care about count shape.
        const harness = makeMutationCtx("p1", [
            gameStateSeed(twoTargetAnyState({ count: { min: 2, max: 5 } })),
        ]);
        await runSelectTarget(harness.ctx, {
            targetType: "player",
            targetId: "p2",
        });
        await runSelectTarget(harness.ctx, {
            targetType: "player",
            targetId: "p1",
        });
        expect(
            harness
                .state()
                .pendingTarget?.selected.map((s) => s.id)
                .sort()
        ).toEqual(["p1", "p2"]);
    });

    it("rejects picking the SAME permanent twice for a 2-target requirement (Dust to Dust's 'two target artifacts' shape)", async () => {
        const state = twoTargetAnyState({ targetType: "Artifact" });
        state.players[0].battlefield.push(
            makeInstance(blackLotus.id, {
                id: "art1",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runSelectTarget(harness.ctx, {
            targetType: "permanent",
            targetId: "art1",
        });
        await expect(
            runSelectTarget(harness.ctx, {
                targetType: "permanent",
                targetId: "art1",
            })
        ).rejects.toThrow(/already been chosen/);
    });
});
