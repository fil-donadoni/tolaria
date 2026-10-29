// Full-path: a mana ability whose cost has no {T} (Wall of Roots' placed
// counter) during a may-pay window (CR 605.3a / 608.2g). `tapUntap` must not
// tap such a source for nothing; `activateManaAbility` pays the cost leg, adds
// the mana and leaves the source untapped, and that mana pays the may-pay.
// Scenario built from real resolutions (Mana Tithe against p1's Bolt), the
// mutations driven through their registered `_handler`.

import { describe, it, expect } from "vitest";
import { activateManaAbility, submitMayPay, tapUntap } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../gre/state";
import { getCardByName } from "../cards";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const WALL = getCardByName("Wall of Roots").id;
const FOREST = getCardByName("Forest").id;
const MANA_TITHE = getCardByName("Mana Tithe").id;
const BOLT = getCardByName("Lightning Bolt").id;
const ABILITY = "wall-of-roots-mana";

type Ctx = Parameters<typeof runMutation>[1];
type TapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};
type ManaArgs = TapArgs & { abilityId: string };
type PayArgs = { gameId: Id<"games">; playerId: string; accept: boolean };

const runTap = (ctx: Ctx, cardInstanceId: string) =>
    runMutation<TapArgs, void>(
        tapUntap as unknown as Handler<TapArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId,
        }
    );
const runMana = (ctx: Ctx, cardInstanceId: string) =>
    runMutation<ManaArgs, void>(
        activateManaAbility as unknown as Handler<ManaArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId, abilityId: ABILITY }
    );
const runPay = (ctx: Ctx) =>
    runMutation<PayArgs, void>(
        submitMayPay as unknown as Handler<PayArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            accept: true,
        }
    );

function mayPayState(): GameState {
    const state = makeState({
        activePlayerId: "p2",
        priorityPlayerId: "p2",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(WALL, {
                        id: "wall",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(FOREST, {
                        id: "forest",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    const victim = pushSpell(state, BOLT, "p1");
    pushSpell(state, MANA_TITHE, "p2", [{ type: "spell", id: victim.id }]);
    resolveTopOfStack(state);
    return state;
}

describe("tap-less mana ability during a may-pay window (CR 605.3a / 608.2g)", () => {
    it("tapUntap refuses to tap the source for nothing", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(mayPayState())]);
        await expect(runTap(stub.ctx, "wall")).rejects.toThrow(
            /activateManaAbility/
        );
        const wall = stub
            .state()
            .players[0].battlefield.find((c) => c.id === "wall")!;
        expect(wall.isTapped).toBe(false);
    });

    it("activateManaAbility adds the mana untapped, and it pays the may-pay", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(mayPayState())]);
        await runMana(stub.ctx, "wall");
        const after = stub.state();
        const wall = after.players[0].battlefield.find((c) => c.id === "wall")!;
        expect(wall.isTapped).toBe(false);
        expect(after.players[0].manaPool.G).toBe(1);
        expect(JSON.stringify(wall.counters ?? {})).toContain("-0/-1");

        await runPay(stub.ctx);
        const paid = stub.state();
        expect(paid.players[0].manaPool.G ?? 0).toBe(0);
        expect(paid.pendingChoices ?? []).toHaveLength(0);
        expect(
            paid.players[0].graveyard.map((c) => (c.card as { id?: string }).id)
        ).not.toContain(BOLT);
    });

    it("regression: a {T} land still taps for mana in the window", async () => {
        const stub = makeMutationCtx("p1", [gameStateSeed(mayPayState())]);
        await runTap(stub.ctx, "forest");
        const after = stub.state();
        expect(after.players[0].manaPool.G).toBe(1);
        expect(
            after.players[0].battlefield.find((c) => c.id === "forest")!
                .isTapped
        ).toBe(true);
    });
});
