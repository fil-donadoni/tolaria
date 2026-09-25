// Parity between the two cast kernels (issue #4445, PRD #4437).
//
// The server commits a Cast through ONE kernel, `commitCast`
// (`convex/gre/castCommit.ts`, the **Cast Commit**), and the Bot's search
// through ITS one kernel, `commitCastInSearch` (`convex/gre/applyMove.ts`,
// issue #4444). The Bot simulates the game the server plays only if the two
// stamp the SAME cost record onto the stack item they build: an X the search
// records and the server drops, a kicker the server partitions and the search
// does not, a cast mode one stamps and the other forgets, is a line the tree
// optimises and live play never reproduces. This file pins the record for
// the three shapes the issue names — an X cast, an alternative-cost cast and
// a kicked cast — on the same position, driven through the REGISTERED
// `announceCast` mutation on the server side (`gameMutationHarness.ts`) and
// through the search kernel on the Bot side.
//
// Mana is compared through the pool the server DRAINS; the search keeps a
// coarse tap-plan model and never drains the pool (`applyTapPlanInSearch`),
// so the pool is asserted on the server side only and the search Move
// carries an empty tap plan over the same floating pool.

import { describe, expect, it } from "vitest";
import { announceCast } from "../game";
import { commitCastInSearch } from "../gre/applyMove";
import type { Move } from "../gre/moves";
import { getPlayer, type GameState, type StackItem } from "../gre/state";
import { getCardByName } from "../cards";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type MutationStub,
} from "./gameMutationHarness";

const GAME = "game-1" as Id<"games">;
const idOf = (name: string) => getCardByName(name).id;
const EMPTY_POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

type CastMove = Extract<Move, { kind: "cast-spell" }>;

/** `name` in p1's hand as `"spell"`, `pool` floating, p1 to act. */
function position(name: string, pool: Partial<typeof EMPTY_POOL>): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(idOf(name), {
                        id: "spell",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                manaPool: { ...EMPTY_POOL, ...pool },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

/** The cost record a resolving spell reads back off its stack item — every
 *  field either kernel stamps at commit that describes WHAT WAS PAID or HOW
 *  the spell was cast. Fields absent on both sides compare equal as
 *  `undefined`, so a stamp one kernel adds and the other lacks is a diff. */
function costRecord(item: StackItem) {
    return {
        id: item.id,
        castById: item.castById,
        controllerId: item.controllerId,
        zone: item.zone,
        chosenX: item.chosenX,
        kickerPayments: item.kickerPayments,
        unkickedCostPayments: item.unkickedCostPayments,
        buybackPaid: item.buybackPaid,
        evoked: item.evoked,
        dashed: item.dashed,
        warped: item.warped,
        overloaded: item.overloaded,
        chosenModeIds: item.chosenModeIds,
        targets: item.targets,
        additionalSacrificeSnapshot: item.additionalSacrificeSnapshot,
        castFromGraveyard: item.castFromGraveyard,
        exileOnResolve: item.exileOnResolve,
        escaped: item.escaped,
        reboundFromHand: item.reboundFromHand,
        castOffSorceryTiming: item.castOffSorceryTiming,
    };
}

async function serverCommit(
    state: GameState,
    args: Record<string, unknown>
): Promise<GameState> {
    const harness: MutationStub = makeMutationCtx("p1", [gameStateSeed(state)]);
    await runMutation<Record<string, unknown>, unknown>(
        announceCast,
        harness.ctx,
        { gameId: GAME, playerId: "p1", cardInstanceId: "spell", ...args }
    );
    return harness.state();
}

function searchCommit(state: GameState, move: Omit<CastMove, "kind">) {
    const item = commitCastInSearch(
        state,
        "p1",
        { kind: "cast-spell", ...move },
        { handPriorityToCaster: true }
    );
    expect(item).not.toBeNull();
    return { state, item: item! };
}

/** Both kernels on the same position: the spell left the hand, ONE item is
 *  on the stack, and its cost record is identical. */
async function expectParity(
    name: string,
    pool: Partial<typeof EMPTY_POOL>,
    serverArgs: Record<string, unknown>,
    move: Omit<CastMove, "kind">
) {
    const server = await serverCommit(position(name, pool), serverArgs);
    const search = searchCommit(position(name, pool), move);

    expect(server.pendingCast).toBeUndefined();
    expect(server.stack.map((s) => s.id)).toEqual(["spell"]);
    expect(search.state.stack.map((s) => s.id)).toEqual(["spell"]);
    expect(getPlayer(server, "p1").hand).toHaveLength(0);
    expect(getPlayer(search.state, "p1").hand).toHaveLength(0);
    expect(costRecord(server.stack[0])).toEqual(costRecord(search.item));
    return { server, search };
}

describe("Cast Commit parity — server kernel vs search kernel (issue #4445)", () => {
    it("an X cast: Earthquake for X = 1 records chosenX on both sides (CR 107.3)", async () => {
        const { server } = await expectParity(
            "Earthquake",
            { R: 2 },
            { chosenX: 1 },
            {
                cardInstanceId: "spell",
                targets: [],
                confirmTargets: false,
                tapPlan: [],
                chosenX: 1,
            }
        );
        expect(server.stack[0].chosenX).toBe(1);
        // CR 601.2h — {X}{R} with X = 1 drained both red.
        expect(getPlayer(server, "p1").manaPool.R).toBe(0);
    });

    it("an alternative-cost cast: Ragavan dashed for {1}{R} is stamped `dashed` on both sides (CR 702.109a)", async () => {
        const { server } = await expectParity(
            "Ragavan, Nimble Pilferer",
            { R: 2 },
            { alternativeCostId: "dash" },
            {
                cardInstanceId: "spell",
                targets: [],
                confirmTargets: false,
                tapPlan: [],
                alternativeCostId: "dash",
            }
        );
        expect(server.stack[0].dashed).toBe(true);
        // CR 118.9 — the dash cost replaced the printed {R}: {1}{R} drained.
        expect(getPlayer(server, "p1").manaPool.R).toBe(0);
    });

    it("a kicked cast: Kavu Titan kicked carries the same partitioned payment record on both sides (CR 702.33d)", async () => {
        const { server } = await expectParity(
            "Kavu Titan",
            { G: 5 },
            { kickerPayments: { kicker: 1 } },
            {
                cardInstanceId: "spell",
                targets: [],
                confirmTargets: false,
                tapPlan: [],
                kickerPayments: { kicker: 1 },
            }
        );
        expect(server.stack[0].kickerPayments).toEqual({ kicker: 1 });
        // CR 601.2f — {1}{G} + {2}{G}: all five green drained.
        expect(getPlayer(server, "p1").manaPool.G).toBe(0);
    });
});
