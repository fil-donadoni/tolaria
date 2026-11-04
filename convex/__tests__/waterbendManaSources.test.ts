// CR 701.67a: a permanent picked to pay a generic pip by tapping is spoken for.
// Tapped for mana as well, the commit would find it tapped and drop the
// activation with its mana spent. Drives the REAL registered mutations.

import { describe, it, expect } from "vitest";
import {
    activateManaAbility,
    autoTapForPayment,
    declineGenericSubstitution,
    tapForActivationPayment,
} from "../game";
import { selectActivationCostOnState, activateAbilityOnState } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getCardByName } from "../cards/index";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
type TapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};
type AutoArgs = { gameId: Id<"games">; playerId: string };
type ManaArgs = TapArgs & { abilityId: string; tapOtherIds: string[] };

function pickedRing(): GameState {
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
                    on("Aang's Iceberg", "iceberg"),
                    on("Sol Ring", "ring"),
                    on("Mountain", "m1"),
                    on("Mountain", "m2"),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "iceberg",
        abilityId: "aangs-iceberg-waterbend",
    });
    selectActivationCostOnState(state, {
        playerId: "p1",
        cardInstanceId: "ring",
    });
    return state;
}

describe("waterbend picks are not mana sources (CR 701.67a)", () => {
    it("tapForActivationPayment refuses a picked permanent", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(pickedRing())]);
        await expect(
            runMutation<TapArgs, void>(
                tapForActivationPayment as unknown as Handler<TapArgs, void>,
                stub.ctx,
                { gameId: GAME_ID, playerId: "p1", cardInstanceId: "ring" }
            )
        ).rejects.toThrow(/already paying/);
    });

    it("activateManaAbility refuses a picked permanent as another ability's fodder", async () => {
        const state = pickedRing();
        state.players[0].battlefield.push(
            makeInstance(getCardByName("Urza, Lord High Artificer").id, {
                id: "urza",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            runMutation<ManaArgs, void>(
                activateManaAbility as unknown as Handler<ManaArgs, void>,
                stub.ctx,
                {
                    gameId: GAME_ID,
                    playerId: "p1",
                    cardInstanceId: "urza",
                    abilityId: "urza-lha-mana",
                    tapOtherIds: ["ring"],
                }
            )
        ).rejects.toThrow(/already paying/);
    });

    it("autoTapForPayment pays the rest around the pick, and the ability goes on the stack", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(pickedRing())]);
        await runMutation<AutoArgs, void>(
            autoTapForPayment as unknown as Handler<AutoArgs, void>,
            stub.ctx,
            { gameId: GAME_ID, playerId: "p1" }
        );
        const state = stub.state();
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        const tapped = state.players[0].battlefield
            .filter((c) => c.isTapped)
            .map((c) => c.id)
            .sort();
        expect(tapped).toEqual(["m1", "m2", "ring"]);
    });
});

describe("declining a waterbend tap (CR 701.67a)", () => {
    const floatingOffer = () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(getCardByName("Aang's Iceberg").id, {
                            id: "iceberg",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                        }),
                        makeInstance(getCardByName("Grizzly Bears").id, {
                            id: "bears",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.players[0].manaPool.R = 3;
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "iceberg",
            abilityId: "aangs-iceberg-waterbend",
        });
        return state;
    };

    it("the mutation spends the floating mana and the ability goes on the stack", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(floatingOffer())]);
        await runMutation<AutoArgs, void>(
            declineGenericSubstitution as unknown as Handler<AutoArgs, void>,
            stub.ctx,
            { gameId: GAME_ID, playerId: "p1" }
        );
        const state = stub.state();
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.players[0].manaPool.R).toBe(0);
    });

    it("auto-tap with the offer standing leaves it standing and spends nothing", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(floatingOffer())]);
        await runMutation<AutoArgs, void>(
            autoTapForPayment as unknown as Handler<AutoArgs, void>,
            stub.ctx,
            { gameId: GAME_ID, playerId: "p1" }
        );
        const state = stub.state();
        expect(state.pendingActivation?.genericSubstitutionOffer).toBe(true);
        expect(state.players[0].manaPool.R).toBe(3);
    });
});
