// CR 601.2d / 120.4 — the divide-as-you-choose budget belongs to the target
// group that declared it (issue #2910). A spell with a divide group AND an
// `additionalTargetRequirements` group must split its budget across ONLY the
// divide group's picks; the other group's target is owed no amount.
//
// Every test drives the REAL path: `announceCast` -> `selectTarget` (the
// group advance) -> commit -> `resolveTopOfStack`. A `pushSpell` with a
// hand-built target list is what hid this gap.

import { describe, it, expect } from "vitest";
import { announceCast, selectTarget } from "../game";
import { resolveTopOfStack, getPlayer } from "../gre/state";
import { fieryJustice } from "../cards/sets/ice/multicolor.cards";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import { withTemporaryDefinitionAsync } from "../cards/registry";
import type { CardDefinition } from "../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

type TargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent" | "player";
    targetId: string;
    amount?: number;
};

/** Fiery Justice with its lifegain clause declared as a REAL second target
 *  group: "Target opponent gains 5 life" reads the announced slot. The divide
 *  group is a single creature here, so the opponent sits at slot 1. */
const dividedPlusOpponent = (): CardDefinition => ({
    ...fieryJustice(),
    additionalTargetRequirements: [
        { type: "player", count: 1, controller: "opponent" },
    ],
    effects: [
        { op: "dealDamageDividedAsChosen", total: 5 },
        { op: "gainLife", player: { target: 1 }, amount: 5 },
    ],
});

function board(): GameState {
    const spell = makeInstance(fieryJustice().id, {
        id: "fj",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const big = makeInstance(getCreatureId(), {
        id: "big",
        controllerId: "p2",
        ownerId: "p2",
        toughness: 9,
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell],
                manaPool: { W: 1, U: 0, B: 0, R: 1, G: 1, C: 0 },
            }),
            makePlayer("p2", { battlefield: [big], life: 20 }),
        ],
    });
}

function getCreatureId(): string {
    return grizzlyBears().id;
}

const pick = (
    harness: ReturnType<typeof makeMutationCtx>,
    args: Omit<TargetArgs, "gameId" | "playerId">
) =>
    runMutation<TargetArgs, void>(
        selectTarget as unknown as Handler<TargetArgs, void>,
        harness.ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

describe("divide budget is scoped to its own target group (CR 601.2d / 120.4, issue #2910)", () => {
    it("assigns all 5 damage to the divide group's one creature; the opponent group takes none and gains 5 life", async () => {
        await withTemporaryDefinitionAsync(dividedPlusOpponent(), async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
            await runMutation<
                {
                    gameId: Id<"games">;
                    playerId: string;
                    cardInstanceId: string;
                },
                void
            >(
                announceCast as unknown as Handler<
                    {
                        gameId: Id<"games">;
                        playerId: string;
                        cardInstanceId: string;
                    },
                    void
                >,
                harness.ctx,
                { gameId: GAME_ID, playerId: "p1", cardInstanceId: "fj" }
            );
            // Divide group: the whole budget on the one creature.
            await pick(harness, {
                targetType: "permanent",
                targetId: "big",
                amount: 5,
            });
            // Second group: the opponent, no amount.
            await pick(harness, { targetType: "player", targetId: "p2" });

            const state = harness.state();
            const item = state.stack[state.stack.length - 1];
            expect(item.targets).toEqual([
                { type: "permanent", id: "big" },
                { type: "player", id: "p2" },
            ]);
            // The split covers ONLY the divide group's slice.
            expect(item.targetAmounts).toEqual({ "permanent:big": 5 });

            resolveTopOfStack(state);
            const big = getPlayer(state, "p2").battlefield.find(
                (c) => c.id === "big"
            )!;
            expect(big.damageMarked).toBe(5);
            expect(getPlayer(state, "p2").life).toBe(25);
        });
    });
});
