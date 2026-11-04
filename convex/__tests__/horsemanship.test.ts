// Horsemanship (CR 702.31) through the REGISTERED `game.ts` block mutation: the
// attacker-keyed evasion rule on a printed and on a granted keyword (CR 613.1f,
// layer 6), and the direction the rule leaves open (CR 702.31b — a creature with
// horsemanship may block anything).

import { beforeAll, describe, expect, it } from "vitest";
import { assignBlockerTarget } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { preloadDefinitions } from "../cards/registry";
import type { CardDefinition } from "../cards/types";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
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

const RIDER: CardDefinition = {
    id: "test-horsemanship-rider",
    name: "Test Horsemanship Rider",
    rarity: "common",
    manaCost: { generic: 1, R: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
    staticAbilities: ["horsemanship"],
};

/** "Creatures you control have horsemanship" as the compiler lowers it. */
const LORD: CardDefinition = {
    id: "test-horsemanship-lord",
    name: "Test Horsemanship Lord",
    rarity: "rare",
    manaCost: { generic: 4, U: 2 },
    types: ["Creature"],
    power: 4,
    toughness: 4,
    compiledStaticEffects: [
        {
            kind: "keyword-grant",
            filter: { types: ["Creature"], controllerRelation: "you" },
            keyword: "horsemanship",
        },
    ],
};

beforeAll(() => preloadDefinitions([RIDER, LORD]));

function creature(
    defId: string,
    id: string,
    controllerId: string
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
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

describe("horsemanship through assignBlockerTarget (CR 702.31b)", () => {
    it("refuses a blocker without horsemanship", async () => {
        const { h, run } = assignToA(
            blocksState(
                [creature(RIDER.id, "a", "p1")],
                [creature(grizzlyBears().id, "x", "p2")]
            )
        );

        await expect(run()).rejects.toThrow(/horsemanship/);
        expect(h.state().combat!.blockerAssignments).toEqual({});
    });

    it("admits a blocker with horsemanship", async () => {
        const { h, run } = assignToA(
            blocksState(
                [creature(RIDER.id, "a", "p1")],
                [creature(RIDER.id, "x", "p2")]
            )
        );

        await run();
        expect(h.state().combat!.blockerAssignments).toEqual({ x: ["a"] });
    });

    it("lets a creature with horsemanship block one without it", async () => {
        const { h, run } = assignToA(
            blocksState(
                [creature(grizzlyBears().id, "a", "p1")],
                [creature(RIDER.id, "x", "p2")]
            )
        );

        await run();
        expect(h.state().combat!.blockerAssignments).toEqual({ x: ["a"] });
    });

    it("reads a GRANTED keyword on the attacker (CR 613.1f)", async () => {
        const { run } = assignToA(
            blocksState(
                [
                    creature(grizzlyBears().id, "a", "p1"),
                    creature(LORD.id, "lord", "p1"),
                ],
                [creature(grizzlyBears().id, "x", "p2")]
            )
        );

        await expect(run()).rejects.toThrow(/horsemanship/);
    });

    it("reads a GRANTED keyword on the blocker (CR 613.1f)", async () => {
        const { h, run } = assignToA(
            blocksState(
                [creature(RIDER.id, "a", "p1")],
                [
                    creature(grizzlyBears().id, "x", "p2"),
                    creature(LORD.id, "lord", "p2"),
                ]
            )
        );

        await run();
        expect(h.state().combat!.blockerAssignments).toEqual({ x: ["a"] });
    });
});
