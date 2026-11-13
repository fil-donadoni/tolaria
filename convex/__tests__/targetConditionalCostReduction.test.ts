// Mystical Dispute — "This spell costs {2} less to cast if it targets a blue
// spell" (CR 601.2c / 601.2f) through the FULL `game.ts` mutation path: the
// targets are chosen first (`selectTarget`), then the commit prices the cast
// against them (`finalizeTargetSelection` → `getCostModifiers`). Same harness
// discipline as `bolassCitadelCastPath.test.ts`.

import { describe, it, expect } from "vitest";
import { announceCast, selectTarget } from "../game";
import { mysticalDispute } from "../cards/sets/eld/blue.cards";
import { counterspell } from "../cards/sets/lea/blue.cards";
import { lightningBolt } from "../cards/sets/lea/red.cards";
import { island } from "../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../cards/__tests__/setup.helper";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    type GameState,
} from "../gre/state";
import { preloadDefinitions } from "../cards/registry";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

// A new hand-written card is absent from the clean-tree catalogue registry.
preloadDefinitions([mysticalDispute()]);

const GAME_ID = "game-1" as Id<"games">;

type Ctx = Parameters<typeof runMutation>[1];

const runAnnounceCast = (ctx: Ctx, cardInstanceId: string) =>
    runMutation<
        { gameId: Id<"games">; playerId: string; cardInstanceId: string },
        void
    >(
        announceCast as unknown as Handler<
            { gameId: Id<"games">; playerId: string; cardInstanceId: string },
            void
        >,
        ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );

const runSelectSpell = (ctx: Ctx, targetId: string) =>
    runMutation<
        {
            gameId: Id<"games">;
            playerId: string;
            targetType: "spell";
            targetId: string;
        },
        void
    >(
        selectTarget as unknown as Handler<
            {
                gameId: Id<"games">;
                playerId: string;
                targetType: "spell";
                targetId: string;
            },
            void
        >,
        ctx,
        { gameId: GAME_ID, playerId: "p1", targetType: "spell", targetId }
    );

/** p1 holds Mystical Dispute with `islands` untapped Islands; p2's spells
 *  `blue-spell` (Counterspell) and `red-spell` (Lightning Bolt) are on the
 *  stack. */
function disputeState(islands: number): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(mysticalDispute().id, {
                        id: "dispute",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: Array.from({ length: islands }, (_, i) =>
                    makeInstance(island().id, {
                        id: `island-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p2",
        priorityPlayerId: "p1",
    });
    const blue = pushSpell(state, counterspell().id, "p2");
    blue.id = "blue-spell";
    const red = pushSpell(state, lightningBolt().id, "p2");
    red.id = "red-spell";
    return state;
}

describe("Mystical Dispute — target-conditional self cost reduction (CR 601.2c / 601.2f)", () => {
    it("targeting a blue spell, the locked-in cost is {U}", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(disputeState(1))]);

        await runAnnounceCast(harness.ctx, "dispute");
        await runSelectSpell(harness.ctx, "blue-spell");

        // The commit parks the cast awaiting mana payment (CR 601.2h) with the
        // total cost locked in (CR 601.2f).
        expect(harness.state().pendingCast?.manaCost).toEqual({ U: 1 });
    });

    it("targeting a non-blue spell, the locked-in cost stays {2}{U}", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(disputeState(3))]);

        await runAnnounceCast(harness.ctx, "dispute");
        await runSelectSpell(harness.ctx, "red-spell");

        expect(harness.state().pendingCast?.manaCost).toEqual({ U: 1, X: 2 });
    });
});

describe("Mystical Dispute — pricing probe (CR 601.2f)", () => {
    const priceWith = (
        state: GameState,
        targets?: { type: "spell"; id: string }[]
    ) => {
        const view = makeInstance(mysticalDispute().id, {
            id: "dispute-view",
            controllerId: "p1",
            zone: "hand",
        });
        const cost = normalizeManaCost(mysticalDispute().manaCost ?? {});
        applyCostModifiers(
            cost,
            getCostModifiers(state, view, "spell", undefined, "p1", targets)
        );
        return cost;
    };

    it("a probe with no announced target reduces while a blue spell is on the stack", () => {
        expect(priceWith(disputeState(1))).toEqual({ U: 1 });
    });

    it("a probe with no announced target keeps the full cost on an empty stack", () => {
        const state = disputeState(1);
        state.stack = [];
        expect(priceWith(state)).toEqual({ X: 2, U: 1 });
    });

    it("announced targets decide: red target full, blue target reduced", () => {
        const state = disputeState(1);
        expect(priceWith(state, [{ type: "spell", id: "red-spell" }])).toEqual({
            X: 2,
            U: 1,
        });
        expect(priceWith(state, [{ type: "spell", id: "blue-spell" }])).toEqual(
            { U: 1 }
        );
    });
});
