// Bot integration: a may-pay GRAVEYARD EXILE leg (CR 118.12 / 118.3) across both
// Bot surfaces. Exiled cards are GIVEN UP, so both pick the LEAST valuable — the
// opposite of the return leg, whose cards come back to hand. The leg never
// auto-picks, so an accept without its ids would freeze the driver.

import { describe, expect, it } from "vitest";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup.helper";
import type { GameState } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import {
    GRAVEYARD_LEG_FOREST_ID,
    graveyardCard,
} from "@convex/gre/__tests__/fixtures/mayPayGraveyardLegProbe.fixture";
import {
    fireGraveyardExileLegEtb,
    graveyardExileLegProbeInstance,
} from "@convex/gre/__tests__/fixtures/mayPayGraveyardExileLegProbe.fixture";
import { applyMayPaySubmit } from "@convex/gre/pendingChoiceSubmit";
import { choiceCandidates } from "@convex/gre/ai/choiceCandidates";
import { tryGetCardByName } from "@convex/cards";
import { buildBotView } from "../bot-view";

const BOT = "u1-p2";
const HUMAN = "u1-p1";

const DRAGON_ID = tryGetCardByName("Shivan Dragon")!.id;

/** Two lands and the one card worth keeping. */
function board(): GameState {
    const probe = graveyardExileLegProbeInstance("probe", BOT);
    const state = makeState({
        players: [
            makePlayer(HUMAN),
            makePlayer(BOT, {
                battlefield: [probe],
                graveyard: [
                    graveyardCard(DRAGON_ID, "dragon", BOT),
                    graveyardCard(GRAVEYARD_LEG_FOREST_ID, "f1", BOT),
                    graveyardCard(GRAVEYARD_LEG_FOREST_ID, "f2", BOT),
                ],
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    fireGraveyardExileLegEtb(state, probe);
    return state;
}

describe("may-pay graveyard exile leg — picks what it gives up (CR 118.12)", () => {
    it("the client driver exiles the least valuable cards", () => {
        const state = board();
        const owed = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(owed.owedChoice?.affordable).toBe(true);
        expect(new Set(owed.owedChoice?.graveyardIds)).toEqual(
            new Set(["f1", "f2"])
        );
    });

    it("the search's accept exiles the least valuable cards, and the submit takes it", () => {
        const state = board();
        const accepts = choiceCandidates(
            state,
            state.pendingChoices![0]!
        ).filter((c) => c.move.kind === "may-pay" && c.move.accept);
        expect(accepts).toHaveLength(1);
        const move = accepts[0]!.move;
        if (move.kind !== "may-pay") throw new Error("expected may-pay");
        expect(new Set(move.graveyardIds)).toEqual(new Set(["f1", "f2"]));

        applyMayPaySubmit(state, {
            playerId: BOT,
            accept: true,
            graveyardIds: move.graveyardIds,
        });
        expect(state.players[1]!.graveyard.map((c) => c.id)).toEqual([
            "dragon",
        ]);
    });
});
