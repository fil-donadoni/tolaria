// Full-path integration for a pairwise-DISTINCT library search (issue #6475):
// GRE → game.ts → wire projection, on Gifts Ungiven.
//
//   CR 701.23a  To search for a card in a zone, look at all cards in that zone
//               (even if it's a hidden zone) and find a card that matches the
//               given description.
//   CR 701.23b  If a player is searching a hidden zone for a single card, that
//               player isn't required to find it even if it's there.
//
// Three seams a GRE-only test does not reach:
//  1. The SUBMISSION, through the REGISTERED `submitResolutionChoice` handler
//     over the stub `MutationCtx` — two same-name cards are refused, a
//     distinct set accepted.
//  2. The SURFACE, through `projectPublicState`: `distinctKeys` must survive
//     the projection or the client cannot gate its clicks.
//  3. The client gate itself, through the shared leaf predicate on the
//     PROJECTED keys (the shape `player-library.tsx` reads).

import { describe, it, expect } from "vitest";
import { submitResolutionChoice } from "../game";
import { resolveTopOfStack } from "../gre/state";
import type { GameState } from "../gre/state";
import { getCardByName } from "../cards";
import { canAddDistinctPick } from "../gre/distinctPick";
import { projectPublicState } from "../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../cards/__tests__/setup.helper";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const GIFTS = getCardByName("Gifts Ungiven").id;
const ISLAND = getCardByName("Island").id;
const FOREST = getCardByName("Forest").id;
const BEARS = getCardByName("Grizzly Bears").id;

type SubmitArgs = {
    gameId: Id<"games">;
    playerId: string;
    stackItemId: string;
    step: number;
    choiceId: string;
    cardInstanceIds: string[];
};

const submitHead = (state: GameState, cardInstanceIds: string[]) => {
    const head = state.pendingChoices![0];
    const stub = makeMutationCtx(head.playerId, [gameStateSeed(state)]);
    return {
        stub,
        run: () =>
            runMutation<SubmitArgs, void>(
                submitResolutionChoice as unknown as Handler<SubmitArgs, void>,
                stub.ctx,
                {
                    gameId: GAME_ID,
                    playerId: head.playerId,
                    stackItemId: head.stackItemId,
                    step: head.step,
                    choiceId: head.choiceId,
                    cardInstanceIds,
                }
            ),
    };
};

/** p1 casts Gifts Ungiven at p2 with two Islands, a Forest and a Bears on top. */
const suspended = (): GameState => {
    const lib = (defId: string, id: string) =>
        makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                library: [
                    lib(ISLAND, "island-1"),
                    lib(ISLAND, "island-2"),
                    lib(FOREST, "forest-1"),
                    lib(BEARS, "bears"),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    pushSpell(state, GIFTS, "p1", [{ type: "player", id: "p2" }]);
    expect(resolveTopOfStack(state)).toBeNull();
    return state;
};

describe("Gifts Ungiven — the distinct search, end to end (CR 701.23a)", () => {
    it("WIRE: the searcher's projection carries the name keys and a count ceiling of the distinct names", () => {
        const view = projectPublicState(suspended(), 1, "p1");
        const head = view.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.distinctKeys).toEqual({
            "island-1": "Island",
            "island-2": "Island",
            "forest-1": "Forest",
            bears: "Grizzly Bears",
        });
        // Three distinct names among four cards, below the printed four
        // (CR 608.2b clamps; CR 701.23b makes it a ceiling, not a floor).
        expect(head.count).toEqual({ min: 0, max: 3 });
        // Client gate on the projected keys: the second Island is refused.
        expect(
            canAddDistinctPick(head.distinctKeys!, ["island-1"], "island-2")
        ).toBe(false);
        expect(
            canAddDistinctPick(head.distinctKeys!, ["island-1"], "forest-1")
        ).toBe(true);
    });

    it("the real mutation refuses two same-name cards", async () => {
        const state = suspended();
        const { stub, run } = submitHead(state, ["island-1", "island-2"]);
        await expect(run()).rejects.toThrow(/different/);
        expect(stub.state().pendingChoices).toHaveLength(1);
    });

    it("a distinct set is accepted and the target opponent picks two of the revealed cards", async () => {
        const state = suspended();
        const search = submitHead(state, ["island-1", "forest-1", "bears"]);
        await search.run();

        const afterSearch = search.stub.state();
        const pick = afterSearch.pendingChoices![0];
        expect(pick.kind).toBe("choose-library-card");
        expect(pick.playerId).toBe("p2");
        expect(pick.count).toBe(2);

        const choose = submitHead(afterSearch, ["island-1", "bears"]);
        await choose.run();
        const after = choose.stub.state();
        expect(after.pendingChoices ?? []).toHaveLength(0);
        // The chosen cards go to the graveyard, the rest of the pile to hand.
        // (The resolved spell itself lands there too, CR 608.2n.)
        const graveyardIds = after.players[0].graveyard.map((c) => c.id);
        expect(graveyardIds).toContain("bears");
        expect(graveyardIds).toContain("island-1");
        expect(graveyardIds).not.toContain("forest-1");
        expect(after.players[0].hand.map((c) => c.id)).toEqual(["forest-1"]);
        // The unfound Island stayed in the (shuffled) library.
        expect(after.players[0].library.map((c) => c.id)).toEqual(["island-2"]);
    });

    it("CR 701.23b — finding fewer than the ceiling, or none, is legal", async () => {
        const state = suspended();
        const { stub, run } = submitHead(state, []);
        await run();
        expect(stub.state().pendingChoices ?? []).toHaveLength(0);
        expect(stub.state().players[0].library).toHaveLength(4);
    });
});
