// The bot must ANSWER a CR 609.7a "source of your choice" pick whose pool
// spans the stack (issue #5601): the Circle of Protection's `pick-source`
// choice over `battlefield-or-stack`.
//
// Before the pool widened, the bot's view read a source pick as a battlefield
// pick (`readChoiceZone`), which on this zone would read NOTHING — an empty
// submission the server refuses (count 1), i.e. a frozen game. Everything here
// runs through the real reducers the vs-AI driver uses — `projectPublicState`
// → `buildBotView` → `escalationLadder` — and the bot's answer is fed back
// through the real submit path, so a candidate the server would reject reds.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { getDefinition } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState } from "@convex/gre";
import { resolveTopOfStack } from "@convex/gre/state";
import { activateAbilityOnState } from "@convex/gre/activation";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { refreshExpectedInput } from "@convex/gre/expectedInput";
import { buildBotView } from "../bot-view";
import { escalationLadder } from "../owed-input";

const BOT = "p2";
const CIRCLE_RED = "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e";
const LIGHTNING_BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const GRAY_OGRE = "73ae5276-b607-4f23-a9d2-e8cc7b8e3693";

/** The opponent's Bolt aimed at the bot; the bot's Circle of Protection: Red
 *  activated in response and resolved up to its source choice. */
function boltAimedAtTheBot(): { state: GameState; boltId: string } {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(GRAY_OGRE, {
                        id: "ogre",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer(BOT, {
                battlefield: [
                    makeInstance(CIRCLE_RED, {
                        id: "circle",
                        controllerId: BOT,
                        ownerId: BOT,
                    }),
                ],
                manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: BOT,
    });
    const bolt = pushSpell(state, LIGHTNING_BOLT, "p1", [
        { type: "player", id: BOT },
    ]);
    activateAbilityOnState(state, {
        playerId: BOT,
        cardInstanceId: "circle",
        abilityId: getDefinition(CIRCLE_RED).activatedAbilities![0]!.id,
    });
    resolveTopOfStack(state);
    refreshExpectedInput(state);
    return { state, boltId: bolt.id };
}

describe("bot answers a CR 609.7a source pick spanning the stack (issue #5601)", () => {
    it("every rung of the ladder submits a candidate the server accepts — the spell about to resolve first", () => {
        const { state, boltId } = boltAimedAtTheBot();
        expect(state.pendingChoices?.[0]?.kind).toBe("pick-source");

        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.owedInput?.kind).toBe("choice");
        const ladder = escalationLadder("choice", view);
        expect(ladder.length).toBeGreaterThan(0);
        // The last rung is the minimal-legal default: the pool's own order,
        // whose head is the topmost spell.
        const fallback = ladder[ladder.length - 1]!.action;
        expect(fallback.kind).toBe("resolution-choice");
        if (fallback.kind !== "resolution-choice") return;
        expect(fallback.cardInstanceIds).toEqual([boltId]);

        const head = state.pendingChoices![0]!;
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: fallback.cardInstanceIds,
        });
        resolveTopOfStack(state); // the Bolt
        expect(state.players[1].life).toBe(20);
    });
});
