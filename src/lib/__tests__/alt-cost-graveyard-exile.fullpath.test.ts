// Full-path integration for the alternative cost's GRAVEYARD exile leg (CR
// 118.9 / 701.13 — Spinning Darkness, "You may exile the top three black
// cards of your graveyard rather than pay this spell's mana cost"):
// GRE → wire projection → client gate → game.ts → wire projection.
//
//  1. WIRE + CLIENT: the cast-option gate (`affordableAltCostsForCard`) reads
//     ONLY `projectPublicState`'s output and prices the leg from the projected
//     graveyard: offered with three black cards, withdrawn with two.
//  2. game.ts: the REGISTERED `announceCast` + `selectTarget` handlers (stub
//     `MutationCtx`) commit the targeted cast and exile the top three black
//     cards — the very cards the projected graveyard showed on top.
//  3. WIRE: the viewer's projection after the commit shows them in exile.

import { describe, expect, it } from "vitest";
import { announceCast, selectTarget } from "@convex/game";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup.helper";
import type { GameState } from "@convex/gre/state";
import type { Id } from "@convex/_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "@convex/__tests__/gameMutationHarness.fixture";
import {
    ALT_GRAVEYARD_EXILE_TARGETED_ID,
    EXILE_TOP_THREE_BLACK,
    ownedCard,
} from "@convex/gre/__tests__/fixtures/altCostGraveyardExileProbe.fixture";
import { affordableAltCostsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

const GAME_ID = "game-1" as Id<"games">;
const RITUAL = getCardByName("Dark Ritual").id;
const TERROR = getCardByName("Terror").id;
const VAMPIRE = getCardByName("Sengir Vampire").id;
const BEARS = getCardByName("Grizzly Bears").id;
const LIONS = getCardByName("Savannah Lions").id;

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};
type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent";
    targetId: string;
};

function board(graveyard: [string, string][]): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [
                    ownedCard(
                        ALT_GRAVEYARD_EXILE_TARGETED_ID,
                        "probe",
                        "p1",
                        "hand"
                    ),
                ],
                graveyard: graveyard.map(([def, id]) =>
                    ownedCard(def, id, "p1", "graveyard")
                ),
            }),
            makePlayer("p2", {
                battlefield: [
                    ownedCard(BEARS, "p2-bears", "p2", "battlefield"),
                ],
            }),
        ],
    });
}

/** The cast options the client offers, read off the viewer's projection. */
function offeredAltIds(state: GameState): string[] {
    const projected = projectPublicState(state, 1, "p1");
    const players = projected.players as unknown as Player[];
    const probe = players[0]!.hand.find(
        (c) => (c as CardInstance | null)?.id === "probe"
    ) as CardInstance;
    return affordableAltCostsForCard(probe, "p1", players, "p1").map(
        (a) => a.id
    );
}

describe("alt-cost graveyard exile leg — GRE → wire → client → game.ts (CR 118.9 / 701.13)", () => {
    it("the client offers the option only while three black cards sit in the projected graveyard", () => {
        expect(
            offeredAltIds(
                board([
                    [RITUAL, "ritual"],
                    [TERROR, "terror"],
                    [VAMPIRE, "vampire"],
                ])
            )
        ).toEqual([EXILE_TOP_THREE_BLACK.id]);
        expect(
            offeredAltIds(
                board([
                    [RITUAL, "ritual"],
                    [LIONS, "lions"],
                    [VAMPIRE, "vampire"],
                ])
            )
        ).toEqual([]);
    });

    it("the offered option, announced and targeted, exiles the top three black cards", async () => {
        const state = board([
            [RITUAL, "oldest-black"],
            [RITUAL, "ritual"],
            [TERROR, "terror"],
            [BEARS, "bears"],
            [VAMPIRE, "vampire"],
            [LIONS, "lions"],
        ]);
        const [altId] = offeredAltIds(state);
        expect(altId).toBe(EXILE_TOP_THREE_BLACK.id);

        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<AnnounceArgs, void>(
            announceCast as unknown as Handler<AnnounceArgs, void>,
            harness.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                cardInstanceId: "probe",
                alternativeCostId: altId,
            }
        );
        await runMutation<SelectTargetArgs, void>(
            selectTarget as unknown as Handler<SelectTargetArgs, void>,
            harness.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                targetType: "permanent",
                targetId: "p2-bears",
            }
        );

        const projected = projectPublicState(harness.state(), 1, "p1");
        const me = projected.players[0]!;
        expect(me.exile.map((c) => c.id)).toEqual([
            "vampire",
            "terror",
            "ritual",
        ]);
        expect(me.graveyard.map((c) => c.id)).toEqual([
            "oldest-black",
            "bears",
            "lions",
        ]);
        expect(projected.stack.map((s) => s.id)).toEqual(["probe"]);
    });
});
