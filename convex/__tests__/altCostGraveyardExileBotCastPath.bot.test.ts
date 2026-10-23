// The Bot's cast through an alternative cost's GRAVEYARD exile leg (CR 118.9
// / 601.2h / 701.13 — "exile the top three black cards of your graveyard
// rather than pay this spell's mana cost"), end to end across the GRE →
// game.ts boundary.
//
// Reachable: `enumerateMoves` offers the alternative cast with no lands at
// all. Paid: the search charges the leg (`applyAlternativeCostGraveyardLegForSearch`)
// rather than seeing a free spell. Parity: the live `announceCast` the
// executor sends exiles exactly the cards the search predicted — the pick is
// deterministic, so there is no owed payment for the driver to answer.

import { describe, expect, it } from "vitest";
import { announceCast } from "../game";
import { getCardByName } from "../cards";
import { makePlayer, makeState } from "../cards/__tests__/setup.helper";
import { enumerateMoves, type Move } from "../gre/moves";
import { applyMoveForSearch } from "../gre/applyMove";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";
import {
    ALT_GRAVEYARD_EXILE_UNTARGETED_ID,
    EXILE_TOP_THREE_BLACK,
    ownedCard,
} from "../gre/__tests__/fixtures/altCostGraveyardExileProbe.fixture";

const GAME_ID = "game-1" as Id<"games">;
const RITUAL = getCardByName("Dark Ritual").id;
const TERROR = getCardByName("Terror").id;
const VAMPIRE = getCardByName("Sengir Vampire").id;
const LIONS = getCardByName("Savannah Lions").id;

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};

/** p1 holds the untargeted probe and no lands; graveyard BOTTOM first. */
function board(graveyard: [string, string][]): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [
                    ownedCard(
                        ALT_GRAVEYARD_EXILE_UNTARGETED_ID,
                        "probe",
                        "p1",
                        "hand"
                    ),
                ],
                graveyard: graveyard.map(([def, id]) =>
                    ownedCard(def, id, "p1", "graveyard")
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

const probeCasts = (state: GameState) =>
    enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "probe"
    );

describe("Bot cast via an alternative-cost graveyard exile leg (CR 118.9 / 701.13)", () => {
    it("enumerates the alternative cast, charges it in the search, and the live cast exiles the same cards", async () => {
        const state = board([
            [RITUAL, "oldest-black"],
            [RITUAL, "ritual"],
            [TERROR, "terror"],
            [VAMPIRE, "vampire"],
            [LIONS, "lions"],
        ]);
        const move = probeCasts(state).find(
            (m) => m.alternativeCostId === EXILE_TOP_THREE_BLACK.id
        );
        expect(move).toBeDefined();
        expect(move!.tapPlan).toEqual([]);

        // What the search believes the cast costs.
        const predicted = applyMoveForSearch(state, "p1", move!);
        const predictedExile = predicted.players[0]!.exile.map((c) => c.id);
        expect(predictedExile).toEqual(["vampire", "terror", "ritual"]);

        // What the executor sends: the announcement with the chosen cost.
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<AnnounceArgs, void>(
            announceCast as unknown as Handler<AnnounceArgs, void>,
            harness.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                cardInstanceId: "probe",
                alternativeCostId: move!.alternativeCostId,
            }
        );
        const live = harness.state();
        expect(live.players[0]!.exile.map((c) => c.id)).toEqual(predictedExile);
        expect(live.stack.map((s) => s.id)).toEqual(["probe"]);
    });

    it("offers no cast at all with only two black cards and no mana", () => {
        expect(
            probeCasts(
                board([
                    [RITUAL, "ritual"],
                    [VAMPIRE, "vampire"],
                    [LIONS, "lions"],
                ])
            )
        ).toEqual([]);
    });
});
