// issue #3814 — the FULL path for a discard replacement scoped by what caused
// the discard (CR 614.1a / 701.9): an opponent casts Mind Rot through
// `announceCast` / `selectTargets` / `passPriority`, the discarding player
// answers through `submitResolutionChoice` (the `game.ts` mutations, driven
// through their registered `_handler`s), and the persisted `gameStates` row and
// its PROJECTED client view show Dodecapod on the battlefield with its two
// +1/+1 counters instead of in the graveyard.
//
// The GRE half is `convex/cards/sets/apc/__tests__/colorless.test.ts`; this
// file exists because the discard origin is stamped at the SpellContext seam
// (`item.castById`) the mutation path runs, and the client sees only the
// projection. Same harness discipline as `nonOwnerCastControllerPath.test.ts`.

import { describe, it, expect } from "vitest";
import {
    announceCast,
    passPriority,
    selectTargets,
    submitResolutionChoice,
} from "../game";
import { projectPublicState } from "../gameProjections";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { dodecapod } from "../cards/sets/apc/colorless";
import { mindRot } from "../cards/sets/por/black";
import { grizzlyBears } from "../cards/sets/lea/green";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;
type Ctx = Parameters<typeof runMutation>[1];

const call = (fn: unknown, ctx: Ctx, args: Record<string, unknown>) =>
    runMutation<Record<string, unknown>, void>(
        fn as Handler<never, void>,
        ctx,
        { gameId: GAME_ID, ...args }
    );

/** p2 (active, holding priority) has Mind Rot and {2}{B} floating; p1 holds
 *  Dodecapod and a Grizzly Bears — exactly two cards, both discarded. */
function position(): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p2",
        priorityPlayerId: "p2",
        turn: 2,
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(dodecapod.id, {
                        id: "pod",
                        ownerId: "p1",
                        controllerId: "p1",
                        zone: "hand",
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "bear",
                        ownerId: "p1",
                        controllerId: "p1",
                        zone: "hand",
                    }),
                ],
            }),
            makePlayer("p2", {
                hand: [
                    makeInstance(mindRot.id, {
                        id: "rot",
                        ownerId: "p2",
                        controllerId: "p2",
                        zone: "hand",
                    }),
                ],
                manaPool: { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 },
            }),
        ],
    });
}

describe("Dodecapod through game.ts to the client view (issue #3814)", () => {
    it("CR 614.1a — an opponent's Mind Rot puts it onto the battlefield with two +1/+1 counters", async () => {
        const harness = makeMutationCtx("p2", [gameStateSeed(position())]);
        await call(announceCast, harness.ctx, {
            playerId: "p2",
            cardInstanceId: "rot",
        });
        await call(selectTargets, harness.ctx, {
            playerId: "p2",
            targets: [{ targetType: "player", targetId: "p1" }],
        });
        expect(harness.state().stack).toHaveLength(1);

        // Both players pass until the spell resolves into p1's discard choice;
        // each pass runs as its own authenticated ctx over the persisted row.
        for (let guard = 0; guard < 6; guard++) {
            const live = harness.state();
            if (live.pendingChoices?.length) break;
            const pid = live.priorityPlayerId;
            if (!pid) break;
            const authed = makeMutationCtx(pid, [gameStateSeed(live, 99)]);
            await call(passPriority, authed.ctx, { playerId: pid });
            harness.doc("gs-1").state = authed.doc("gs-1").state;
        }

        const head = harness.state().pendingChoices![0];
        expect(head.playerId).toBe("p1");
        const p1 = makeMutationCtx("p1", [gameStateSeed(harness.state(), 99)]);
        await call(submitResolutionChoice, p1.ctx, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["pod", "bear"],
        });

        const persisted = p1.state();
        const owner = persisted.players.find((p) => p.id === "p1")!;
        expect(owner.graveyard.map((c) => c.id)).toEqual(["bear"]);
        const pod = owner.battlefield.find((c) => c.id === "pod");
        expect(pod?.counters?.["+1/+1"]).toBe(2);

        // …and the same through the projection each client renders.
        for (const viewer of ["p1", "p2"]) {
            const view = projectPublicState(persisted, 1, viewer);
            const seen = view.players
                .find((p) => p.id === "p1")!
                .battlefield.find((c) => c.id === "pod");
            expect(seen?.counters?.["+1/+1"]).toBe(2);
        }
    });
});
