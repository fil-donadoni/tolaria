/**
 * CR 614.9 (issue #3810) — the recipient-keyed redirection shield, driven
 * through the REAL cast path: `announceCast` picks up the announced {X},
 * `selectTargets` walks the two-slot "any target" group, `resolveTopOfStack`
 * installs the shield, and the damage that follows is read back off
 * `projectPublicState` rather than off `GameState`.
 *
 * What this buys over `gre/__tests__/recipientDamageShields.test.ts` is the
 * half a GRE unit test cannot reach: that the budget the player announced for
 * {X} is the budget the shield gets, that the SECOND slot of the group is a
 * distinct recipient the mutation actually let them choose, and that the
 * result is visible to a client — the three seams between the engine and the
 * board (`.claude/rules/gre-development.md` § Frontend wiring analysis).
 */

import { describe, expect, it } from "vitest";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { plains } from "../cards/sets/lea/colorless";
import { crawWurm } from "../cards/sets/lea/green";
import { lightningBolt } from "../cards/sets/lea/red";
import { captainsManeuver } from "../cards/sets/apc/multicolor";
import { announceCast, selectTargets } from "../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness";
import type { Id } from "../_generated/dataModel";
import { pushSpell } from "../cards/__tests__/setup";
import { resolveTopOfStack, type GameState } from "../gre/state";
import { projectPublicState } from "../gameProjections";

const SPELL = "maneuver-1";
const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

/** p1 holds Captain's Maneuver and exactly {3}{R}{W}; p2 has a Craw Wurm to
 *  point the redirect at. */
function board(): GameState {
    const spell = makeInstance(captainsManeuver.id, {
        id: SPELL,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell],
                battlefield: [
                    makeInstance(plains.id, {
                        id: "my-plains",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    }),
                ],
                manaPool: { W: 1, U: 0, B: 0, R: 1, G: 0, C: 3 },
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(crawWurm.id, {
                        id: "wurm",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "battlefield",
                    }),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("CR 614.9 full path — Captain's Maneuver from announcement to board", () => {
    it("announces {X}, walks both slots of the group, and redirects the damage that follows", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
        await runMutation(
            announceCast as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            { ...BASE, cardInstanceId: SPELL, chosenX: 3 }
        );
        // CR 601.2c — ONE group of count 2, so both recipients are chosen in
        // the same selection. Slot 0 is the shielded recipient, slot 1 the
        // destination ("another target", the engine's within-group
        // distinctness).
        await runMutation(
            selectTargets as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            {
                ...BASE,
                targets: [
                    { targetType: "player", targetId: "p1" },
                    { targetType: "permanent", targetId: "wurm" },
                ],
            }
        );
        const state = harness.state();
        resolveTopOfStack(state);
        expect(state.damageRedirections?.[0]).toMatchObject({
            kind: "next-n-to-recipient-redirect",
            remaining: 3,
        });

        // The opponent burns the shielded player; the shield moves it.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);

        // The surface assertion traverses the wire projection — a hand-built
        // view would prove nothing about what the client receives.
        const projected = projectPublicState(state, "p1");
        expect(projected.players.find((p) => p.id === "p1")?.life).toBe(20);
        expect(
            projected.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === "wurm")?.damageMarked
        ).toBe(3);
    });
});
