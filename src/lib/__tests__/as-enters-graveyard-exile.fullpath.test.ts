// Full-path integration for the as-enters GRAVEYARD EXILE (CR 614.12a /
// 607.2b, issue #6528 — Sutured Ghoul's "As this creature enters, exile any
// number of creature cards from your graveyard"):
// GRE → wire projection → client gate → game.ts → wire projection.
//
//  1. GRE: the cast Ghoul parks off every zone and owes the pick.
//  2. WIRE + CLIENT: the viewer's projection turns the chooser's own
//     graveyard into the buffered pick (`isGraveyardChoiceActive`), with the
//     allow-list the server will enforce, and the prompt's source tag says
//     "Exile" rather than the reused kind's "Return".
//  3. game.ts: the REGISTERED `submitResolutionChoice` handler (stub
//     `MutationCtx`) commits the pick; the Ghoul enters.
//  4. WIRE: both seats see the exiled cards pinned to the Ghoul.

import { describe, expect, it } from "vitest";
import { submitResolutionChoice } from "@convex/game";
import { withTemporaryDefinitionAsync } from "@convex/cards/registry";
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
    GHOUL_ID,
    suturedGhoul,
} from "@convex/gre/__tests__/fixtures/suturedGhoulProbe.fixture";
import { isGraveyardChoiceActive } from "../graveyard-choice";
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

function gy(defId: string, id: string) {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
}

/** p1 casts the Ghoul over a graveyard of two creature cards and a land. */
function castOverGraveyard(): { state: GameState; ghoulId: string } {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                graveyard: [
                    gy(grizzlyBears().id, "bears"),
                    gy(forest().id, "forest"),
                    gy(serraAngel().id, "angel"),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    const spell = pushSpell(state, GHOUL_ID, "p1");
    resolveTopOfStack(state);
    return { state, ghoulId: spell.id };
}

describe("as-enters graveyard exile — GRE → wire → client → game.ts (CR 614.12a / 607.2b, issue #6528)", () => {
    it("the projected prompt drives the graveyard pick, and the mutation's answer pins the pile to the Ghoul", async () => {
        await withTemporaryDefinitionAsync(suturedGhoul, async () => {
            const { state, ghoulId } = castOverGraveyard();

            // WIRE + CLIENT — the chooser's own pile, and only it, is the
            // pick; the opponent's view of it is not.
            const view = projectPublicState(state, 1, "p1");
            const head = view.pendingChoices![0];
            const [mine, theirs] = view.players;
            expect(isGraveyardChoiceActive(head, mine, "p1")).toBe(true);
            expect(isGraveyardChoiceActive(head, theirs, "p1")).toBe(false);
            expect(
                isGraveyardChoiceActive(
                    projectPublicState(state, 1, "p2").pendingChoices![0],
                    mine,
                    "p2"
                )
            ).toBe(false);
            expect(head.candidateIds).toEqual(["bears", "angel"]);
            expect(head.count).toEqual({ min: 0, max: 2 });
            expect(pendingChoiceSourceLabel(head)).toBe("Exile");
            // The staged Ghoul is in no projected zone.
            expect(mine.battlefield.some((c) => c.id === ghoulId)).toBe(false);

            // game.ts — the registered handler commits the pick.
            const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
            await runSubmit(stub.ctx, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["bears", "angel"],
            });

            // WIRE — both seats see the Ghoul in play and the pile pinned to it.
            for (const seat of ["p1", "p2"] as const) {
                const after = projectPublicState(stub.state(), 1, seat);
                expect(after.pendingChoices ?? []).toHaveLength(0);
                const p1 = after.players[0];
                expect(p1.battlefield.some((c) => c.id === ghoulId)).toBe(true);
                expect(p1.graveyard.map((c) => c.id)).toEqual(["forest"]);
                const pinned = p1.exile
                    .filter((c) => c.exiledByPermanentId === ghoulId)
                    .map((c) => c.id)
                    .sort();
                expect(pinned).toEqual(["angel", "bears"]);
            }
        });
    });

    it("the mutation refuses a card off the allow-list, and the window stays answerable", async () => {
        await withTemporaryDefinitionAsync(suturedGhoul, async () => {
            const { state, ghoulId } = castOverGraveyard();
            const head = state.pendingChoices![0];
            const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
            const submit = (ids: string[]) =>
                runSubmit(stub.ctx, {
                    playerId: "p1",
                    stackItemId: head.stackItemId,
                    step: head.step,
                    choiceId: head.choiceId,
                    cardInstanceIds: ids,
                });

            // The land fails the filter.
            await expect(submit(["forest"])).rejects.toThrow(/not an eligible/);
            expect(stub.state().pendingChoices).toHaveLength(1);

            // Zero is a legal answer: the Ghoul enters, the graveyard stays.
            await submit([]);
            const after = stub.state();
            expect(
                after.players[0].battlefield.some((c) => c.id === ghoulId)
            ).toBe(true);
            expect(after.players[0].graveyard).toHaveLength(3);
        });
    });
});
