// Full path for a GRANTED loyalty ability (issue #7199 — "Planeswalkers you
// control have '[+2]: …'", Sanctum Lurker / Avatar of Burgeoning Echoes): one
// board, read on both sides of the authority boundary. The client menu is
// built from `projectPublicState` + `buildTriggerStateView`, never a hand-built
// view; the activation runs through the real `activateAbility` handler.
// Engine-side rules (CR 606.3 allowance, the CR 704.5i exemption) are pinned in
// `convex/gre/__tests__/planeswalkerStatics.test.ts`.

import { describe, expect, it } from "vitest";
import { activateAbility } from "@convex/game";
import { withTemporaryDefinitionAsync } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import { syncLayer6 } from "@convex/gre/layer6";
import type { GameState } from "@convex/gre/state";
import type { Id } from "@convex/_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "@convex/__tests__/gameMutationHarness.fixture";
import {
    GRANTED_PLUS2,
    WALKER_STATICS,
    liliana,
    walkerBoard,
    walkerStaticsSource,
} from "@convex/gre/__tests__/planeswalkerStatics.fixture";
import type { CardInstance, Player } from "~/types/game";
import { buildTriggerStateView, getStackAbilities } from "../card-utils";

type ActivateArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    abilityId: string;
};

function board(withSource: boolean): GameState {
    const state = walkerBoard({
        mine: [
            ...(withSource ? [walkerStaticsSource()] : []),
            liliana("pw", "p1", 3),
        ],
    });
    syncLayer6(state);
    return state;
}

function clientMenu(state: GameState): string[] {
    const projected = projectPublicState(state, 1, "p1");
    const players = projected.players as unknown as Player[];
    const view = buildTriggerStateView(players, projected.activePlayerId);
    const pw = players
        .find((p) => p.id === "p1")!
        .battlefield.find((c) => c.id === "pw") as CardInstance;
    return getStackAbilities(pw, "PRECOMBAT_MAIN", true, view, 20).map(
        (a) => a.id
    );
}

describe("granted loyalty ability — mutation and client agree (CR 613.1f / 606)", () => {
    it("the client menu offers the granted [+2] and the mutation pays it on the walker", async () => {
        await withTemporaryDefinitionAsync(WALKER_STATICS, async () => {
            const state = board(true);
            expect(clientMenu(state)).toContain(GRANTED_PLUS2);

            const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
            await runMutation<ActivateArgs, void>(
                activateAbility as unknown as Handler<ActivateArgs, void>,
                stub.ctx,
                {
                    gameId: "game-1" as Id<"games">,
                    playerId: "p1",
                    cardInstanceId: "pw",
                    abilityId: GRANTED_PLUS2,
                }
            );
            const after = stub.state();
            const pw = after.players[0]!.battlefield.find((c) => c.id === "pw");
            expect(pw?.counters?.loyalty).toBe(5);
            expect(after.stack.map((s) => s.abilityId)).toEqual([
                GRANTED_PLUS2,
            ]);
        });
    });

    it("…and neither side offers it with no source on the battlefield", async () => {
        await withTemporaryDefinitionAsync(WALKER_STATICS, async () => {
            const state = board(false);
            expect(clientMenu(state)).not.toContain(GRANTED_PLUS2);

            const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
            await expect(
                runMutation<ActivateArgs, void>(
                    activateAbility as unknown as Handler<ActivateArgs, void>,
                    stub.ctx,
                    {
                        gameId: "game-1" as Id<"games">,
                        playerId: "p1",
                        cardInstanceId: "pw",
                        abilityId: GRANTED_PLUS2,
                    }
                )
            ).rejects.toThrow();
            expect(stub.writes).toHaveLength(0);
        });
    });
});
