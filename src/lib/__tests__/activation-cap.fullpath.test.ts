// Full path for `ActivatedAbility.maxActivationsPerTurn` (CR 602.5b —
// "Activate no more than twice each turn"), on Phyrexian Battleflies: one
// board, read on BOTH sides of the authority boundary. The registered
// `activateAbility` mutation runs through its real `_handler` against a stub
// ctx; the SAME board, projected by `projectPublicState` and reduced by
// `buildTriggerStateView`, decides the client's `getStackAbilities` menu.
// Below the cap both sides offer the activation, at the cap both refuse it, so
// neither half can pass by refusing everything.

import { describe, expect, it } from "vitest";
import { activateAbility } from "@convex/game";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import type { GameState } from "@convex/gre/state";
import type { Id } from "@convex/_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "@convex/__tests__/gameMutationHarness.fixture";
import type { CardInstance, Player } from "~/types/game";
import { buildTriggerStateView, getStackAbilities } from "../card-utils";

const GAME_ID = "game-1" as Id<"games">;
const ABILITY_ID = "phyrexian-battleflies-pump";

type ActivateArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    abilityId: string;
};

function board(usedThisTurn: number): GameState {
    const flies = makeInstance(getCardByName("Phyrexian Battleflies").id, {
        id: "flies",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        ...(usedThisTurn > 0
            ? { activationsThisTurn: { [ABILITY_ID]: usedThisTurn } }
            : {}),
    });
    const me = makePlayer("p1", { battlefield: [flies] });
    me.manaPool = { ...me.manaPool, B: 1 };
    return makeState({
        players: [me, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

function activate(state: GameState) {
    const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
    const run = runMutation<ActivateArgs, void>(
        activateAbility as unknown as Handler<ActivateArgs, void>,
        stub.ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId: "flies",
            abilityId: ABILITY_ID,
        }
    );
    return { stub, run };
}

function offered(state: GameState): boolean {
    const projected = projectPublicState(state, 1, "p1");
    const players = projected.players as unknown as Player[];
    const view = buildTriggerStateView(players, projected.activePlayerId);
    const card = players
        .find((p) => p.id === "p1")!
        .battlefield.find((c) => c.id === "flies") as CardInstance;
    return getStackAbilities(card, projected.phase, true, view).some(
        (a) => a.id === ABILITY_ID
    );
}

describe("maxActivationsPerTurn — mutation and client agree (CR 602.5b)", () => {
    it("allows the second activation of the turn on both sides", async () => {
        const state = board(1);
        expect(offered(state)).toBe(true);
        const { stub, run } = activate(state);
        await run;
        const flies = stub
            .state()
            .players[0].battlefield.find((c) => c.id === "flies")!;
        expect(flies.activationsThisTurn?.[ABILITY_ID]).toBe(2);
    });

    it("refuses the third on both sides", async () => {
        const state = board(2);
        expect(offered(state)).toBe(false);
        const { stub, run } = activate(state);
        await expect(run).rejects.toThrow(
            "Activate no more than 2 times each turn"
        );
        expect(stub.writes).toHaveLength(0);
    });
});
