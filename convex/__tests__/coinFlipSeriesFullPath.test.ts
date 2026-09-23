// Full-path integration for the coin-flip SERIES (CR 705, issue #3813,
// ADR 0144): GRE -> game.ts -> wire projection, on the card that ships it.
//
//   705.2  … If the call matches the result, the player wins the flip.
//          Otherwise, the player loses the flip.
//
// Squee's Revenge suspends on its "Choose a number." nomination, and the whole
// series runs when the REGISTERED `submitNumberChoice` handler resumes the
// resolution over the stub `MutationCtx` — so the flips, the count bindings
// and the scaled draw all happen inside the real mutation. The seed fixes the
// sequence: seed 31 flips W W W L …
//
// The surface is asserted through `projectPublicState` after the submit; a
// hand-built view would prove nothing about what the client receives.

import { describe, it, expect } from "vitest";
import { submitNumberChoice } from "../game";
import { resolveTopOfStack } from "../gre/state";
import type { GameState } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../cards/__tests__/setup";
import { grizzlyBears } from "../cards/sets/lea/green";
import { squeesRevenge } from "../cards/sets/apc/multicolor";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type NumberChoiceArgs = {
    gameId: Id<"games">;
    playerId: string;
    amount: number;
};

const submit = (ctx: Parameters<typeof runMutation>[1], amount: number) =>
    runMutation<NumberChoiceArgs, void>(
        submitNumberChoice as unknown as Handler<NumberChoiceArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", amount }
    );

function suspendedSquee(rngSeed: number): GameState {
    const library = Array.from({ length: 20 }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `p1-lib-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );
    const state = makeState({
        rngSeed,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1", { library }), makePlayer("p2")],
    });
    pushSpell(state, squeesRevenge.id, "p1");
    expect(resolveTopOfStack(state)).toBeNull();
    return state;
}

describe("Squee's Revenge through the real mutation (CR 705.2, issue #3813)", () => {
    it("winning every flip draws two cards per flip, visible through the projection", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(suspendedSquee(31))]);
        await submit(stub.ctx, 3); // W W W — the series stops at 3

        const after = stub.state();
        expect(after.stack).toHaveLength(0);
        expect(after.pendingChoices ?? []).toHaveLength(0);
        for (const seat of ["p1", "p2"] as const) {
            const view = projectPublicState(after, 1, seat);
            expect(view.players[0].hand).toHaveLength(6);
            expect(view.players[0].library).toMatchObject({ count: 14 });
        }
    });

    it("a lost flip ends the series and draws nothing", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(suspendedSquee(31))]);
        await submit(stub.ctx, 6); // W W W L — stops at the loss

        const view = projectPublicState(stub.state(), 1, "p1");
        expect(view.players[0].hand).toHaveLength(0);
        expect(view.players[0].library).toMatchObject({ count: 20 });
        expect(stub.state().stack).toHaveLength(0);
    });
});
