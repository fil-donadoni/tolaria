// "You may have this land enter tapped as a copy of any land card in a
// graveyard" — CR 614.1c / 707.9b; the tap rides the copy answer, so declining
// enters untapped (Echoing Deeps, issue #8614).
import { describe, expect, it } from "vitest";
import {
    putReanimatedSetOnBattlefield,
    type CardInstanceState,
    type GameState,
} from "../state";
import { applyPlayLand } from "../playLand";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { echoingDeeps } from "../../cards/sets/lci/colorless.cards";
import { forest, grizzlyBears } from "../../cards/sets/lea/index.cards";

function enter(): { state: GameState; deeps: CardInstanceState } {
    const yard = makeInstance(forest().id, {
        id: "yardForest",
        controllerId: "p2",
        ownerId: "p2",
        zone: "graveyard",
    });
    const bears = makeInstance(grizzlyBears().id, {
        id: "yardBears",
        controllerId: "p2",
        ownerId: "p2",
        zone: "graveyard",
    });
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", { graveyard: [yard, bears] }),
        ],
    });
    const deeps = makeInstance(echoingDeeps().id, {
        id: "deeps",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    putReanimatedSetOnBattlefield(state, [{ card: deeps, controllerId: "p1" }]);
    return { state, deeps };
}

function answer(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

const onBoard = (state: GameState): CardInstanceState =>
    state.players[0].battlefield.find((c) => c.id === "deeps")!;

describe("Echoing Deeps (CR 614.1c, 707.9b)", () => {
    it("offers only land cards, in any graveyard", () => {
        const { state } = enter();
        expect(state.pendingChoices![0].candidateIds).toEqual(["yardForest"]);
    });

    it("copying a land enters tapped and adds Cave", () => {
        const { state } = enter();
        answer(state, ["yardForest"]);
        const card = onBoard(state);
        expect(card.isTapped).toBe(true);
        expect(card.subtypes).toEqual(
            expect.arrayContaining(["Forest", "Cave"])
        );
    });

    it("declining enters untapped as the printed Cave", () => {
        const { state } = enter();
        answer(state, []);
        const card = onBoard(state);
        expect(card.isTapped).toBeFalsy();
        expect(card.subtypes).toEqual(["Cave"]);
    });

    it("played from hand, copying a land still enters tapped (CR 305.1)", () => {
        const yard = makeInstance(forest().id, {
            id: "yardForest",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(echoingDeeps().id, {
                            id: "deeps",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2", { graveyard: [yard] }),
            ],
        });
        applyPlayLand(state, state.players[0], "deeps");
        answer(state, ["yardForest"]);
        const card = onBoard(state);
        expect(card.isTapped).toBe(true);
        expect(card.subtypes).toEqual(
            expect.arrayContaining(["Forest", "Cave"])
        );
    });
});
