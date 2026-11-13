// Damping Sphere through the REAL tap mutation (`tapUntap`) — CR 614.1a: a
// land tapped for two or more mana adds one {C}, and the untap (CR 106.4)
// refunds that one {C}, not the printed amount. Covers both `tapUntap`
// deposit branches: the plain land and the restricted (Mishra's Workshop).

import { describe, expect, it } from "vitest";
import { tapUntap } from "../game";
import { withTemporaryDefinitionAsync } from "../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { dampingSphere } from "../cards/sets/dom/colorless.cards";
import { ancientTomb } from "../cards/sets/tmp/colorless.cards";
import { mishrasWorkshop } from "../cards/sets/atq/colorless.cards";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

type TapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const tap = (ctx: Parameters<typeof runMutation>[1], cardInstanceId: string) =>
    runMutation<TapArgs, void>(
        tapUntap as unknown as Handler<TapArgs, void>,
        ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            cardInstanceId,
        }
    );

const sphere = dampingSphere();

function seed(landId: string) {
    return gameStateSeed(
        makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(landId, {
                            id: "land",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(sphere.id, {
                            id: "sphere",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2", {}),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        })
    );
}

describe("Damping Sphere — tapUntap", () => {
    it("a two-mana land adds one {C}, and untapping refunds exactly one", () =>
        withTemporaryDefinitionAsync(sphere, async () => {
            const stub = makeMutationCtx("p1", [seed(ancientTomb().id)]);
            await tap(stub.ctx, "land");
            expect(stub.state().players[0].manaPool.C).toBe(2);
            await tap(stub.ctx, "land");
            // The floating {C} from elsewhere survives the untap.
            expect(stub.state().players[0].manaPool.C).toBe(1);
        }));

    it("a restricted three-mana land adds one {C} to the restricted pool too", () =>
        withTemporaryDefinitionAsync(sphere, async () => {
            const stub = makeMutationCtx("p1", [seed(mishrasWorkshop().id)]);
            await tap(stub.ctx, "land");
            const after = stub.state().players[0];
            const banked = (after.restrictedMana ?? []).reduce(
                (n, e) => n + (e.amount ?? 0),
                0
            );
            expect(banked).toBe(1);
            await tap(stub.ctx, "land");
            expect(stub.state().players[0].restrictedMana?.length ?? 0).toBe(0);
        }));
});
