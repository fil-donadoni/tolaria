// Bot-driver coverage for the face a cast during resolution announces (CR 709.3 /
// 712.11b / 715.3 / 608.2g): both shapes of the question — the rows of a public
// offer and the follow-up pick a hidden card asks once accepted — through the
// real project → buildBotView → decideBotAction → consultBrain → submit path.

import { describe, expect, it } from "vitest";
import { getCardByName, registerTokenDefinition } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "@convex/gre/state";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import { adventureCastAltCostId } from "@convex/gre/adventure";
import { splitCastAltCostId } from "@convex/gre/splitCast";
import { buildBotView } from "../bot-view";
import { botActionRealisation, decideBotAction } from "../brain";
import { consultBrain } from "../brain-client";

const GIANT = getCardByName("Bonecrusher Giant");
const STAND_DELIVER = getCardByName("Stand // Deliver");
const MOUNTAIN = getCardByName("Mountain");
const HILL_GIANT = getCardByName("Hill Giant");

const PUBLIC_SCRIPT = "test-bot-cdr-face-public";
registerTokenDefinition({
    id: PUBLIC_SCRIPT,
    name: PUBLIC_SCRIPT,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "castDuringResolution",
            fromTopOfLibrary: true,
            player: "controller",
        },
    ],
});

const HAND_SCRIPT = "test-bot-cdr-face-hand";
registerTokenDefinition({
    id: HAND_SCRIPT,
    name: HAND_SCRIPT,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            count: 1,
            prompt: "Choose a card.",
            bind: "$picked",
        },
        {
            op: "castDuringResolution",
            card: { ref: "$picked" },
            player: "controller",
            source: "hand",
            free: true,
        },
    ],
});

function mountains(count: number) {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(MOUNTAIN.id, {
            id: `bot-mountain-${i}`,
            controllerId: "p2",
            ownerId: "p2",
        })
    );
}

/** Answers the head choice as the search does, and returns what it picked. */
async function driveBot(state: GameState): Promise<string[]> {
    const projected = projectPublicState(state, 1, "p2");
    const view = buildBotView(projected, "p2");
    expect(view.owedChoice?.kind).toBe("option-pick");
    expect(view.owedChoice?.searchable).toBe(true);
    const action = decideBotAction(view);
    expect(action.kind).toBe("search-choice");
    expect(botActionRealisation(action.kind)).toBe("worker");

    const { move } = await consultBrain(projected, "p2", { iterations: 24 });
    expect(move?.kind).toBe("resolution-choice");
    const ids = (move as { cardInstanceIds: string[] }).cardInstanceIds;
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: "p2",
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
    return ids;
}

describe("Bot answers the face of a cast during resolution (CR 608.2g)", () => {
    it("the rows of a public offer: it answers one of them and never stalls", async () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: mountains(3),
                    library: [
                        makeInstance(GIANT.id, {
                            id: "bot-top",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "library",
                        }),
                    ],
                }),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
        });
        pushSpell(state, PUBLIC_SCRIPT, "p2");
        resolveTopOfStack(state);

        const offered = state.pendingChoices![0].options!.map((o) => o.id);
        expect(offered).toEqual([
            "cast",
            adventureCastAltCostId(GIANT),
            "decline",
        ]);
        const [picked] = await driveBot(state);
        expect(offered).toContain(picked);

        // Stomp asks its target next, and the same path answers that too.
        if (picked === adventureCastAltCostId(GIANT)) {
            const head = state.pendingChoices![0];
            expect(head.kind).toBe("choose-damage-target");
            applyPendingChoiceSubmit(state, {
                playerId: "p2",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["p1"],
            });
        }
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack.some((s) => s.id === "bot-top")).toBe(
            picked !== "decline"
        );
    });

    it("the follow-up pick a hidden card asks: it answers it and never stalls", async () => {
        const bear = makeInstance(HILL_GIANT.id, {
            id: "bot-bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(STAND_DELIVER.id, {
                            id: "bot-split",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
        });
        pushSpell(state, HAND_SCRIPT, "p2");
        resolveTopOfStack(state);
        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["bot-split"],
        });
        const offer = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["cast"],
        });

        const faces = [
            splitCastAltCostId(STAND_DELIVER, "left"),
            splitCastAltCostId(STAND_DELIVER, "right"),
        ];
        expect(state.pendingChoices![0].options!.map((o) => o.id)).toEqual(
            faces
        );
        const [picked] = await driveBot(state);
        expect(faces).toContain(picked);
        expect(state.pendingChoices![0].kind).toBe("choose-damage-target");
    });
});
