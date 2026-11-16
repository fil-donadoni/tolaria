// `cost.exileFilter` through the REAL mutations — CR 602.1a / 602.2b /
// 701.13a / 118.3. City of Shadows' "{T}, Exile a creature you control: Put a
// storage counter on this land."
//
// The GRE half (`gre/__tests__/exileFilterActivationCost.test.ts`) drives the
// pure entry points; this file drives the registered `activateAbility` /
// `selectSacrifice` / `cancelActivation` handlers over the stub `MutationCtx`,
// and reads the parked pick back through `projectPublicState` — the wire the
// client renders its battlefield picker and banner from.

import { describe, it, expect } from "vitest";
import { activateAbility, cancelActivation, selectSacrifice } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getCardByName } from "../cards";
import { projectPublicState } from "../gameProjections";
import { nextOwedPayment } from "../gre/owedPayment";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const CITY = getCardByName("City of Shadows").id;
const ELF = getCardByName("Llanowar Elves").id;
const STORE = "city-of-shadows-store";

type ActivateArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    abilityId: string;
};
type PickArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};
type CancelArgs = { gameId: Id<"games">; playerId: string };

function board(creatures: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(CITY, {
                        id: "city",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    ...Array.from({ length: creatures }, (_, i) =>
                        makeInstance(ELF, {
                            id: `elf-${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                            // Tapped vs untapped: not fungible, so a real pick.
                            isTapped: i === 1,
                        })
                    ),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

const ctxFor = (state: GameState) =>
    makeMutationCtx("p1", [gameStateSeed(state)]);

const runActivate = (ctx: ReturnType<typeof ctxFor>): Promise<void> =>
    runMutation<ActivateArgs, void>(
        activateAbility as unknown as Handler<ActivateArgs, void>,
        ctx.ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId: "city",
            abilityId: STORE,
        }
    );
const runPick = (ctx: ReturnType<typeof ctxFor>, cardInstanceId: string) =>
    runMutation<PickArgs, void>(
        selectSacrifice as unknown as Handler<PickArgs, void>,
        ctx.ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );
const runCancel = (ctx: ReturnType<typeof ctxFor>) =>
    runMutation<CancelArgs, void>(
        cancelActivation as unknown as Handler<CancelArgs, void>,
        ctx.ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

const battlefieldIds = (state: GameState) =>
    state.players[0].battlefield.map((c) => c.id);

describe("exileFilter through activateAbility → selectSacrifice (CR 602.2b / 701.13a)", () => {
    it("parks an EXILE pick that crosses the wire, then exiles the chosen creature", async () => {
        const ctx = ctxFor(board(2));

        await runActivate(ctx);

        const parked = ctx.state();
        expect(nextOwedPayment(parked, "p1")?.kind).toBe(
            "activation:sacrificeSelection"
        );
        expect(parked.stack).toHaveLength(0);
        expect(battlefieldIds(parked)).toEqual(["city", "elf-0", "elf-1"]);
        // The client's picker reads the requirement off the PROJECTED state:
        // the exile action must survive `projectPublicState`, or the banner
        // says "sacrifice" for a creature that goes to exile.
        const view = projectPublicState(parked, 1, "p1");
        expect(
            view.pendingActivation?.sacrificeSelection?.requirements[0]
        ).toMatchObject({ count: 1, action: "exile" });

        await runPick(ctx, "elf-1");

        const after = ctx.state();
        expect(after.pendingActivation).toBeUndefined();
        expect(after.stack).toHaveLength(1);
        expect(after.players[0].exile.map((c) => c.id)).toEqual(["elf-1"]);
        expect(after.players[0].graveyard).toHaveLength(0);
        expect(battlefieldIds(after)).toEqual(["city", "elf-0"]);
    });

    it("cancelling the pick rewinds the activation — every creature stays (CR 601.2h)", async () => {
        const ctx = ctxFor(board(2));
        await runActivate(ctx);

        await runCancel(ctx);

        const after = ctx.state();
        expect(after.pendingActivation).toBeUndefined();
        expect(after.stack).toHaveLength(0);
        expect(battlefieldIds(after)).toEqual(["city", "elf-0", "elf-1"]);
        expect(after.players[0].exile).toHaveLength(0);
    });

    it("refuses the activation with no creature to exile (CR 118.3)", async () => {
        const ctx = ctxFor(board(0));
        await expect(runActivate(ctx)).rejects.toThrow(/exile cost/);
        expect(ctx.state().pendingActivation).toBeUndefined();
        expect(ctx.state().stack).toHaveLength(0);
    });
});
