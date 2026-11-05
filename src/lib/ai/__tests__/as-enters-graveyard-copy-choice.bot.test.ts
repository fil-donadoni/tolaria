// The Bot must ANSWER an as-enters copy of a graveyard card, across every
// graveyard (CR 707.2, issue #8041), and the search must see the node.
//
// Same rung as `as-enters-copy-choice.bot.test.ts`, through the REAL reducers
// the driver uses: `projectPublicState` → `buildBotView` → `escalationLadder`.
import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "@convex/cards/registry";
import { grizzlyBears, serraAngel } from "@convex/cards/sets/lea/index.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState } from "@convex/gre";
import { choiceCandidates } from "@convex/gre/ai/choiceCandidates";
import { putReanimatedSetOnBattlefield } from "@convex/gre/state";
import { refreshExpectedInput } from "@convex/gre/expectedInput";
import {
    graveyardCopyProbe,
    PROBE_ID,
} from "@convex/gre/__tests__/fixtures/graveyardCopyProbe.fixture";
import { buildBotView } from "../bot-view";
import { escalationLadder } from "../owed-input";

const BOT = "p2";

function entering(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                graveyard: [
                    makeInstance(serraAngel().id, {
                        id: "angel",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "graveyard",
                    }),
                ],
            }),
            makePlayer(BOT, {
                graveyard: [
                    makeInstance(grizzlyBears().id, {
                        id: "bears",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "graveyard",
                    }),
                ],
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    putReanimatedSetOnBattlefield(state, [
        {
            card: makeInstance(PROBE_ID, {
                id: "probe",
                controllerId: BOT,
                ownerId: BOT,
                zone: "graveyard",
            }),
            controllerId: BOT,
        },
    ]);
    refreshExpectedInput(state);
    return state;
}

describe("Bot answers the as-enters graveyard copy (CR 707.2, issue #8041)", () => {
    it("the live driver copies the best body, from the OPPONENT's graveyard too", () => {
        withTemporaryDefinition(graveyardCopyProbe, () => {
            const view = buildBotView(
                projectPublicState(entering(), 1, BOT),
                BOT
            );
            expect(view.owedInput?.kind).toBe("choice");
            const [rung] = escalationLadder("choice", view);
            expect(rung.action).toMatchObject({
                kind: "resolution-choice",
                cardInstanceIds: ["angel"],
            });
        });
    });

    it("the search offers the best card, from any graveyard, and the decline", () => {
        withTemporaryDefinition(graveyardCopyProbe, () => {
            const state = entering();
            const moves = choiceCandidates(state, state.pendingChoices![0]).map(
                (c) =>
                    c.move.kind === "resolution-choice"
                        ? c.move.cardInstanceIds
                        : []
            );
            expect(moves).toContainEqual([]);
            expect(moves.flat()).toContain("angel");
        });
    });
});
