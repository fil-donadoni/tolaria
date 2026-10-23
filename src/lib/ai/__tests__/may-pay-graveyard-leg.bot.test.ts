// Bot integration: a may-pay GRAVEYARD leg (CR 118.3 / 118.12a — Harvest
// Wurm) across both Bot surfaces.
//
// The leg NEVER auto-picks — it prompts even with one legal card — so an
// accept that travels without `graveyardIds` is refused by `submitMayPay` and
// the driver re-answers the same state forever (a freeze). Guarded on both
// paths that answer a may-pay: the client driver (`buildBotView` →
// `chooseOwedChoiceAction` → `botActionToMove` → `executeMove`) and the
// search's in-tree choice node (`choiceCandidates`).

import { describe, expect, it } from "vitest";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup.helper";
import type { GameState } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import {
    GRAVEYARD_LEG_FOREST_ID,
    GRAVEYARD_LEG_ISLAND_ID,
    GRAVEYARD_LEG_NONBASIC_ID,
    fireGraveyardLegEtb,
    graveyardCard,
    graveyardLegProbeInstance,
} from "@convex/gre/__tests__/fixtures/mayPayGraveyardLegProbe.fixture";
import { applyMayPaySubmit } from "@convex/gre/pendingChoiceSubmit";
import { choiceCandidates } from "@convex/gre/ai/choiceCandidates";
import { chooseOwedChoiceAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const BOT = "u1-p2";
const HUMAN = "u1-p1";

/** Fake mutation surface routing `submitMayPay` (with every pick field)
 *  through the SAME engine primitive the real `game.ts` mutation calls. */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in may-pay graveyard flow");
    };
    return new Proxy({} as MoveMutations, {
        get: (_t, key) =>
            key === "submitMayPay"
                ? async (
                      args: Parameters<MoveMutations["submitMayPay"]>[0]
                  ) => {
                      applyMayPaySubmit(state, {
                          playerId: args.playerId,
                          accept: args.accept,
                          sacrificeIds: args.sacrificeIds,
                          discardIds: args.discardIds,
                          graveyardIds: args.graveyardIds,
                      });
                  }
                : reject,
    });
}

function boardWithProbe(graveyard: [string, string][]): GameState {
    const probe = graveyardLegProbeInstance("wurm", BOT);
    const state = makeState({
        players: [
            makePlayer(HUMAN, { life: 20 }),
            makePlayer(BOT, {
                life: 20,
                battlefield: [probe],
                graveyard: graveyard.map(([defId, id]) =>
                    graveyardCard(defId, id, BOT)
                ),
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    fireGraveyardLegEtb(state, probe);
    return state;
}

describe("may-pay graveyard leg — client bot driver (CR 118.12a)", () => {
    it("surfaces the pick even with exactly one legal card", () => {
        const state = boardWithProbe([
            [GRAVEYARD_LEG_FOREST_ID, "only"],
            [GRAVEYARD_LEG_NONBASIC_ID, "n1"],
        ]);
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.owedChoice?.kind).toBe("may-pay");
        expect(view.owedChoice?.affordable).toBe(true);
        expect(view.owedChoice?.graveyardIds).toEqual(["only"]);
    });

    it("pays end-to-end: pick → move → mutation → the card returns to hand", async () => {
        const state = boardWithProbe([
            [GRAVEYARD_LEG_FOREST_ID, "f1"],
            [GRAVEYARD_LEG_ISLAND_ID, "i1"],
        ]);
        const projected = projectPublicState(state, 1, BOT);
        const action = chooseOwedChoiceAction(
            buildBotView(projected, BOT).owedChoice!
        );
        if (action.kind !== "may-pay") throw new Error("expected may-pay");
        expect(action.accept).toBe(true);
        expect(action.graveyardIds).toHaveLength(1);

        const move = botActionToMove(action, projected, BOT);
        if (move?.kind !== "may-pay") throw new Error("expected may-pay move");
        expect(move.graveyardIds).toEqual(action.graveyardIds);

        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        const bot = state.players[1]!;
        expect(bot.hand.map((c) => c.id)).toEqual(action.graveyardIds);
        expect(bot.battlefield.map((c) => c.id)).toEqual(["wurm"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("declines when no basic land card can pay (no stall)", () => {
        const state = boardWithProbe([[GRAVEYARD_LEG_NONBASIC_ID, "n1"]]);
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.owedChoice?.affordable).toBe(false);
        expect(chooseOwedChoiceAction(view.owedChoice!)).toEqual({
            kind: "may-pay",
            accept: false,
        });
    });
});

describe("may-pay graveyard leg — search choice node (CR 118.12a)", () => {
    it("every accept candidate carries a pick the submit boundary accepts", () => {
        const state = boardWithProbe([
            [GRAVEYARD_LEG_FOREST_ID, "f1"],
            [GRAVEYARD_LEG_NONBASIC_ID, "n1"],
        ]);
        const candidates = choiceCandidates(state, state.pendingChoices![0]!);
        const accepts = candidates.filter(
            (c) => c.move.kind === "may-pay" && c.move.accept
        );
        expect(accepts).toHaveLength(1);
        const move = accepts[0]!.move;
        if (move.kind !== "may-pay") throw new Error("expected may-pay");
        expect(move.graveyardIds).toEqual(["f1"]);

        const branch = structuredClone(state);
        applyMayPaySubmit(branch, {
            playerId: BOT,
            accept: true,
            graveyardIds: move.graveyardIds,
        });
        expect(branch.players[1]!.hand.map((c) => c.id)).toEqual(["f1"]);
    });

    it("offers only the decline when the graveyard cannot pay", () => {
        const state = boardWithProbe([[GRAVEYARD_LEG_NONBASIC_ID, "n1"]]);
        const keys = choiceCandidates(state, state.pendingChoices![0]!).map(
            (c) => c.key
        );
        expect(keys).toEqual(["may-pay:no"]);
    });
});
