// Integration test (issue #3076): `tapForActivationPayment` must refuse a mana
// tap the parked announcement does not owe — CR 605.3a allows a mana ability
// during an activation only to pay a mana payment it requires — and must refuse
// a permanent still needed as an outstanding sacrifice victim (the client gate
// mirrored, not a CR rule).
// Drives the REAL registered mutation `_handler` via the stub `MutationCtx`.

import { describe, it, expect } from "vitest";
import { tapForActivationPayment } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getCardByName } from "../cards/index";
import type { ManaCost } from "../cards/types";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
type Args = { gameId: Id<"games">; playerId: string; cardInstanceId: string };

const tap = (ctx: Parameters<typeof runMutation>[1], cardInstanceId: string) =>
    runMutation<Args, void>(
        tapForActivationPayment as unknown as Handler<Args, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );

function parkedState(manaCost: ManaCost): GameState {
    const on = (name: string, id: string) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    on("Priest of Yawgmoth", "src"),
                    on("Sol Ring", "solRing"),
                    on("Mountain", "mountain"),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    state.pendingActivation = {
        playerId: "p1",
        cardInstanceId: "src",
        abilityId: "priest-of-yawgmoth-mana",
        manaCost,
        tappedLandIds: [],
        sacrificeSelection: {
            playerId: "p1",
            reason: "Sacrifice an artifact",
            requirements: [{ filter: { types: ["Artifact"] }, count: 1 }],
            picked: [],
        },
    } as unknown as GameState["pendingActivation"];
    return state;
}

describe("tapForActivationPayment — parked sacrifice (CR 605.3a, issue #3076)", () => {
    it("refuses a tap when the announcement owes no mana", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(parkedState({}))]);
        await expect(tap(stub.ctx, "mountain")).rejects.toThrow(/owes no mana/);
    });

    it("refuses a mana source that is an outstanding sacrifice candidate", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(parkedState({ R: 1 })),
        ]);
        await expect(tap(stub.ctx, "solRing")).rejects.toThrow(
            /outstanding sacrifice candidate/
        );
    });

    it("still accepts a non-candidate mana source for the mana leg", async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(parkedState({ R: 1 })),
        ]);
        await tap(stub.ctx, "mountain");
        const p = stub.state().players[0];
        expect(p.battlefield.find((c) => c.id === "mountain")!.isTapped).toBe(
            true
        );
    });
});
