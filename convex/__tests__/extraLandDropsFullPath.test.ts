// "You may play an additional land this turn." (Explore) end to end — CR
// 305.2 / 514.2, issue #7220.
//
// The compiled Explore (`grantExtraLandDrops` + `draw`) driven through the
// REAL `game.ts` mutations: `announceCast` → both players pass → the
// resolved grant → `playCard` accepts the land the spent drop would have
// refused, and refuses the one after it (CR 305.2b). Then the wire view
// shows the land on the battlefield.

import { describe, expect, it } from "vitest";
import { announceCast, passPriority, playCard } from "../game";
import { getCardByName } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { projectPublicState } from "../gameProjections";
import { getPlayer, type GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type MutationStub,
} from "./gameMutationHarness.fixture";

const GAME = "game-1" as Id<"games">;
const ME = "u-p1";
const OPP = "u-p2";

const card = (
    name: string,
    instanceId: string,
    owner: string,
    zone: "hand" | "library"
) =>
    makeInstance(getCardByName(name).id, {
        id: instanceId,
        controllerId: owner,
        ownerId: owner,
        zone,
    });

/** ME has played this turn's land and holds Explore and two Forests. */
function board(): GameState {
    const state = makeState({
        players: [
            makePlayer(ME, {
                hand: [
                    card("Explore", "explore", ME, "hand"),
                    card("Forest", "forest-a", ME, "hand"),
                    card("Forest", "forest-b", ME, "hand"),
                ],
                library: [card("Island", "my-lib-0", ME, "library")],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1 },
            }),
            makePlayer(OPP, {
                library: [card("Island", "opp-lib-0", OPP, "library")],
            }),
        ],
        activePlayerId: ME,
        priorityPlayerId: ME,
    });
    getPlayer(state, ME).landsPlayedThisTurn = 1;
    return state;
}

function call(
    harness: MutationStub,
    fn: unknown,
    args: Record<string, unknown>
): Promise<unknown> {
    return runMutation<Record<string, unknown>, unknown>(fn, harness.ctx, {
        gameId: GAME,
        ...args,
    });
}

async function passUntilResolved(harness: MutationStub): Promise<void> {
    for (let guard = 0; guard < 6; guard++) {
        const live = harness.state();
        if (live.stack.length === 0) return;
        await call(harness, passPriority, {
            playerId: live.priorityPlayerId,
        });
    }
    throw new Error("the stack never emptied");
}

describe("Explore through the game mutations (CR 305.2, issue #7220)", () => {
    it("a spent land drop refuses the play until Explore resolves", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);
        await expect(
            call(harness, playCard, {
                playerId: ME,
                cardInstanceId: "forest-a",
            })
        ).rejects.toThrow(`Illegal action "play" on "Forest"`);
    });

    it("Explore grants exactly one more play this turn", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);
        await call(harness, announceCast, {
            playerId: ME,
            cardInstanceId: "explore",
        });
        await passUntilResolved(harness);
        expect(harness.state().extraLandDropsThisTurn).toEqual([
            { playerId: ME, count: 1 },
        ]);

        await call(harness, playCard, {
            playerId: ME,
            cardInstanceId: "forest-a",
        });
        // CR 305.2b — two plays allowed, two made: the next is refused.
        await expect(
            call(harness, playCard, {
                playerId: ME,
                cardInstanceId: "forest-b",
            })
        ).rejects.toThrow(`Illegal action "play" on "Forest"`);

        const state = harness.state();
        expect(getPlayer(state, ME).landsPlayedThisTurn).toBe(2);
        expect(
            projectPublicState(state, 1, ME).players[0].battlefield.map(
                (c) => c.id
            )
        ).toEqual(["forest-a"]);
    });
});
