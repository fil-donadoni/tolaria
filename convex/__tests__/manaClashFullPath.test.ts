// Full-path integration for Mana Clash's draw-then-reveal (CR 705.2, issue
// #5520): GRE -> game.ts -> wire projection.
//
// Casting draws every round up front and parks the resolution on ONE reveal;
// the damage is dealt when the REGISTERED `submitRandomRevealAck` handler
// resumes it over the stub `MutationCtx`. Seed 19 draws (caster / opponent):
// T T · T H · H T · H H — two tails each.
//
// The surface is asserted through `projectPublicState`; a hand-built view would
// prove nothing about what the client receives.

import { describe, it, expect } from "vitest";
import { submitRandomRevealAck } from "../game";
import { resolveTopOfStack } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "../cards/__tests__/setup.helper";
import { manaClash } from "../cards/sets/drk/red.cards";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

type AckArgs = {
    gameId: Id<"games">;
    playerId: string;
    stackItemId: string;
    choiceId: string;
};

describe("Mana Clash through the real mutation (CR 705.2, issue #5520)", () => {
    it("both seats see every round before the ack; the damage lands after it", async () => {
        const state = makeState({
            rngSeed: 19,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, manaClash().id, "p1", [{ type: "player", id: "p2" }]);
        expect(resolveTopOfStack(state)).toBeNull();
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        const head = stub.state().pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        for (const seat of ["p1", "p2"] as const) {
            const view = projectPublicState(stub.state(), 1, seat);
            expect(view.pendingChoices![0].flips).toHaveLength(8);
            expect(view.pendingChoices![0].faceDamage).toEqual({
                heads: 0,
                tails: 1,
            });
            expect(view.players.map((p) => p.life)).toEqual([20, 20]);
        }

        await runMutation<AckArgs, void>(
            submitRandomRevealAck as unknown as Handler<AckArgs, void>,
            stub.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                stackItemId: head.stackItemId,
                choiceId: head.choiceId,
            }
        );

        const after = stub.state();
        expect(after.stack).toHaveLength(0);
        expect(after.pendingChoices ?? []).toHaveLength(0);
        for (const seat of ["p1", "p2"] as const) {
            const view = projectPublicState(after, 1, seat);
            expect(view.players.map((p) => p.life)).toEqual([18, 18]);
        }
    });
});
