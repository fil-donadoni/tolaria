// Trinisphere through the real cast path — CR 601.2f. The affordance gate
// (`getLegalActions`) and the payment (`announceCast`) must price Sol Ring
// ({1}) at three under an untapped Trinisphere, and agree.

import { describe, it, expect } from "vitest";
import { announceCast } from "../../game";
import { getLegalActions } from "../rules";
import { getPlayer, type GameState } from "../state";
import { solRing } from "../../cards/sets/lea/colorless.cards";
import { trinisphere } from "../../cards/sets/dst/colorless.cards";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../../cards/registry";

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

function board(pool: number, trinisphereTapped = false): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(solRing().id, {
                        id: "ring",
                        zone: "hand",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: pool },
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(trinisphere().id, {
                        id: "trini",
                        controllerId: "p2",
                        ownerId: "p2",
                        isTapped: trinisphereTapped,
                    }),
                ],
            }),
        ],
    });
}

const offersCast = (state: GameState) =>
    getLegalActions(
        state,
        getPlayer(state, "p1"),
        getPlayer(state, "p1").hand[0],
        false,
        "p1"
    ).includes("cast");

describe("Trinisphere cast path (CR 601.2f)", () => {
    it("refuses a {1} spell with two mana and offers it with three", () => {
        withTemporaryDefinition(trinisphere(), () => {
            expect(offersCast(board(2))).toBe(false);
            expect(offersCast(board(3))).toBe(true);
        });
    });

    it("offers the {1} spell with one mana once Trinisphere is tapped", () => {
        withTemporaryDefinition(trinisphere(), () => {
            expect(offersCast(board(1, true))).toBe(true);
        });
    });

    it("charges exactly three when the spell is announced", async () => {
        await withTemporaryDefinitionAsync(trinisphere(), async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board(3))]);
            await runMutation<AnnounceArgs, void>(
                announceCast as unknown as Handler<AnnounceArgs, void>,
                harness.ctx,
                {
                    gameId: "game-1" as Id<"games">,
                    playerId: "p1",
                    cardInstanceId: "ring",
                }
            );
            const after = harness.state();
            expect(after.pendingCast).toBeUndefined();
            expect(after.stack.map((s) => s.id)).toEqual(["ring"]);
            expect(getPlayer(after, "p1").manaPool.C).toBe(0);
        });
    });
});
