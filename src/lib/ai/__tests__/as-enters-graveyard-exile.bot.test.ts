// The bot must ANSWER an as-enters graveyard exile (CR 614.12a / 607.2b,
// issue #6528 — Sutured Ghoul's "exile any number of creature cards from your
// graveyard"), and answer it with the whole pile.
//
// The prompt REUSES the shipped `choose-graveyard-card` shape (ADR 0100 D3),
// so `chooseResolution` reaches it with no new arm: that arm takes up to `max`
// best-first (Recall's greedy value-max), and the as-enters offer sets `max`
// to every candidate. For the clause's one shipped reader — a Ghoul whose
// body is the pile's total power/toughness — the largest pile is the best
// answer, so no `asEntersKind` discriminator is owed (the Mox Diamond and
// Clone legs needed one only because their shared arm submitted `min`).
//
// Everything runs through the REAL reducers the driver uses —
// `projectPublicState` → `buildBotView` → `escalationLadder` — never a
// hand-built OwedChoice, so a field dropped in the projection shows up as red.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "@convex/cards/registry";
import {
    forest,
    grizzlyBears,
    serraAngel,
} from "@convex/cards/sets/lea/index.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState } from "@convex/gre";
import { putReanimatedSetOnBattlefield } from "@convex/gre/state";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { refreshExpectedInput } from "@convex/gre/expectedInput";
import { getCardsExiledWith } from "@convex/gre/exileLinks";
import {
    GHOUL_ID,
    suturedGhoul,
} from "@convex/gre/__tests__/fixtures/suturedGhoulProbe.fixture";
import { buildBotView } from "../bot-view";
import { escalationLadder } from "../owed-input";
import type { BotAction } from "../brain";

const BOT = "p2";

function gy(defId: string, id: string) {
    return makeInstance(defId, {
        id,
        controllerId: BOT,
        ownerId: BOT,
        zone: "graveyard",
    });
}

/** The Ghoul entering under the BOT's control over a graveyard of two
 *  creature cards and a land (the non-cast route parks it identically to the
 *  cast one — same ADR 0100 D1 chokepoint). */
function ghoulEntering(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer(BOT, {
                graveyard: [
                    gy(grizzlyBears().id, "bears"),
                    gy(forest().id, "forest"),
                    gy(serraAngel().id, "angel"),
                ],
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    const ghoul = makeInstance(GHOUL_ID, {
        id: "ghoul",
        controllerId: BOT,
        ownerId: BOT,
        zone: "exile",
    });
    putReanimatedSetOnBattlefield(state, [{ card: ghoul, controllerId: BOT }]);
    refreshExpectedInput(state);
    return state;
}

/** THE path under test — the exact three calls the vs-AI driver makes. */
function rungTwo(state: GameState): BotAction {
    const projected = projectPublicState(state, 1, BOT);
    const view = buildBotView(projected, BOT);
    expect(view.owedInput?.kind).toBe("choice");
    const ladder = escalationLadder("choice", view);
    expect(ladder.map((s) => s.rung)).toEqual([2]);
    return ladder[0].action;
}

describe("bot answers an as-enters graveyard exile (CR 614.12a / 607.2b, issue #6528)", () => {
    it("the window IS owed, and the bot exiles every eligible card — never the land", () => {
        withTemporaryDefinition(suturedGhoul, () => {
            const state = ghoulEntering();
            const action = rungTwo(state);
            expect(action.kind).toBe("resolution-choice");
            if (action.kind !== "resolution-choice") return;
            expect([...action.cardInstanceIds].sort()).toEqual([
                "angel",
                "bears",
            ]);

            const h = state.pendingChoices![0];
            applyPendingChoiceSubmit(state, {
                playerId: h.playerId,
                stackItemId: h.stackItemId,
                step: h.step,
                choiceId: h.choiceId,
                cardInstanceIds: action.cardInstanceIds,
            });
            expect(
                state.players[1].battlefield.some((c) => c.id === "ghoul")
            ).toBe(true);
            expect(
                getCardsExiledWith(state, "ghoul")
                    .map((e) => e.card.id)
                    .sort()
            ).toEqual(["angel", "bears"]);
        });
    });
});
