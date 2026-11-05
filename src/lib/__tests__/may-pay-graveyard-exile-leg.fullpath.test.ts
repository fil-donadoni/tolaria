// Full-path integration for the may-pay GRAVEYARD EXILE leg (CR 118.12 / 118.3
// — "you may exile two cards from your graveyard. If you do, draw a card"):
// GRE → wire projection → client → game.ts. The client reads ONLY
// `projectPublicState`'s output; the REGISTERED `submitMayPay` handler receives
// the buffered pick and exiles those cards.

import { describe, it, expect } from "vitest";
import { submitMayPay } from "@convex/game";
import { projectPublicState } from "@convex/gameProjections";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup.helper";
import type { GameState } from "@convex/gre/state";
import {
    GRAVEYARD_LEG_FOREST_ID,
    graveyardCard,
} from "@convex/gre/__tests__/fixtures/mayPayGraveyardLegProbe.fixture";
import {
    fireGraveyardExileLegEtb,
    graveyardExileLegProbeInstance,
} from "@convex/gre/__tests__/fixtures/mayPayGraveyardExileLegProbe.fixture";
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
    mayPayGraveyardVerb,
} from "~/lib/card-utils";
import { isGraveyardChoiceActive } from "~/lib/graveyard-choice";

type SubmitMayPayArgs = {
    gameId: Id<"games">;
    playerId: string;
    accept: boolean;
    graveyardIds?: string[];
};

function board(graveyard: string[]): GameState {
    const probe = graveyardExileLegProbeInstance("probe", "p1");
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [probe],
                graveyard: graveyard.map((id) =>
                    graveyardCard(GRAVEYARD_LEG_FOREST_ID, id, "p1")
                ),
            }),
            makePlayer("p2"),
        ],
    });
    fireGraveyardExileLegEtb(state, probe);
    return state;
}

function canAfford(state: GameState): boolean {
    const view = projectPublicState(state, 1, "p1");
    const choice = view.pendingChoices![0] as PendingChoice;
    const me = view.players[0]!;
    return mayPayCanAfford(
        choice.cost,
        me.manaPool,
        me.life,
        0,
        undefined,
        undefined,
        [],
        0,
        me.graveyard
    );
}

describe("may-pay graveyard exile leg — GRE → wire → client → game.ts (CR 118.12)", () => {
    it("the client picks from the projected graveyard and the mutation exiles the picks", async () => {
        const state = board(["a", "b", "c"]);
        const view = projectPublicState(state, 1, "p1");
        const choice = view.pendingChoices![0] as PendingChoice;
        const me = view.players[0]!;

        expect(isGraveyardChoiceActive(choice, me, "p1")).toBe(true);
        expect(mayPayGraveyardVerb(choice.cost)).toBe("exile");
        expect(mayPayCostLabel(choice.cost)).toBe(
            "exile 2 cards from your graveyard"
        );
        expect(canAfford(state)).toBe(true);
        expect(
            mayPayGraveyardPickSatisfied(choice.cost, ["a"], me.graveyard)
        ).toBe(false);
        expect(
            mayPayGraveyardPickSatisfied(choice.cost, ["a", "c"], me.graveyard)
        ).toBe(true);

        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<SubmitMayPayArgs, void>(
            submitMayPay as unknown as Handler<SubmitMayPayArgs, void>,
            stub.ctx,
            {
                gameId: "game-1" as Id<"games">,
                playerId: "p1",
                accept: true,
                graveyardIds: ["a", "c"],
            }
        );
        const after = stub.state().players[0]!;
        expect(after.exile.map((c) => c.id).sort()).toEqual(["a", "c"]);
        expect(after.graveyard.map((c) => c.id)).toEqual(["b"]);
    });

    it("short of the count the client cannot Pay (CR 118.3)", () => {
        expect(canAfford(board(["a"]))).toBe(false);
    });
});
