// The bot must ANSWER a `choose-aura-host` whose candidates are PLAYERS
// (CR 303.4 — an "Enchant player" Aura reanimated with no fixed target).
//
// Permanent hosts are zone members the bot's battlefield read finds; a player
// is in no zone, so before the host split the bot's candidate list was empty,
// the minimal-legal default (ADR 0016) submitted nothing and `finalizeAuraHost`
// binned the Aura (CR 303.4g). Runs through the REAL reducers the vs-AI driver
// uses — `projectPublicState` → `buildBotView` → `escalationLadder` — never a
// hand-built OwedChoice.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { registerTokenDefinition } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState } from "@convex/gre";
import { putReanimatedSetOnBattlefield } from "@convex/gre/state";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { refreshExpectedInput } from "@convex/gre/expectedInput";
import { buildBotView } from "../bot-view";
import { escalationLadder } from "../owed-input";

const BOT = "p2";
const AURA_ID = "test-only-enchant-player-aura-bot";
const auraDef: CardDefinition = {
    id: AURA_ID,
    rarity: "common",
    name: "Test Enchant-Player Aura (bot)",
    oracleText: "Enchant player",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "player", count: 1 },
};
registerTokenDefinition(auraDef);

function auraEntering(): GameState {
    const aura = makeInstance(AURA_ID, {
        id: "aura-1",
        controllerId: BOT,
        ownerId: BOT,
        zone: "graveyard",
    });
    const state = makeState({
        players: [makePlayer("p1"), makePlayer(BOT, { graveyard: [aura] })],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    // The caller removes the card from its origin before the park.
    state.players[1].graveyard.splice(0, 1);
    putReanimatedSetOnBattlefield(state, [{ card: aura, controllerId: BOT }]);
    refreshExpectedInput(state);
    return state;
}

describe("bot answers a player-host choose-aura-host (CR 303.4, issue #1233)", () => {
    it("offers the candidate players and submits a host the submit path accepts", () => {
        const state = auraEntering();
        expect(state.pendingChoices?.[0]?.kind).toBe("choose-aura-host");

        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.owedChoice?.candidates.map((c) => c.id).sort()).toEqual([
            "p1",
            BOT,
        ]);

        const action = escalationLadder("choice", view)[0].action;
        if (action.kind !== "resolution-choice") throw new Error("wrong kind");
        expect(action.cardInstanceIds).toHaveLength(1);

        const h = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: h.playerId,
            stackItemId: h.stackItemId,
            step: h.step,
            choiceId: h.choiceId,
            cardInstanceIds: action.cardInstanceIds,
        });
        // The Aura is enchanting a player, not binned to the graveyard.
        const aura = state.players[1].battlefield.find(
            (c) => c.id === "aura-1"
        );
        expect(aura?.attachedTo).toBe(action.cardInstanceIds[0]);
        expect(state.players[1].graveyard).toHaveLength(0);
    });
});
