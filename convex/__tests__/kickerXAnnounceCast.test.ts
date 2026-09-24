// Kicker {X} through the REAL `announceCast` mutation handler (issue #2141).
//
// `gre/__tests__/kickerX.test.ts` enters at `finalizeTargetSelection` with the
// X already on the pending target; a Verdeloth cast has no target, so a live
// one never goes there — it takes `announceCast`'s own no-target commit. This
// file drives that handler over the stub ctx, so the X gate and the X
// forwarding it owns are what is under test:
//
//   CR 107.3a — a paid Kicker {X} is priced at the spell's one announced X;
//   CR 601.2b — X is announced for a variable cost that WILL be paid, so a
//   kicked cast without one is refused, and an unkicked cast carries none.

import { describe, expect, it } from "vitest";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { verdelothTheAncient } from "../cards/sets/inv/green";
import { announceCast } from "../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness";
import type { Id } from "../_generated/dataModel";
import { getPlayer, resolveTopOfStack, type GameState } from "../gre/state";

const VERDELOTH = "verdeloth-1";
const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

/** p1 holds Verdeloth with nine green in pool — {4}{G}{G} plus up to X = 3. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(verdelothTheAncient.id, {
                        id: VERDELOTH,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 9, C: 0 },
            }),
            makePlayer("p2"),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

async function announce(args: Record<string, unknown>) {
    const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
    await runMutation(
        announceCast as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, cardInstanceId: VERDELOTH, ...args }
    );
    return harness;
}

describe("announceCast — Kicker {X} (CR 107.3a / 601.2b, issue #2141)", () => {
    it("refuses a kicked cast that announces no X", async () => {
        await expect(
            announce({ kickerPayments: { kicker: 1 } })
        ).rejects.toThrow(/Must choose X/);
    });

    it("kicked with X = 3: charges {4}{G}{G}{3} and the ETB makes three Saprolings", async () => {
        const harness = await announce({
            kickerPayments: { kicker: 1 },
            chosenX: 3,
        });
        const state = harness.state();
        expect(getPlayer(state, "p1").manaPool.G).toBe(0);
        expect(state.stack.find((s) => s.id === VERDELOTH)?.chosenX).toBe(3);

        resolveTopOfStack(state); // the creature spell — its ETB triggers
        resolveTopOfStack(state); // the ETB
        expect(
            getPlayer(state, "p1").battlefield.filter((c) =>
                c.subtypes.includes("Saproling")
            )
        ).toHaveLength(3);
    });

    it("unkicked: a stray X is not announced and charges nothing", async () => {
        const harness = await announce({ chosenX: 5 });
        const state = harness.state();
        expect(getPlayer(state, "p1").manaPool.G).toBe(3);
        expect(
            state.stack.find((s) => s.id === VERDELOTH)?.chosenX
        ).toBeUndefined();
    });
});
