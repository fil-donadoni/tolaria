// The bot must ANSWER a `choose-damage-target` pick whose candidates sit on the
// OPPONENT's battlefield (issue #6941; CR 601.2c, CR 115.4).
//
// Producers: the cast-during-resolution target step (`cdr:target`, cascade /
// Malcolm) and Word of Command's `<controllerId>:target` raise
// `choose-damage-target` with `zone: "battlefield"` and NO `allControllers`.
// The Bot's candidate reader used to intersect the CHOOSER's own battlefield
// with `candidateIds` -> empty pool -> "The Bot could not act". The server
// validator (`submitDamageTargetPick`) trusts `candidateIds` alone, so the
// reader scope is `choiceSpansAllBattlefields`, shared by the live Bot view,
// the self-play lister and the server enumerator.
//
// Runs through the real reducers (`projectPublicState` -> `buildBotView` ->
// `escalationLadder`), never a hand-built OwedChoice.

import { describe, expect, it } from "vitest";
import { grizzlyBears } from "@convex/cards/sets/lea/index.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState, PendingChoice } from "@convex/gre";
import { refreshExpectedInput } from "@convex/gre/expectedInput";
import { buildBotView } from "../bot-view";
import { escalationLadder } from "../owed-input";
import { listCandidates } from "../selfplay/playGame";

const BOT = "p2";

function stateWithPick(overrides: Partial<PendingChoice> = {}): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(grizzlyBears().id, {
                        id: "opp-1",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(grizzlyBears().id, {
                        id: "opp-2",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer(BOT),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    state.pendingChoices = [
        {
            stackItemId: "item-1",
            step: 0,
            choiceId: "cdr:target",
            playerId: BOT,
            kind: "choose-damage-target",
            zone: "battlefield",
            count: 1,
            candidateIds: ["opp-1", "opp-2"],
            candidatePlayerIds: ["p1"],
            prompt: "Choose a target for the card you are casting.",
            ...overrides,
        },
    ];
    refreshExpectedInput(state);
    return state;
}

describe("choose-damage-target without allControllers (issue #6941)", () => {
    it("live Bot view submits one of the opponent's permanents", () => {
        // Permanents only: a player candidate would mask an empty pool.
        const state = stateWithPick({ candidatePlayerIds: [] });
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.owedInput?.kind).toBe("choice");
        const action = escalationLadder("choice", view)[0].action;
        expect(action.kind).toBe("resolution-choice");
        if (action.kind !== "resolution-choice") throw new Error("kind");
        expect(action.cardInstanceIds).toHaveLength(1);
        expect(["opp-1", "opp-2"]).toContain(action.cardInstanceIds[0]);
    });

    it("self-play lister agrees with the live pool (permanents)", () => {
        const ids = listCandidates(
            stateWithPick(),
            stateWithPick().pendingChoices![0]
        )
            .map((c) => c.id)
            .sort();
        expect(ids).toEqual(["opp-1", "opp-2"]);
    });

    it("player candidates stay offered beside the permanents", () => {
        const state = stateWithPick({ candidateIds: [] });
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        const action = escalationLadder("choice", view)[0].action;
        expect(action.kind).toBe("resolution-choice");
        if (action.kind !== "resolution-choice") throw new Error("kind");
        expect(action.cardInstanceIds).toEqual(["p1"]);
    });
});
