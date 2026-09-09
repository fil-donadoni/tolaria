// Aluren — the FULL `game.ts` mutation path for a cast made under a board
// CAST PERMISSION (issue #2706, CR 601.3 / 118.9 / 118.9b / 601.2b / 107.3b).
//
// The GRE test (`convex/gre/__tests__/castPermissions.test.ts`) covers the
// permission scan, the legality gate and the two timing predicates; the client
// test (`src/lib/__tests__/aluren-cast-permission-surface.test.ts`) covers the
// picker reducer. Neither drives `announceCast`, which is where the headline
// behaviour lives: the creature reaching the stack having paid NOTHING, the
// mandatory-permission rejection off the caster's sorcery window, and the
// CR 107.3b clamp on {X}.
//
// Same harness discipline as `bolassCitadelCastPath.test.ts`: no convex-test
// harness exists in this project, so the established seam for `game.ts`
// integration coverage is a stub `MutationCtx` driving the REGISTERED
// mutation's own `_handler` (`gameMutationHarness.ts`).

import { describe, expect, it } from "vitest";
import { announceCast } from "../game";
import { aluren } from "../cards/sets/tmp/green";
import { grizzlyBears } from "../cards/sets/lea/green";
import { forest } from "../cards/sets/lea/colorless";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { registerTokenDefinition } from "../cards";
import type { CardDefinition } from "../cards/types";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;
const ALUREN_ALT_COST_ID = "cast-permission:aluren-creature-permission";

/** A creature whose printed cost carries a variable {X}. Its mana value in
 *  hand is still 1 (CR 202.3b — X counts as 0 everywhere but the stack), so
 *  Aluren's "mana value 3 or less" filter covers it, which is exactly the
 *  combination CR 107.3b legislates. Registered rather than swapped in with
 *  `withTemporaryDefinition`: that helper's window is its callback's
 *  SYNCHRONOUS extent, and every mutation here is awaited. */
const X_PROBE_ID = "test:aluren-x-cost-probe";
const xCostProbe: CardDefinition = {
    ...grizzlyBears,
    id: X_PROBE_ID,
    name: "Aluren X-Cost Probe",
    manaCost: { X: "X", G: 1 },
};
registerTokenDefinition(xCostProbe);

type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    chosenX?: number;
    alternativeCostId?: string;
};

const runAnnounceCast = (
    ctx: Parameters<typeof runMutation>[1],
    playerId: string,
    args: Omit<AnnounceCastArgs, "gameId" | "playerId">
) =>
    runMutation<AnnounceCastArgs, void>(
        announceCast as unknown as Handler<AnnounceCastArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId, ...args }
    );

/** p1 controls an Aluren and `forests` untapped Forests; `caster` holds one
 *  copy of `handCardId` and has priority. Deliberately gives p1 enough mana to
 *  pay Grizzly Bears' printed {1}{G}, so a cast that leaves every land untapped
 *  proves the permission paid, not the board. */
function alurenState(opts: {
    handCardId: string;
    caster: "p1" | "p2";
    forests?: number;
}): GameState {
    const { handCardId, caster, forests = 2 } = opts;
    const hand = [
        makeInstance(handCardId, {
            id: "probe",
            controllerId: caster,
            ownerId: caster,
            zone: "hand",
        }),
    ];
    return makeState({
        players: [
            makePlayer("p1", {
                hand: caster === "p1" ? hand : [],
                battlefield: [
                    makeInstance(aluren.id, {
                        id: "aluren",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    ...Array.from({ length: forests }, (_, i) =>
                        makeInstance(forest.id, {
                            id: `forest-${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                ],
            }),
            makePlayer("p2", { hand: caster === "p2" ? hand : [] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: caster,
    });
}

describe("announceCast under a board cast permission (CR 601.3 / 118.9, issue #2706)", () => {
    it("the controller casts a covered creature for free in their own main phase — nothing tapped, no life spent", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                alurenState({ handCardId: grizzlyBears.id, caster: "p1" })
            ),
        ]);

        await runAnnounceCast(harness.ctx, "p1", {
            cardInstanceId: "probe",
            alternativeCostId: ALUREN_ALT_COST_ID,
        });

        const after = harness.state();
        const p1 = after.players[0];
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].id).toBe("probe");
        expect(p1.hand).toHaveLength(0);
        // CR 118.9 — the alternative cost REPLACED the printed {1}{G}, and it
        // is nothing at all: no land paid for this and no life did either.
        expect(p1.battlefield.filter((c) => c.isTapped)).toHaveLength(0);
        expect(p1.life).toBe(20);
    });

    it("the OPPONENT casts it on p1's turn — 'any player may cast', at instant speed (CR 601.3b / 702.8a)", async () => {
        const harness = makeMutationCtx("p2", [
            gameStateSeed(
                alurenState({ handCardId: grizzlyBears.id, caster: "p2" })
            ),
        ]);

        await runAnnounceCast(harness.ctx, "p2", {
            cardInstanceId: "probe",
            alternativeCostId: ALUREN_ALT_COST_ID,
        });

        const after = harness.state();
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].id).toBe("probe");
        expect(after.players[1].hand).toHaveLength(0);
    });

    it("rejects a PAID announcement off the caster's sorcery window — CR 118.9b makes the permission's cost mandatory", async () => {
        const harness = makeMutationCtx("p2", [
            gameStateSeed(
                alurenState({ handCardId: grizzlyBears.id, caster: "p2" })
            ),
        ]);

        await expect(
            runAnnounceCast(harness.ctx, "p2", { cardInstanceId: "probe" })
        ).rejects.toThrow(
            "This spell can only be cast now without paying its mana cost"
        );
        expect(harness.state().stack).toHaveLength(0);
    });

    it("rejects an unknown permission id — a client cannot invent a free cast", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                alurenState({ handCardId: grizzlyBears.id, caster: "p1" })
            ),
        ]);

        await expect(
            runAnnounceCast(harness.ctx, "p1", {
                cardInstanceId: "probe",
                alternativeCostId: "cast-permission:not-on-the-battlefield",
            })
        ).rejects.toThrow("Unknown alternative cost for this spell");
    });

    it("CR 107.3b — an {X} in the printed cost is locked to 0 under the free cast", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                alurenState({ handCardId: X_PROBE_ID, caster: "p1" })
            ),
        ]);

        await expect(
            runAnnounceCast(harness.ctx, "p1", {
                cardInstanceId: "probe",
                alternativeCostId: ALUREN_ALT_COST_ID,
                chosenX: 2,
            })
        ).rejects.toThrow("The only legal choice for X is 0");

        await runAnnounceCast(harness.ctx, "p1", {
            cardInstanceId: "probe",
            alternativeCostId: ALUREN_ALT_COST_ID,
            chosenX: 0,
        });
        expect(harness.state().stack).toHaveLength(1);
    });

    it("charges the printed cost without the permission — the same creature is not castable for free once Aluren is gone", async () => {
        const state = alurenState({
            handCardId: grizzlyBears.id,
            caster: "p1",
        });
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "aluren"
        );
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await expect(
            runAnnounceCast(harness.ctx, "p1", {
                cardInstanceId: "probe",
                alternativeCostId: ALUREN_ALT_COST_ID,
            })
        ).rejects.toThrow("Unknown alternative cost for this spell");
    });
});
