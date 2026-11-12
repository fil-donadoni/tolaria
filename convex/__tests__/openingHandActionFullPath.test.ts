// Full-path integration for opening-hand actions (CR 103.6a): GRE → game.ts →
// wire projection → the client's hand-pick predicate.
//
//   CR 103.6a  If a card allows a player to begin the game with that card on
//              the battlefield, the player taking this action puts that card
//              onto the battlefield.
//
// The window is raised by the real London mulligan (`recordDeclaration`), the
// answer goes through the REGISTERED `submitResolutionChoice` `_handler` over
// the stub `MutationCtx` (seat check + `saveGameState`), and the surface is
// read through `projectPublicState` into `isSelectableHandChoiceCard`, the
// predicate both boards gate a hand card's pick toggle on.

import { describe, expect, it } from "vitest";
import { submitResolutionChoice } from "../game";
import { getCardByName, withTemporaryDefinitionAsync } from "../cards";
import type { CardDefinition } from "../cards/types";
import { makeMulliganState, recordDeclaration } from "../gre/mulligan";
import type { GameState } from "../gre/state";
import type { Phase } from "../gre/types";
import { projectPublicState } from "../gameProjections";
import { isSelectableHandChoiceCard } from "../../src/lib/hand-choice";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const bears = getCardByName("Grizzly Bears");

const LEYLINE: CardDefinition = {
    id: "test-8833-fullpath-leyline",
    name: "Test Opening-Hand Enchantment",
    rarity: "rare",
    oracleText:
        "If this card is in your opening hand, you may begin the game with it on the battlefield.",
    manaCost: { generic: 2, B: 2 },
    types: ["Enchantment"],
    openingHandAction: "begin-on-battlefield",
};

type SubmitArgs = {
    gameId: Id<"games">;
    playerId: string;
    stackItemId: string;
    step: number;
    choiceId: string;
    cardInstanceIds: string[];
};

/** Both players kept; p1 holds the Leyline (`p1-hand-0`) and six Bears. */
function windowOpen(): GameState {
    const player = (id: string, first: string) =>
        makePlayer(id, {
            hand: Array.from({ length: 7 }, (_, i) =>
                makeInstance(i === 0 ? first : bears.id, {
                    id: `${id}-hand-${i}`,
                    controllerId: id,
                    ownerId: id,
                    zone: "hand",
                })
            ),
            library: Array.from({ length: 20 }, (_, i) =>
                makeInstance(bears.id, {
                    id: `${id}-lib-${i}`,
                    controllerId: id,
                    ownerId: id,
                    zone: "library",
                })
            ),
        });
    const state = makeState({
        players: [player("p1", LEYLINE.id), player("p2", bears.id)],
        phase: "MULLIGAN" as Phase,
        rngSeed: 1,
        rngCounter: 0,
        priorityPlayerId: "p1",
        activePlayerId: "p1",
        turnNumber: 1,
    });
    state.mulligan = makeMulliganState(state);
    recordDeclaration(state, "p1", "keep");
    recordDeclaration(state, "p2", "keep");
    return state;
}

const submitAs = (state: GameState, seat: string, ids: string[]) => {
    const head = state.pendingChoices![0];
    const stub = makeMutationCtx(seat, [gameStateSeed(state)]);
    return {
        stub,
        run: () =>
            runMutation<SubmitArgs, void>(
                submitResolutionChoice as unknown as Handler<SubmitArgs, void>,
                stub.ctx,
                {
                    gameId: GAME_ID,
                    playerId: seat,
                    stackItemId: head.stackItemId,
                    step: head.step,
                    choiceId: head.choiceId,
                    cardInstanceIds: ids,
                }
            ),
    };
};

describe("opening-hand actions — full path (CR 103.6a)", () => {
    it("the chooser's client sees the eligible hand card as pickable; the opponent's sees no choice", async () => {
        await withTemporaryDefinitionAsync(LEYLINE, async () => {
            const state = windowOpen();

            const mine = projectPublicState(state, 1, "p1");
            const choice = mine.pendingChoices?.[0];
            const hand = mine.players[0].hand;
            const pickable = hand
                .filter((c) => c !== null)
                .filter((c) => isSelectableHandChoiceCard(choice, c!, "p1"))
                .map((c) => c!.id);
            expect(pickable).toEqual(["p1-hand-0"]);

            expect(
                projectPublicState(state, 1, "p2").pendingChoices
            ).toBeUndefined();
        });
    });

    it("submitResolutionChoice puts the card onto the battlefield and starts turn 1", async () => {
        await withTemporaryDefinitionAsync(LEYLINE, async () => {
            const { stub, run } = submitAs(windowOpen(), "p1", ["p1-hand-0"]);
            await run();

            const saved = stub.state();
            expect(saved.phase).toBe("UPKEEP");
            expect(saved.mulligan).toBeUndefined();
            const projected = projectPublicState(saved, 2, "p2");
            expect(projected.players[0].battlefield.map((c) => c.id)).toEqual([
                "p1-hand-0",
            ]);
            expect(projected.players[0].hand).toHaveLength(6);
        });
    });

    it("refuses the opponent answering the chooser's window", async () => {
        await withTemporaryDefinitionAsync(LEYLINE, async () => {
            const { run } = submitAs(windowOpen(), "p2", ["p1-hand-0"]);
            await expect(run()).rejects.toThrow(
                /waiting for choice input from another player/
            );
        });
    });
});
