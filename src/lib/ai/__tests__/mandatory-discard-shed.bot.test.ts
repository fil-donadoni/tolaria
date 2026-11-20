// A mandatory own-hand discard (CR 701.9b) is answered ONCE (issue #9957):
// the live client (`buildBotView` → `chooseResolution`) sheds the card the
// search's playout sheds (`forcedChoiceAnswer`), for the same hand.
//
// Before, the client ranked the hand by its own `discardOrder`, which put a
// lone land below every spell on any board: with five lands in play it binned
// the Lightning Bolt and kept a sixth Mountain, while the search shed the
// Mountain. The positions are the Fear of Missing Out blade entries, so the
// client is held to the same boards the blade pins the shared answer on.

import { describe, expect, it } from "vitest";
import { tryGetDefinition } from "@convex/cards";
import { buildBladeState } from "@convex/gre/ai/blade/build";
import { seatPlayerId } from "@convex/gre/ai/blade/matcher";
import { findBladeScenario } from "@convex/gre/ai/blade/registry";
import { forcedChoiceAnswer } from "@convex/gre/ai/choiceCandidates";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState } from "@convex/gre/state";
import { chooseResolution } from "../brain";
import { buildBotView } from "../bot-view";

function handNames(state: GameState, ids: readonly string[]): string[] {
    const hand = state.players.flatMap((p) => p.hand);
    return ids.map((id) => {
        const card = hand.find((c) => c.id === id);
        return card ? (tryGetDefinition(String(card.card.id))?.name ?? id) : id;
    });
}

const CASES: { label: string; sheds: string }[] = [
    {
        label: "enter-trigger discard: Fear of Missing Out discards the surplus land",
        sheds: "Mountain",
    },
    {
        label: "enter-trigger discard: Fear of Missing Out never discards a spell over the surplus land",
        sheds: "Mountain",
    },
    {
        label: "enter-trigger discard: Fear of Missing Out keeps the land drop while land-light",
        sheds: "Lightning Bolt",
    },
];

describe("mandatory own-hand discard: the client sheds what the search sheds (CR 701.9b, issue #9957)", () => {
    for (const { label, sheds } of CASES) {
        it(label, () => {
            const scenario = findBladeScenario(label);
            expect(scenario).toBeDefined();
            const state = buildBladeState(scenario!);
            const bot = seatPlayerId(state, "me");
            const head = state.pendingChoices?.[0];
            expect(head?.kind).toBe("discard-hand");

            const searched = forcedChoiceAnswer(state, head!);
            expect(searched?.kind).toBe("resolution-choice");
            const searchIds =
                searched?.kind === "resolution-choice"
                    ? searched.cardInstanceIds
                    : [];

            const view = buildBotView(projectPublicState(state, 1, bot), bot);
            const clientIds = chooseResolution(view.owedChoice!);

            expect(handNames(state, clientIds)).toEqual([sheds]);
            expect(clientIds).toEqual(searchIds);
        });
    }
});
