// Impending, full path (CR 702.176a, issue #1970): the option the client
// offers off the projected hand, announced through the real `announceCast`
// mutation, stamps the stack item, and the permanent it becomes reaches the
// client as a noncreature Enchantment with five time counters.

import { describe, expect, it } from "vitest";
import { announceCast } from "@convex/game";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { overlordOfTheBalemurk } from "@convex/cards/sets/dsk/black.cards";
import { resolveTopOfStack, type GameState } from "@convex/gre/state";
import type { Id } from "@convex/_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "@convex/__tests__/gameMutationHarness.fixture";
import { affordableAltCostsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

const GAME_ID = "game-1" as Id<"games">;

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};

/** p1 in its main phase with the Overlord in hand and exactly {1}{B}
 *  floating — the impending cost, nowhere near the printed {3}{B}{B}. */
function board(): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(overlordOfTheBalemurk().id, {
                        id: "overlord",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    state.players[0].manaPool.B = 2;
    return state;
}

describe("Impending — GRE → wire → client → game.ts (CR 702.176a)", () => {
    it("the offered impending option, announced, enters as a noncreature with five time counters", async () => {
        const state = board();
        const projectedHand = projectPublicState(state, 1, "p1")
            .players as unknown as Player[];
        const card = projectedHand[0]!.hand.find(
            (c) => (c as CardInstance | null)?.id === "overlord"
        ) as CardInstance;
        const offered = affordableAltCostsForCard(
            card,
            "p1",
            projectedHand,
            "p1"
        ).map((a) => a.id);
        expect(offered).toContain("impending");

        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<AnnounceArgs, void>(
            announceCast as unknown as Handler<AnnounceArgs, void>,
            harness.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                cardInstanceId: "overlord",
                alternativeCostId: "impending",
            }
        );
        const after = harness.state();
        // The impending cost was what got paid.
        expect(after.players[0].manaPool.B).toBe(0);
        const item = after.stack.find((s) => s.id === "overlord");
        expect(item?.impended).toBe(true);

        resolveTopOfStack(after);
        const wire = projectPublicState(after, 1, "p2").players[0]!
            .battlefield as unknown as CardInstance[];
        const overlord = wire.find((c) => c.id === "overlord")!;
        expect(overlord.types).toEqual(["Enchantment"]);
        expect(overlord.counters?.time).toBe(5);
    });
});
