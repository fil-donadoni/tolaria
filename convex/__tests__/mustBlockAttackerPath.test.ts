// Full path for the attacker-named block requirement (CR 509.1c, issue #3713 —
// Rampant Elephant): GRE (the ability resolves) → `game.ts` (the REGISTERED
// `confirmBlockers` mutation folds it into the declaration) → the client's
// blocker view (`projectPublicState`). The unit tests in
// `gre/__tests__/mustBlockAttacker.test.ts` prove each seam alone; this proves
// the mutation path folds the requirement and the wire carries the result.
//
// Same harness discipline as `combatDeclarationCap.test.ts`: a stub
// `MutationCtx` driving the registered mutation's own `_handler`.

import { describe, it, expect } from "vitest";
import { confirmBlockers } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../cards/__tests__/setup.helper";
import { rampantElephant } from "../cards/sets/inv/white.cards";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import { projectPublicState } from "../gameProjections";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

const runConfirmBlockers = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<{ gameId: Id<"games">; playerId: string }, void>(
        confirmBlockers as unknown as Handler<
            { gameId: Id<"games">; playerId: string },
            void
        >,
        ctx,
        { gameId: GAME_ID, playerId: "p2" }
    );

/** p1 attacks with Rampant Elephant; p2 has a lone untapped creature. */
function elephantAttackState(): GameState {
    const elephant = makeInstance(rampantElephant().id, {
        id: "ele",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        isAttacking: true,
    });
    return makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p2",
        players: [
            makePlayer("p1", { battlefield: [elephant] }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears().id, {
                        id: "blk",
                        controllerId: "p2",
                        ownerId: "p2",
                        isSummoningSick: false,
                    }),
                ],
            }),
        ],
        combat: {
            attackerIds: ["ele"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

describe("Rampant Elephant's forced block through the real mutation (CR 509.1c)", () => {
    it("confirmBlockers folds the requirement and the client view shows the forced block", async () => {
        const state = elephantAttackState();
        const elephant = state.players[0].battlefield[0];
        resolveActivated(state, elephant, "rampant-elephant-must-block", [
            { type: "permanent", id: "blk" },
        ]);

        const h = makeMutationCtx("p2", [gameStateSeed(state)]);
        await runConfirmBlockers(h.ctx);

        const saved = h.state();
        expect(saved.combat!.blockerAssignments).toEqual({ blk: ["ele"] });

        // Client view: the forced assignment is on the wire for BOTH seats.
        for (const viewer of ["p1", "p2"]) {
            const view = projectPublicState(saved, 2, viewer);
            expect(view.combat?.blockerAssignments).toEqual({ blk: ["ele"] });
        }
    });

    it("without the activation the lone creature is NOT forced (the ability is what binds it)", async () => {
        const h = makeMutationCtx("p2", [gameStateSeed(elephantAttackState())]);
        await runConfirmBlockers(h.ctx);
        expect(h.state().combat!.blockerAssignments).toEqual({});
    });
});
