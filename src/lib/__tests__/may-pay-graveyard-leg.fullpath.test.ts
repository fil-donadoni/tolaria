// Full-path integration for the may-pay GRAVEYARD leg (CR 118.3 / 118.12a —
// Harvest Wurm, "sacrifice it unless you return a basic land card from your
// graveyard to your hand"): GRE → wire projection → client → game.ts.
//
//  1. GRE: the probe's ETB suspends on the may-pay offer.
//  2. WIRE + CLIENT: the client reads ONLY `projectPublicState`'s output; the
//     graveyard picker activates on it, the Pay gate prices the leg from the
//     projected graveyard, and the pick gate accepts exactly the legal cards.
//  3. game.ts: the REGISTERED `submitMayPay` handler (stub `MutationCtx`)
//     receives the client's buffered `graveyardIds` and moves that card.

import { describe, it, expect } from "vitest";
import { submitMayPay } from "@convex/game";
import { projectPublicState } from "@convex/gameProjections";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup.helper";
import type { GameState } from "@convex/gre/state";
import {
    GRAVEYARD_LEG_FOREST_ID,
    GRAVEYARD_LEG_NONBASIC_ID,
    fireGraveyardLegEtb,
    graveyardCard,
    graveyardLegProbeInstance,
} from "@convex/gre/__tests__/fixtures/mayPayGraveyardLegProbe.fixture";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "@convex/__tests__/gameMutationHarness.fixture";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice } from "~/types/game";
import {
    mayPayCanAfford,
    mayPayCostLabel,
    mayPayGraveyardPickSatisfied,
    mayPayRequiredGraveyardReturns,
} from "~/lib/card-utils";
import { isGraveyardChoiceActive } from "~/lib/graveyard-choice";

const GAME_ID = "game-1" as Id<"games">;

type SubmitMayPayArgs = {
    gameId: Id<"games">;
    playerId: string;
    accept: boolean;
    graveyardIds?: string[];
};

function board(graveyard: string[][]): GameState {
    const probe = graveyardLegProbeInstance("wurm", "p1");
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [probe],
                graveyard: graveyard.map(([defId, id]) =>
                    graveyardCard(defId!, id!, "p1")
                ),
            }),
            makePlayer("p2"),
        ],
    });
    fireGraveyardLegEtb(state, probe);
    return state;
}

function submit(state: GameState, args: Omit<SubmitMayPayArgs, "gameId">) {
    const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
    return {
        stub,
        run: () =>
            runMutation<SubmitMayPayArgs, void>(
                submitMayPay as unknown as Handler<SubmitMayPayArgs, void>,
                stub.ctx,
                { gameId: GAME_ID, ...args }
            ),
    };
}

describe("may-pay graveyard leg — GRE → wire → client → game.ts (CR 118.12a)", () => {
    it("the client picks the card from the projected graveyard and the mutation returns it", async () => {
        const state = board([
            [GRAVEYARD_LEG_FOREST_ID, "f1"],
            [GRAVEYARD_LEG_NONBASIC_ID, "n1"],
        ]);
        const view = projectPublicState(state, 1, "p1");
        const choice = view.pendingChoices![0] as PendingChoice;
        const me = view.players[0]!;

        // The graveyard pile becomes the picker for the chooser's own pile only.
        expect(isGraveyardChoiceActive(choice, me, "p1")).toBe(true);
        expect(isGraveyardChoiceActive(choice, view.players[1]!, "p1")).toBe(
            false
        );
        expect(isGraveyardChoiceActive(choice, me, "p2")).toBe(false);
        expect(mayPayRequiredGraveyardReturns(choice.cost)).toBe(1);
        expect(mayPayCostLabel(choice.cost)).toBe(
            "return a basic land card from your graveyard"
        );

        // Pay is affordable from the projected graveyard; the pick gate takes
        // the basic land and refuses the nonbasic one and an empty buffer.
        expect(
            mayPayCanAfford(
                choice.cost,
                me.manaPool,
                me.life,
                0,
                undefined,
                undefined,
                [],
                0,
                me.graveyard
            )
        ).toBe(true);
        expect(
            mayPayGraveyardPickSatisfied(choice.cost, [], me.graveyard)
        ).toBe(false);
        expect(
            mayPayGraveyardPickSatisfied(choice.cost, ["n1"], me.graveyard)
        ).toBe(false);
        expect(
            mayPayGraveyardPickSatisfied(choice.cost, ["f1"], me.graveyard)
        ).toBe(true);

        // The buffered pick travels through the REAL mutation.
        const { stub, run } = submit(state, {
            playerId: "p1",
            accept: true,
            graveyardIds: ["f1"],
        });
        await run();
        const after = stub.state();
        expect(after.players[0]!.hand.map((c) => c.id)).toEqual(["f1"]);
        expect(after.players[0]!.graveyard.map((c) => c.id)).toEqual(["n1"]);
        expect(after.players[0]!.battlefield.map((c) => c.id)).toEqual([
            "wurm",
        ]);
        expect(after.pendingChoices ?? []).toHaveLength(0);
    });

    it("an accept without the pick is refused by the mutation", async () => {
        const state = board([[GRAVEYARD_LEG_FOREST_ID, "f1"]]);
        const { run } = submit(state, { playerId: "p1", accept: true });
        await expect(run()).rejects.toThrow(/Illegal graveyard choice/);
    });

    it("with no basic land card the client cannot Pay, and declining sacrifices the source", async () => {
        const state = board([[GRAVEYARD_LEG_NONBASIC_ID, "n1"]]);
        const view = projectPublicState(state, 1, "p1");
        const choice = view.pendingChoices![0] as PendingChoice;
        const me = view.players[0]!;
        expect(isGraveyardChoiceActive(choice, me, "p1")).toBe(false);
        expect(
            mayPayCanAfford(
                choice.cost,
                me.manaPool,
                me.life,
                0,
                undefined,
                undefined,
                [],
                0,
                me.graveyard
            )
        ).toBe(false);

        const { stub, run } = submit(state, { playerId: "p1", accept: false });
        await run();
        const after = stub.state();
        expect(after.players[0]!.battlefield).toHaveLength(0);
        expect(after.players[0]!.graveyard.map((c) => c.id).sort()).toEqual([
            "n1",
            "wurm",
        ]);
    });
});
