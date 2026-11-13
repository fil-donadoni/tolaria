// Eldrazi Temple's SECOND mana ability (issue #8615, CR 106.6): tapping it
// through the real `tapUntap` mutation floats `colorless-eldrazi` mana in the
// parallel `restrictedMana` pool, and the projection a client reads keeps the
// tag. Same harness discipline as `tapUntapRestrictedManaAbility.test.ts`.

import { describe, it, expect } from "vitest";
import { tapUntap } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { eldraziTemple } from "../cards/sets/roe/colorless.cards";
import { preloadDefinitions } from "../cards";
import { projectPublicState } from "../gameProjections";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

type TapUntapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};

describe("tapUntap — Eldrazi Temple's restricted {C}{C} ability (CR 106.6)", () => {
    it("floats colorless-eldrazi mana, not fungible mana, and the projection keeps the tag", async () => {
        preloadDefinitions([eldraziTemple()]);
        const temple = makeInstance(eldraziTemple().id, {
            id: "temple",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [temple] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        // Index 0 is the plain {C} ability, index 1 the restricted {C}{C} one.
        await runMutation<TapUntapArgs, void>(
            tapUntap as unknown as Handler<TapUntapArgs, void>,
            stub.ctx,
            {
                gameId: "game-1" as Id<"games">,
                playerId: "p1",
                cardInstanceId: "temple",
                manaChoiceIndex: 1,
            }
        );

        const after = stub.state();
        expect(after.players[0].manaPool.C ?? 0).toBe(0);
        expect(after.players[0].restrictedMana).toEqual([
            expect.objectContaining({
                color: "C",
                amount: 2,
                restriction: "colorless-eldrazi",
            }),
        ]);
        const projected = projectPublicState(after, 1, "p1");
        expect(projected.players[0].restrictedMana).toEqual([
            expect.objectContaining({
                color: "C",
                amount: 2,
                restriction: "colorless-eldrazi",
            }),
        ]);
    });
});
