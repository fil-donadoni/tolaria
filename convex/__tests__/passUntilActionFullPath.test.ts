// Full-path integration for Pass Until Action (issue #5782): GRE -> game.ts
// -> wire projection.
//
//   CR 113.8  The controller of an activated ability on the stack is the
//             player who activated it. The controller of a triggered ability
//             on the stack (other than a delayed triggered ability) is the
//             player who controlled the ability's source when it triggered.
//
// Driven through the REGISTERED `passUntilAction` / `passPriority` /
// `cancelAutoPass` `_handler`s over the stub `MutationCtx`, persisted through
// `saveGameState`'s compact form, and read back through `projectPublicState` —
// what the client receives, not a hand-built view.

import { describe, it, expect } from "vitest";
import { cancelAutoPass, passPriority, passUntilAction } from "../game";
import type { GameState } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { makeState, pushSpell } from "../cards/__tests__/setup.helper";
import { getCardByName } from "../cards";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const INSTANT = getCardByName("Giant Growth").id;

type SeatArgs = { gameId: Id<"games">; playerId: string };

const run = (
    fn: unknown,
    ctx: Parameters<typeof runMutation>[1],
    playerId: string
) =>
    runMutation<SeatArgs, void>(fn as Handler<SeatArgs, void>, ctx, {
        gameId: GAME_ID,
        playerId,
    });

describe("Pass Until Action full path (CR 113.8, issue #5782)", () => {
    it("arms through the mutation, survives the projection, and stops on the opponent's cast", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(makeState({ phase: "PRECOMBAT_MAIN" })),
        ]);
        await run(passUntilAction, stub.ctx, "p1");

        const armed = stub.state();
        // The drain passed for p1; p2 holds priority in p1's main.
        expect(armed.priorityPlayerId).toBe("p2");
        expect(armed.phase).toBe("PRECOMBAT_MAIN");
        const view = projectPublicState(armed, 1, "p1");
        expect(view.passUntilAction).toEqual([
            { playerId: "p1", ignoredStackIds: [] },
        ]);

        // p2 casts an instant (CR 117.3c — keeps priority) and passes.
        const next: GameState = structuredClone(armed);
        const instant = pushSpell(next, INSTANT, "p2");
        next.passCount = 0;
        const stub2 = makeMutationCtx("p2", [gameStateSeed(next, 2)]);
        await run(passPriority, stub2.ctx, "p2");

        const stopped = stub2.state();
        expect(stopped.priorityPlayerId).toBe("p1");
        expect(stopped.stack.map((s) => s.id)).toEqual([instant.id]);
        expect(stopped.passUntilAction).toBeUndefined();
        expect(
            projectPublicState(stopped, 1, "p1").passUntilAction
        ).toBeUndefined();
    });

    it("queues without priority and cancelAutoPass clears it without reclaiming priority", async () => {
        const seed = makeState({ phase: "PRECOMBAT_MAIN" });
        seed.priorityPlayerId = "p2";
        seed.passCount = 1;
        const stub = makeMutationCtx("p1", [gameStateSeed(seed)]);

        await run(passUntilAction, stub.ctx, "p1");
        const queued = stub.state();
        expect(queued.priorityPlayerId).toBe("p2");
        expect(
            projectPublicState(queued, 1, "p1").queuedPassUntilAction
        ).toEqual([{ playerId: "p1", ignoredStackIds: [] }]);

        await run(cancelAutoPass, stub.ctx, "p1");
        const cancelled = stub.state();
        expect(cancelled.queuedPassUntilAction).toBeUndefined();
        expect(cancelled.passUntilAction).toBeUndefined();
        expect(cancelled.priorityPlayerId).toBe("p2");
    });

    it("refuses to arm for a seat the caller does not own", async () => {
        const stub = makeMutationCtx("p2", [
            gameStateSeed(makeState({ phase: "PRECOMBAT_MAIN" })),
        ]);
        await expect(run(passUntilAction, stub.ctx, "p1")).rejects.toThrow();
        expect(stub.state().passUntilAction).toBeUndefined();
    });
});
