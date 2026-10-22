// Full path for issue #6333 (CR 400.7 / 608.2b): the REGISTERED `game.ts`
// mutations play Lightning Bolt on a creature and Ephemerate on it in
// response, on the stub `MutationCtx`, and the client sees the Bolt fizzle —
// the blinked creature is on the battlefield with no damage, the Bolt in its
// owner's graveyard, the stack empty — through `projectPublicState`.
import { describe, expect, it } from "vitest";
import { announceCast, passPriority, selectTargets } from "../game";
import { projectPublicState } from "../gameProjections";
import { getCardByName } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
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
    zone: "hand" | "battlefield" | "library"
) =>
    makeInstance(getCardByName(name).id, {
        id: instanceId,
        controllerId: owner,
        ownerId: owner,
        zone,
    });

/** The opponent's turn, the opponent holding priority with a Lightning Bolt
 *  and {R}; I hold Ephemerate and {W}, and control the Grizzly Bears. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                hand: [card("Ephemerate", "ephemerate", ME, "hand")],
                battlefield: [
                    card("Grizzly Bears", "bears", ME, "battlefield"),
                ],
                library: [card("Forest", "my-lib-0", ME, "library")],
                manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer(OPP, {
                hand: [card("Lightning Bolt", "bolt", OPP, "hand")],
                library: [card("Mountain", "opp-lib-0", OPP, "library")],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
        ],
        activePlayerId: OPP,
        priorityPlayerId: OPP,
    });
}

async function call(
    harness: MutationStub,
    fn: unknown,
    args: Record<string, unknown>
): Promise<void> {
    await runMutation<Record<string, unknown>, unknown>(fn, harness.ctx, {
        gameId: GAME,
        ...args,
    });
}

async function castTargeting(
    harness: MutationStub,
    playerId: string,
    cardInstanceId: string,
    targetId: string
): Promise<void> {
    await call(harness, announceCast, { playerId, cardInstanceId });
    await call(harness, selectTargets, {
        playerId,
        targets: [{ targetType: "permanent", targetId }],
    });
}

describe("a blinked creature is a new object through the game mutations (issue #6333)", () => {
    it("Lightning Bolt on a creature blinked by Ephemerate in response fizzles, and the client sees the creature unharmed", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);

        await castTargeting(harness, OPP, "bolt", "bears");
        // Priority passes to me with the Bolt on the stack (CR 117.3c).
        if (harness.state().priorityPlayerId === OPP) {
            await call(harness, passPriority, { playerId: OPP });
        }
        expect(harness.state().priorityPlayerId).toBe(ME);
        await castTargeting(harness, ME, "ephemerate", "bears");
        expect(harness.state().stack).toHaveLength(2);

        for (let guard = 0; guard < 8; guard++) {
            const live = harness.state();
            if (live.stack.length === 0) break;
            await call(harness, passPriority, {
                playerId: live.priorityPlayerId,
            });
        }

        const state = harness.state();
        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, OPP).graveyard.map((c) => c.id)).toContain(
            "bolt"
        );

        const view = projectPublicState(state, 1, ME);
        const mine = view.players.find((p) => p.id === ME)!;
        const bears = mine.battlefield.find((c) => c.id === "bears");
        expect(bears).toBeDefined();
        expect(bears!.damageMarked ?? 0).toBe(0);
        expect(mine.graveyard.map((c) => c.id)).not.toContain("bears");
        expect(view.stack).toHaveLength(0);
    });
});
