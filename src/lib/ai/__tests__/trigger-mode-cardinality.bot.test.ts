// CR 700.2 / 603.3c — the Bot's answer to a multi-mode `trigger-mode` choice
// through the real path: projection → `buildBotView`'s owed choice →
// `chooseResolution` → the submit. A fallback that sends fewer ids than the count
// asks for is a refused submission, and a refused submission is a frozen game.

import { afterEach, describe, expect, it } from "vitest";
import { raiseTriggerTargetSelection } from "@convex/gre/rules";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import {
    bear,
    CHOOSE_THREE,
    MODES,
    modalBoard,
    modalTriggerCard,
    releaseModalTriggerCards,
} from "@convex/gre/__tests__/modalTriggerSelection.fixture";
import { chooseResolution } from "../brain";
import { buildBotView } from "../bot-view";
import type { GameState } from "@convex/gre/state";

afterEach(releaseModalTriggerCards);

function answerAsBot(state: GameState): string[] {
    const projected = projectPublicState(state, 1, "p1");
    const owed = buildBotView(
        projected as Parameters<typeof buildBotView>[0],
        "p1"
    ).owedChoice;
    if (!owed) throw new Error("the Bot owes no choice");
    return chooseResolution(owed);
}

function submit(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

describe("the Bot's fallback answers a multi-mode announcement (CR 700.2)", () => {
    it("names as many distinct modes as the count asks", () => {
        const { state, trig } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("b", "p2")],
        });
        raiseTriggerTargetSelection(state);
        submit(state, answerAsBot(state));
        expect(trig.chosenModeIds).toHaveLength(3);
    });

    it("fills a repeats list from fewer modes than slots (CR 700.2d)", () => {
        const { state, trig } = modalBoard(
            modalTriggerCard({ min: 3, max: 3, repeats: true }, [
                MODES[0],
                MODES[3],
            ])
        );
        raiseTriggerTargetSelection(state);
        submit(state, answerAsBot(state));
        expect(trig.chosenModeIds).toHaveLength(3);
    });
});
