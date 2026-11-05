// Skulk (CR 702.118) through the REGISTERED `game.ts` block mutation: the power
// comparison reads the layers on both sides (CR 613.4), the keyword may be granted
// (CR 613.1f, layer 6), and the rule restricts only who blocks a skulker, never
// what a skulker blocks.

import { beforeAll, describe, expect, it } from "vitest";
import { assignBlockerTarget } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { preloadDefinitions } from "../cards/registry";
import type { CardDefinition } from "../cards/types";
import {
    beginApplyingStaticEffects,
    recomputeContinuousEffects,
} from "../gre/state";
import type { CardInstanceState, GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

const body = (slug: string, power: number): CardDefinition => ({
    id: `test-skulk-${slug}`,
    name: `Test Skulk ${slug}`,
    rarity: "common",
    manaCost: { generic: 1, B: 1 },
    types: ["Creature"],
    power,
    toughness: 4,
});

const SKULKER: CardDefinition = {
    ...body("skulker", 2),
    staticAbilities: ["skulk"],
};
const TWO = body("two", 2);
const THREE = body("three", 3);

/** "Creatures you control have skulk" as the compiler lowers it. */
const LORD: CardDefinition = {
    ...body("lord", 0),
    compiledStaticEffects: [
        {
            kind: "keyword-grant",
            filter: { types: ["Creature"], controllerRelation: "you" },
            keyword: "skulk",
        },
    ],
};

beforeAll(() => preloadDefinitions([SKULKER, TWO, THREE, LORD]));

function creature(
    def: CardDefinition,
    id: string,
    controllerId: string,
    plusOneCounters = 0
): CardInstanceState {
    return makeInstance(def.id, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
        ...(plusOneCounters > 0
            ? { counters: { "+1/+1": plusOneCounters } }
            : {}),
    });
}

/** p1 attacks with `a`; p2 has already picked `x` as the pending blocker. */
function blocksState(
    p1Battlefield: CardInstanceState[],
    p2Battlefield: CardInstanceState[]
): GameState {
    const state = makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p2",
        players: [
            makePlayer("p1", { battlefield: p1Battlefield }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
        combat: {
            attackerIds: ["a"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
            pendingBlockerId: "x",
        },
    });
    for (const permanent of [...p1Battlefield, ...p2Battlefield]) {
        beginApplyingStaticEffects(state, permanent);
    }
    recomputeContinuousEffects(state);
    return state;
}

const assignToA = (state: GameState) => {
    const h = makeMutationCtx("p2", [gameStateSeed(state)]);
    type Args = { gameId: Id<"games">; playerId: string; attackerId: string };
    return {
        h,
        run: () =>
            runMutation<Args, void>(
                assignBlockerTarget as unknown as Handler<Args, void>,
                h.ctx,
                { gameId: GAME_ID, playerId: "p2", attackerId: "a" }
            ),
    };
};

describe("skulk through assignBlockerTarget (CR 702.118b)", () => {
    it("refuses a blocker with greater power", async () => {
        const { h, run } = assignToA(
            blocksState(
                [creature(SKULKER, "a", "p1")],
                [creature(THREE, "x", "p2")]
            )
        );

        await expect(run()).rejects.toThrow(/skulk/);
        expect(h.state().combat!.blockerAssignments).toEqual({});
    });

    it("admits a blocker with equal power", async () => {
        const { h, run } = assignToA(
            blocksState(
                [creature(SKULKER, "a", "p1")],
                [creature(TWO, "x", "p2")]
            )
        );

        await run();
        expect(h.state().combat!.blockerAssignments).toEqual({ x: ["a"] });
    });

    it("lets a creature with skulk block a stronger attacker", async () => {
        const { h, run } = assignToA(
            blocksState(
                [creature(THREE, "a", "p1")],
                [creature(SKULKER, "x", "p2")]
            )
        );

        await run();
        expect(h.state().combat!.blockerAssignments).toEqual({ x: ["a"] });
    });

    it("reads the attacker's EFFECTIVE power (CR 613.4c)", async () => {
        const { h, run } = assignToA(
            blocksState(
                [creature(SKULKER, "a", "p1", 1)],
                [creature(THREE, "x", "p2")]
            )
        );

        await run();
        expect(h.state().combat!.blockerAssignments).toEqual({ x: ["a"] });
    });

    it("reads the blocker's EFFECTIVE power (CR 613.4c)", async () => {
        const { run } = assignToA(
            blocksState(
                [creature(SKULKER, "a", "p1")],
                [creature(TWO, "x", "p2", 1)]
            )
        );

        await expect(run()).rejects.toThrow(/skulk/);
    });

    it("reads a GRANTED keyword on the attacker (CR 613.1f)", async () => {
        const { run } = assignToA(
            blocksState(
                [creature(TWO, "a", "p1"), creature(LORD, "lord", "p1")],
                [creature(THREE, "x", "p2")]
            )
        );

        await expect(run()).rejects.toThrow(/skulk/);
    });
});
