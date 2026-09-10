// CR 106.4 / 701.43b — the exert an ability's cost leg paid is reversed when
// the payment tap that paid it is undone, on EVERY reversal path.
//
// The activation-side rollback funnels through `untapSourceFromPayment`; the
// CAST side carries two inline copies of the same untap (`rollbackPendingCast`
// for the whole payment, `untapForPayment` for one land) and had to restate the
// reversal. This suite drives the registered mutation, because that duplication
// is exactly what a unit test on the shared helper cannot see.

import { describe, it, expect } from "vitest";
import { untapForPayment, cancelCast, tapSourceIntoPayment } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { arenaOfGlory } from "../cards/sets/mh3/colorless";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

/** Index of "{R}, {T}, Exert this land: Add {R}{R}" in Arena of Glory's
 *  declared ability order — the list `manaChoiceIndex` resolves against. */
const EXERT_ABILITY_INDEX = 1;

function castPaymentState(): GameState {
    const arena = makeInstance(arenaOfGlory.id, {
        id: "arena",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1", { battlefield: [arena] }), makePlayer("p2")],
    });
    state.players[0].manaPool.R = 1;
    // Pay the exert leg into the cast the way `tapForPayment` does.
    tapSourceIntoPayment(
        state,
        state.players[0],
        arena,
        EXERT_ABILITY_INDEX,
        []
    );
    state.pendingCast = {
        playerId: "p1",
        cardInstanceId: "spell",
        manaCost: { R: 3 },
        tappedLandIds: ["arena"],
    };
    return state;
}

describe("exert reversal on the CAST payment path (CR 106.4 / 701.43b)", () => {
    it("untapping a land tapped for a cast un-exerts it", async () => {
        const seeded = castPaymentState();
        const arenaBefore = seeded.players[0].battlefield[0];
        expect(arenaBefore.skipNextUntap).toBe(true);
        expect(arenaBefore.exertedThisTap).toBe(true);

        const h = makeMutationCtx("p1", [gameStateSeed(seeded)]);
        await runMutation<
            { gameId: Id<"games">; playerId: string; cardInstanceId: string },
            void
        >(
            untapForPayment as unknown as Handler<
                {
                    gameId: Id<"games">;
                    playerId: string;
                    cardInstanceId: string;
                },
                void
            >,
            h.ctx,
            { gameId: GAME_ID, playerId: "p1", cardInstanceId: "arena" }
        );

        const arena = h.state().players[0].battlefield[0];
        expect(arena.isTapped).toBe(false);
        // The spell was never cast: the land must not miss its next untap step.
        expect(arena.skipNextUntap).toBeUndefined();
        expect(arena.exertedThisTap).toBeUndefined();
        expect(
            (h.state().pendingEvents ?? []).filter(
                (e) => e.type === "PERMANENT_EXERTED"
            )
        ).toHaveLength(0);
    });

    it("cancelling the whole cast un-exerts every land it exerted", async () => {
        const h = makeMutationCtx("p1", [gameStateSeed(castPaymentState())]);
        await runMutation<{ gameId: Id<"games">; playerId: string }, void>(
            cancelCast as unknown as Handler<
                { gameId: Id<"games">; playerId: string },
                void
            >,
            h.ctx,
            { gameId: GAME_ID, playerId: "p1" }
        );

        const arena = h.state().players[0].battlefield[0];
        expect(arena.isTapped).toBe(false);
        expect(arena.skipNextUntap).toBeUndefined();
        expect(arena.exertedThisTap).toBeUndefined();
    });
});
