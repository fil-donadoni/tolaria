// The bot must ANSWER a `graveyard-order` choice (CR 404.3, issue #9554) —
// the arrangement of cards one event put into its graveyard together — and
// never freeze on it. Every permutation is legal; the minimal-legal default
// (ADR 0016) is the engine's order. Runs through the REAL reducers the vs-AI
// driver uses (`projectPublicState` → `buildBotView` → `escalationLadder`),
// and the search's forced answer (`forcedChoiceAnswer`) so a simultaneous
// death never stops a settle.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState } from "@convex/gre";
import { checkStateBasedActions } from "@convex/gre/sba";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { refreshExpectedInput } from "@convex/gre/expectedInput";
import { forcedChoiceAnswer } from "@convex/gre/ai/choiceCandidates";
import { buildBotView } from "../bot-view";
import { escalationLadder } from "../owed-input";

const BOT = "p2";

function botCreaturesDie(): GameState {
    const dying = ["Grizzly Bears", "Savannah Lions", "Craw Wurm"].map(
        (name, i) =>
            makeInstance(getCardByName(name).id, {
                id: `c${i}`,
                controllerId: BOT,
                ownerId: BOT,
                zone: "battlefield",
                damageMarked: 10,
            })
    );
    const state = makeState({
        players: [makePlayer("p1"), makePlayer(BOT, { battlefield: dying })],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    checkStateBasedActions(state);
    refreshExpectedInput(state);
    return state;
}

describe("bot answers a graveyard-order choice (CR 404.3, issue #9554)", () => {
    it("submits the whole batch in the engine's order, and the submit path accepts it", () => {
        const state = botCreaturesDie();
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("graveyard-order");
        expect(head?.playerId).toBe(BOT);
        const engineOrder = [...(head?.candidateIds ?? [])];
        expect(engineOrder).toHaveLength(3);

        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        const action = escalationLadder("choice", view)[0].action;
        if (action.kind !== "resolution-choice") throw new Error("wrong kind");
        expect(action.cardInstanceIds).toEqual(engineOrder);

        applyPendingChoiceSubmit(state, {
            playerId: head!.playerId,
            stackItemId: head!.stackItemId,
            step: head!.step,
            choiceId: head!.choiceId,
            cardInstanceIds: action.cardInstanceIds,
        });
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(
            [...engineOrder].reverse()
        );
    });

    it("the search answers it without branching (forced answer = engine order)", () => {
        const state = botCreaturesDie();
        const head = state.pendingChoices![0];
        const move = forcedChoiceAnswer(state, head);
        expect(move).toMatchObject({
            kind: "resolution-choice",
            choiceId: head.choiceId,
            cardInstanceIds: head.candidateIds,
        });
    });
});
