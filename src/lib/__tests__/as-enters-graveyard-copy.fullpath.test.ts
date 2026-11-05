// Full-path integration for the as-enters copy of a graveyard card (CR 614.12 /
// 707.2 / 707.9b / 603.11, issue #8041):
// GRE → wire projection → client gate → game.ts → wire projection.
//
//  1. GRE: the cast probe parks off every zone and owes the pick.
//  2. WIRE + CLIENT: the chooser's OWN pile owns the one grid, showing EVERY
//     graveyard with the allow-list the server will enforce.
//  3. game.ts: the REGISTERED `submitResolutionChoice` handler commits the pick.
//  4. WIRE: both seats see the copy, its excepted name and its trigger.

import { describe, expect, it } from "vitest";
import { submitResolutionChoice } from "@convex/game";
import { withTemporaryDefinitionAsync } from "@convex/cards/registry";
import { copyExceptName } from "@convex/cards/cardNames";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "@convex/gre/state";
import type { Id } from "@convex/_generated/dataModel";
import {
    forest,
    grizzlyBears,
    serraAngel,
} from "@convex/cards/sets/lea/index.cards";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "@convex/__tests__/gameMutationHarness.fixture";
import {
    graveyardCopyProbe,
    PROBE_ID,
    PROBE_NAME,
} from "@convex/gre/__tests__/fixtures/graveyardCopyProbe.fixture";
import {
    graveyardChoiceCards,
    isGraveyardChoiceActive,
} from "../graveyard-choice";
import { pendingChoiceSourceLabel } from "../pending-choice-labels";

const GAME_ID = "game-1" as Id<"games">;

type SubmitArgs = {
    gameId: Id<"games">;
    playerId: string;
    stackItemId: string;
    step: number;
    choiceId: string;
    cardInstanceIds: string[];
};

const runSubmit = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<SubmitArgs, "gameId">
) =>
    runMutation<SubmitArgs, void>(
        submitResolutionChoice as unknown as Handler<SubmitArgs, void>,
        ctx,
        { gameId: GAME_ID, ...args }
    );

function gy(defId: string, id: string, ownerId: string) {
    return makeInstance(defId, {
        id,
        controllerId: ownerId,
        ownerId,
        zone: "graveyard",
    });
}

function castOverGraveyards(): { state: GameState; probeId: string } {
    const state = makeState({
        players: [
            makePlayer("p1", {
                graveyard: [gy(forest().id, "forest", "p1")],
            }),
            makePlayer("p2", {
                graveyard: [
                    gy(serraAngel().id, "angel", "p2"),
                    gy(grizzlyBears().id, "bears", "p2"),
                ],
            }),
        ],
    });
    const spell = pushSpell(state, PROBE_ID, "p1");
    resolveTopOfStack(state);
    return { state, probeId: spell.id };
}

describe("as-enters graveyard copy — GRE → wire → client → game.ts (CR 707.2 / 707.9b / 603.11, issue #8041)", () => {
    it("one grid shows every graveyard, and the answer makes the named copy with its trigger", async () => {
        await withTemporaryDefinitionAsync(graveyardCopyProbe, async () => {
            const { state, probeId } = castOverGraveyards();

            // WIRE + CLIENT — the chooser's pile owns the grid, the opponent's
            // does not, so two modals never fight; its cards span both piles.
            const view = projectPublicState(state, 1, "p1");
            const head = view.pendingChoices![0];
            const [mine, theirs] = view.players;
            expect(isGraveyardChoiceActive(head, mine, "p1")).toBe(true);
            expect(isGraveyardChoiceActive(head, theirs, "p1")).toBe(false);
            expect(
                graveyardChoiceCards(head, mine, view.players).map((c) => c.id)
            ).toEqual(["forest", "angel", "bears"]);
            expect(head.candidateIds).toEqual(["angel", "bears"]);
            expect(head.count).toEqual({ min: 0, max: 1 });
            expect(pendingChoiceSourceLabel(head)).toBe("Copy");

            // game.ts — a card off the allow-list is refused, the window stands.
            const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
            const submit = (ids: string[]) =>
                runSubmit(stub.ctx, {
                    playerId: "p1",
                    stackItemId: head.stackItemId,
                    step: head.step,
                    choiceId: head.choiceId,
                    cardInstanceIds: ids,
                });
            await expect(submit(["forest"])).rejects.toThrow(/not an eligible/);
            await submit(["angel"]);

            // WIRE — both seats read the exception off the slim card and see
            // the linked trigger; the card waits in the graveyard.
            for (const seat of ["p1", "p2"] as const) {
                const after = projectPublicState(stub.state(), 1, seat);
                expect(after.pendingChoices ?? []).toHaveLength(0);
                const entered = after.players[0].battlefield.find(
                    (c) => c.id === probeId
                )!;
                expect(copyExceptName(entered)).toBe(PROBE_NAME);
                expect(entered.card.id).toBe(serraAngel().id);
                expect(after.stack).toHaveLength(1);
                expect(after.players[1].graveyard.map((c) => c.id)).toEqual([
                    "angel",
                    "bears",
                ]);
            }
        });
    });

    it("an ordinary graveyard pick keeps to its own pile", () => {
        const piles = [{ graveyard: ["a"] }, { graveyard: ["b"] }];
        expect(graveyardChoiceCards({}, piles[0], piles)).toEqual(["a"]);
        expect(
            graveyardChoiceCards({ allControllers: true }, piles[0], piles)
        ).toEqual(["a", "b"]);
    });
});
