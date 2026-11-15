// The outside-game play permission through the REAL `game.ts` mutations
// (CR 400.11b — "You may play a card you own from outside the game this
// turn"; CR 116.2a / 305.2b — "play" includes lands, against the land drop).
//
//   CR 400.11   Outside the game is not a zone.
//   CR 400.11b  Some effects bring cards into a game from outside the game.
//
// The permission is set the way an effect sets it — the `grantOutsideGamePlays`
// SpellContext primitive — and the cast / land play go through `announceCast` /
// `playCard`'s own `_handler` (`gameMutationHarness.fixture.ts`), so
// `locateCastSource`, `resolvePlayLandSourceZone`, `assertLegalAction`, the
// commit and the persistence round-trip are all the production ones.

import { describe, expect, it } from "vitest";
import { announceCast, playCard } from "../game";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import { forest } from "../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import {
    buildSpellContext,
    type GameState,
    type StackItem,
} from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

type CardArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const run =
    (mutation: unknown) =>
    (ctx: Parameters<typeof runMutation>[1], cardInstanceId: string) =>
        runMutation<CardArgs, void>(mutation as Handler<CardArgs, void>, ctx, {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId,
        });
const runAnnounceCast = run(announceCast);
const runPlayCard = run(playCard);

const pool = (defId: string, id: string) =>
    makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "exile",
    });

/** p1's precombat main, {G}{G} floating, and Grizzly Bears plus a Forest
 *  outside the game; `grant` plays from outside the game set through the
 *  primitive. */
function position(grant: number): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
                outsideGame: [
                    pool(grizzlyBears().id, "sb-bears"),
                    pool(forest().id, "sb-forest"),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    if (grant > 0) {
        // The resolving spell whose effect grants the permission (issue #9473
        // ships the Op; here the primitive is driven directly).
        const granter: StackItem = {
            ...makeInstance(grizzlyBears().id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            targets: [],
        };
        buildSpellContext(state, granter).grantOutsideGamePlays("p1", grant);
    }
    return state;
}

describe("announceCast — a card cast from outside the game (CR 400.11b)", () => {
    it("moves the pool card onto the stack, pays its mana cost, and spends the permission", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(position(1))]);

        await runAnnounceCast(harness.ctx, "sb-bears");

        const after = harness.state();
        expect(after.stack.map((s) => s.id)).toEqual(["sb-bears"]);
        expect(after.stack[0]!.castFromZone).toBe("outsideGame");
        // Normal cost: the floating {G}{G} paid {1}{G}.
        expect(after.players[0]!.manaPool.G).toBe(0);
        expect(after.players[0]!.outsideGame?.map((c) => c.id)).toEqual([
            "sb-forest",
        ]);
        // Exactly one card: the permission is gone.
        expect(after.outsideGamePlaysThisTurn).toBeUndefined();
    });

    it("refuses the cast without the permission, and the card stays outside the game", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(position(0))]);

        await expect(
            runAnnounceCast(harness.ctx, "sb-bears")
        ).rejects.toThrow();
        expect(harness.state().players[0]!.outsideGame).toHaveLength(2);
        expect(harness.state().stack).toHaveLength(0);
    });
});

describe("playCard — a land played from outside the game (CR 116.2a / 305.2b)", () => {
    it("puts the land onto the battlefield, uses the land drop, and spends the permission", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(position(1))]);

        await runPlayCard(harness.ctx, "sb-forest");

        const p1 = harness.state().players[0]!;
        expect(p1.battlefield.map((c) => c.id)).toContain("sb-forest");
        expect(p1.landsPlayedThisTurn).toBe(1);
        expect(p1.hand).toHaveLength(0);
        expect(p1.outsideGame?.map((c) => c.id)).toEqual(["sb-bears"]);
        expect(harness.state().outsideGamePlaysThisTurn).toBeUndefined();
    });

    it("refuses the play once the land drop is used (CR 305.2b), leaving the permission unspent", async () => {
        const state = position(1);
        state.players[0]!.landsPlayedThisTurn = 1;
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await expect(runPlayCard(harness.ctx, "sb-forest")).rejects.toThrow();
        expect(harness.state().players[0]!.outsideGame).toHaveLength(2);
        expect(harness.state().outsideGamePlaysThisTurn).toEqual({ p1: 1 });
    });
});
