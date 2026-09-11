// issue #3000 — the FULL path for a permanent spell cast by a non-owner:
// `announceCast` / `passPriority` (`game.ts` mutations, driven through their
// registered `_handler`s) → the persisted `gameStates` row → the PROJECTED
// client view.
//
// CR 110.2 / 110.2b / 112.2 — the caster controls the spell and the permanent
// it becomes. The GRE half of this coverage is
// `convex/gre/__tests__/nonOwnerCastController.test.ts`; this file exists
// because the client sees only the projection, and a permanent projected onto
// the wrong side of the board — or an ETB choice addressed to the wrong player —
// is exactly the shape of the bug that was observed in play (the Bot cast a
// human-owned creature off an exile grant and the HUMAN was prompted to
// discard).
//
// Same harness discipline as `bolassCitadelCastPath.test.ts`: this project has
// no convex-test harness, so the seam for `game.ts` integration coverage is a
// stub `MutationCtx` driving the REGISTERED mutation's own `_handler`.

import { describe, it, expect } from "vitest";
import { announceCast, passPriority } from "../game";
import { projectPublicState } from "../gameProjections";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { vodalianMerchant } from "../cards/sets/inv/blue";
import { grizzlyBears } from "../cards/sets/lea/green";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

const announce = (
    ctx: Parameters<typeof runMutation>[1],
    playerId: string,
    cardInstanceId: string
) =>
    runMutation<
        { gameId: Id<"games">; playerId: string; cardInstanceId: string },
        void
    >(announceCast as unknown as Handler<never, void>, ctx, {
        gameId: GAME_ID,
        playerId,
        cardInstanceId,
    });

const pass = (ctx: Parameters<typeof runMutation>[1], playerId: string) =>
    runMutation<{ gameId: Id<"games">; playerId: string }, void>(
        passPriority as unknown as Handler<never, void>,
        ctx,
        { gameId: GAME_ID, playerId }
    );

/** p1 OWNS the Vodalian Merchant and it sits in p1's exile; the grant lets p2
 *  cast it for free (the shape every cast-from-another-player's-zone permission
 *  leaves behind). p2 is the active player, so the sorcery-speed window is
 *  theirs. */
function position(): GameState {
    return makeState({
        activePlayerId: "p2",
        priorityPlayerId: "p2",
        turn: 2,
        players: [
            makePlayer("p1", {
                exile: [
                    makeInstance(vodalianMerchant.id, {
                        id: "merch",
                        ownerId: "p1",
                        controllerId: "p1",
                        zone: "exile",
                        castableFromExileBy: "p2",
                        castFromExileWithoutPayingManaCost: true,
                    }),
                ],
                hand: [
                    makeInstance(grizzlyBears.id, {
                        id: "p1-hand",
                        ownerId: "p1",
                        controllerId: "p1",
                        zone: "hand",
                    }),
                ],
                library: [
                    makeInstance(grizzlyBears.id, {
                        id: "p1-lib",
                        ownerId: "p1",
                        controllerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2", {
                library: [
                    makeInstance(grizzlyBears.id, {
                        id: "p2-lib",
                        ownerId: "p2",
                        controllerId: "p2",
                        zone: "library",
                    }),
                ],
            }),
        ],
    });
}

describe("a non-owner's permanent spell, through game.ts to the client view (issue #3000)", () => {
    it("CR 112.2 — the spell on the stack is projected as the CASTER's", async () => {
        const harness = makeMutationCtx("p2", [gameStateSeed(position())]);
        await announce(harness.ctx, "p2", "merch");

        const persisted = harness.state();
        expect(persisted.stack).toHaveLength(1);
        expect(persisted.stack[0].castById).toBe("p2");
        expect(persisted.stack[0].controllerId).toBe("p2");
        expect(persisted.stack[0].ownerId).toBe("p1");

        // The projection is the only thing the client reads.
        const view = projectPublicState(persisted, 1, "p2");
        expect(view.stack[0].controllerId).toBe("p2");
    });

    it("CR 110.2 — the resolved permanent is projected on the CASTER's battlefield and the ETB choice is addressed to the caster", async () => {
        const harness = makeMutationCtx("p2", [gameStateSeed(position())]);
        await announce(harness.ctx, "p2", "merch");

        // Both players pass until the engine stops asking for priority: the
        // spell resolves, the permanent enters, its ETB goes on the stack, and
        // the ETB resolves into the discard choice. Each pass runs as its own
        // authenticated ctx (the mutation checks `playerId` against `ctx.auth`)
        // over the state the previous one persisted.
        for (let guard = 0; guard < 8; guard++) {
            const live = harness.state();
            if (live.pendingChoices?.length) break;
            const pid = live.priorityPlayerId;
            if (!pid) break;
            const authed = makeMutationCtx(pid, [gameStateSeed(live, 99)]);
            await pass(authed.ctx, pid);
            harness.doc("gs-1").state = authed.doc("gs-1").state;
        }

        const persisted = harness.state();
        const caster = persisted.players.find((p) => p.id === "p2")!;
        const owner = persisted.players.find((p) => p.id === "p1")!;
        expect(caster.battlefield.map((c) => c.id)).toContain("merch");
        expect(owner.battlefield.map((c) => c.id)).not.toContain("merch");

        const entered = caster.battlefield.find((c) => c.id === "merch")!;
        expect(entered.controllerId).toBe("p2");
        // CR 400.3 — ownership is untouched.
        expect(entered.ownerId).toBe("p1");

        // …and the same through the projection each client actually renders.
        // These two placement reads are NON-REGRESSION guards, not the new
        // pin: the projection places battlefield cards by the player ARRAY,
        // and the array was always right — the array/field disagreement WAS
        // the bug. The load-bearing assertions here are `controllerId` above
        // and the choice's `playerId` below, both of which travel through the
        // projection as their own fields.
        const casterView = projectPublicState(persisted, 1, "p2");
        expect(
            casterView.players
                .find((p) => p.id === "p2")!
                .battlefield.map((c) => c.id)
        ).toContain("merch");
        const ownerView = projectPublicState(persisted, 1, "p1");
        expect(
            ownerView.players
                .find((p) => p.id === "p1")!
                .battlefield.map((c) => c.id)
        ).not.toContain("merch");

        // The ETB ("draw a card, then discard a card") drew for the CASTER and
        // its discard choice is addressed to the CASTER (CR 701.9a).
        expect(caster.hand.map((c) => c.id)).toContain("p2-lib");
        expect(owner.hand.map((c) => c.id)).toEqual(["p1-hand"]);
        expect(persisted.pendingChoices?.[0]?.playerId).toBe("p2");
        expect(casterView.pendingChoices?.[0]?.playerId).toBe("p2");
    });
});
