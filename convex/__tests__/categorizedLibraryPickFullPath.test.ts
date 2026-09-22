// Full-path integration for CATEGORISED SELECTION OVER A WHOLE LIBRARY
// (issue #3808): GRE → game.ts → wire projection, on the two shipped cards.
//
//   CR 701.23a  To search for a card in a zone, look at all cards in that zone
//               (even if it's a hidden zone) and find a card that matches the
//               given description.
//   CR 701.20a  To reveal a card, show that card to all players for a brief
//               time.
//
// Three seams, none of which a GRE-only test reaches:
//
//  1. The CAST COST. Gaea's Balance is the first counted `sacrificeFilter`
//     ("sacrifice five lands"), so the gate `announceCast` runs before it
//     touches the stack — `assertLegalAction` → `canPayAdditionalCostSpec` —
//     has to price FIVE, not one, and `buildAdditionalCostPicker` has to hand
//     the picker a count of five. Driven exactly as
//     `additional-cost-cast.test.ts` drives it: the real exported pieces, in
//     the order the mutation calls them (the project has no convex-test
//     harness for the cast path, ADR 0001).
//
//  2. The SUBMISSION, through the REGISTERED `submitResolutionChoice`
//     `_handler` over the stub `MutationCtx`, not through
//     `applyPendingChoiceSubmit` directly — the mutation owns the seat check
//     and `saveGameState`, and Guided Passage is the first categorised pick a
//     FOREIGN seat answers.
//
//  3. The SURFACE, through `projectPublicState`: the categories and the
//     exposed library the client renders the picker from. A hand-built view
//     would prove nothing about what the client actually receives.

import { describe, it, expect } from "vitest";
import { submitResolutionChoice, buildAdditionalCostPicker } from "../game";
import { buildCastCostSelection } from "../gre/castCostPicks";
import { assertLegalAction } from "../gre/rules";
import { resolveTopOfStack, getPlayer } from "../gre/state";
import type { GameState } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../cards/__tests__/setup";
import { gaeasBalance } from "../cards/sets/apc/green";
import { guidedPassage } from "../cards/sets/apc/multicolor";
import { forest, island, plains, grizzlyBears } from "../cards/sets/lea";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type SubmitArgs = {
    gameId: Id<"games">;
    playerId: string;
    stackItemId: string;
    step: number;
    choiceId: string;
    cardInstanceIds: string[];
};

/** Drive the REAL mutation for whoever the head names as chooser. */
const submitHead = (
    state: GameState,
    cardInstanceIds: string[],
    as?: string
) => {
    const head = state.pendingChoices![0];
    const seat = as ?? head.playerId;
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
                    cardInstanceIds,
                }
            ),
    };
};

const libraryCard = (defId: string, id: string, owner = "p1") =>
    makeInstance(defId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "library",
    });

describe("Gaea's Balance — counted sacrifice cost (CR 601.2f / 118.8, issue #3808)", () => {
    /** p1 holding the card with `lands` basic Forests on the battlefield. */
    const board = (lands: number): GameState =>
        makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [makeInstance(gaeasBalance.id, { zone: "hand" })],
                    battlefield: Array.from({ length: lands }, (_, i) =>
                        makeInstance(forest.id, {
                            id: `land-${i}`,
                            zone: "battlefield",
                        })
                    ),
                    manaPool: { G: 5, C: 5 },
                }),
                makePlayer("p2"),
            ],
        });

    it("CR 601.2h — four lands cannot pay a five-land cost, so the cast is illegal", () => {
        const state = board(4);
        const player = getPlayer(state, "p1");
        expect(() =>
            assertLegalAction(state, player, player.hand[0], "cast")
        ).toThrow(/Illegal action "cast"/);
    });

    it("five lands make it legal, and the picker asks for all five", () => {
        const state = board(5);
        const player = getPlayer(state, "p1");
        expect(() =>
            assertLegalAction(state, player, player.hand[0], "cast")
        ).not.toThrow();

        const picker = buildAdditionalCostPicker(
            gaeasBalance.additionalCosts,
            player
        );
        expect(picker).toEqual({
            kind: "sacrifice",
            filter: { types: "Land" },
            count: 5,
        });
    });

    it("the search's own cost path asks for five and snapshots none of them", () => {
        // `gre/castCostPicks.ts` is the SECOND builder — the one the bot's
        // search pays with, so a fix to `game.ts` alone would leave the bot
        // casting this for one land inside its own tree.
        const state = board(5);
        const player = getPlayer(state, "p1");
        const { selection } = buildCastCostSelection(
            state,
            player,
            player.hand[0],
            gaeasBalance.additionalCosts,
            "Gaea's Balance"
        );
        expect(selection?.requirements).toHaveLength(1);
        expect(selection!.requirements[0].count).toBe(5);
        // "The sacrificed permanent" has no referent once five pay, so the
        // requirement is NOT snapshot-flagged — the policy `gre/activation.ts`
        // states for the activated twin, applied to the cast cost.
        expect(selection!.requirements[0].snapshot).toBe(false);
        // Exactly five lands were auto-resolved (they are fungible here).
        expect(selection!.picked).toHaveLength(5);
    });
});

describe("Gaea's Balance — the categorised search, end to end (CR 701.23a)", () => {
    /** The spell resolved down to its suspended search. */
    const suspended = (): GameState => {
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    library: [
                        libraryCard(forest.id, "forest-1"),
                        libraryCard(island.id, "island-1"),
                        libraryCard(forest.id, "forest-2"),
                        libraryCard(grizzlyBears.id, "bears"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, gaeasBalance.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        return state;
    };

    it("the SEARCHER's projection carries the categories and the whole library", () => {
        const state = suspended();
        const view = projectPublicState(state, 1, "p1");
        const head = view.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        // The client's per-click gate reads exactly these buckets
        // (`canAddCategorizedPick`, shared with the submit validator).
        expect(head.categories).toEqual([
            { label: "Plains", cardIds: [] },
            { label: "Island", cardIds: ["island-1"] },
            { label: "Swamp", cardIds: [] },
            { label: "Mountain", cardIds: [] },
            { label: "Forest", cardIds: ["forest-1", "forest-2"] },
        ]);
        // CR 701.23a — the LOOK is at every card, including the creature that
        // answers no category and can never be picked.
        expect(view.players[0].librarySearch!.map((c) => c.id).sort()).toEqual([
            "bears",
            "forest-1",
            "forest-2",
            "island-1",
        ]);
        expect(head.candidateIds!.sort()).toEqual([
            "forest-1",
            "forest-2",
            "island-1",
        ]);
        // Two categories answerable, one card each: the maximum matching.
        expect(head.count).toEqual({ min: 0, max: 2 });

        // The OPPONENT is shown neither the picker's pool nor the library.
        const opponentView = projectPublicState(state, 1, "p2");
        expect(opponentView.players[0].librarySearch).toBeUndefined();
        expect(opponentView.players[0].library.known).toEqual([]);
    });

    it("the real mutation applies one land per basic type and shuffles", async () => {
        const state = suspended();
        const { stub, run } = submitHead(state, ["forest-1", "island-1"]);
        await run();

        const after = stub.state();
        expect(after.pendingChoices ?? []).toHaveLength(0);
        expect(after.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "forest-1",
            "island-1",
        ]);
        expect(after.players[0].library.map((c) => c.id).sort()).toEqual([
            "bears",
            "forest-2",
        ]);

        // SURFACE, through the reducer: both lands are on the projected
        // battlefield and the search exposure is gone with the choice.
        const view = projectPublicState(after, 1, "p1");
        expect(view.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "forest-1",
            "island-1",
        ]);
        expect(view.players[0].librarySearch).toBeUndefined();
    });

    it("the real mutation refuses two cards seated in the same category", async () => {
        const state = suspended();
        const { stub, run } = submitHead(state, ["forest-1", "forest-2"]);
        await expect(run()).rejects.toThrow(/different category/);
        // Nothing partial was written: the choice is still owed.
        expect(stub.state().pendingChoices).toHaveLength(1);
        expect(stub.state().players[0].battlefield).toHaveLength(0);
    });
});

describe("Guided Passage — an OPPONENT's categorised pick (CR 701.20a, issue #3808)", () => {
    const suspended = (): GameState => {
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    library: [
                        libraryCard(grizzlyBears.id, "bears"),
                        libraryCard(forest.id, "forest-1"),
                        libraryCard(plains.id, "plains-1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, guidedPassage.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        return state;
    };

    it("the pick is addressed to the opponent, over the caster's revealed library", () => {
        const state = suspended();
        // CR 701.20a — the reveal is PUBLIC, so both seats see the library.
        for (const seat of ["p1", "p2"] as const) {
            const view = projectPublicState(state, 1, seat);
            expect(view.players[0].library.known.map((k) => k.card.id)).toEqual(
                ["bears", "forest-1", "plains-1"]
            );
        }
        const chooserView = projectPublicState(state, 1, "p2");
        const head = chooserView.pendingChoices![0];
        expect(head.kind).toBe("choose-library-card");
        expect(head.playerId).toBe("p2");
        expect(head.zoneOwnerId).toBe("p1");
        expect(head.categories).toEqual([
            { label: "Creature card", cardIds: ["bears"] },
            { label: "Land card", cardIds: ["forest-1", "plains-1"] },
            { label: "Noncreature, nonland card", cardIds: [] },
        ]);
        // No noncreature nonland card in the library — CR 608.2b lowers the
        // count instead of demanding a pick nobody can make.
        expect(head.count).toBe(2);
        // The picker renders off `libraryPeek` on the ZONE OWNER's row.
        expect(chooserView.players[0].libraryPeek!.map((c) => c.id)).toEqual([
            "bears",
            "forest-1",
            "plains-1",
        ]);
    });

    it("the opponent's submission puts the chosen cards into the CASTER's hand", async () => {
        const state = suspended();
        const { stub, run } = submitHead(state, ["bears", "forest-1"]);
        await run();

        const after = stub.state();
        expect(after.pendingChoices ?? []).toHaveLength(0);
        expect(after.players[0].hand.map((c) => c.id).sort()).toEqual([
            "bears",
            "forest-1",
        ]);
        expect(after.players[1].hand).toHaveLength(0);
        // CR 701.20d — the shuffle re-hides what was left behind.
        expect(after.players[0].library.map((c) => c.id)).toEqual(["plains-1"]);
        const view = projectPublicState(after, 1, "p2");
        expect(view.players[0].library.known).toEqual([]);
    });

    it("the CASTER cannot answer the opponent's choice", async () => {
        const state = suspended();
        const { run } = submitHead(state, ["bears", "forest-1"], "p1");
        await expect(run()).rejects.toThrow();
    });

    it("two lands are refused — they answer one description twice", async () => {
        const state = suspended();
        const { stub, run } = submitHead(state, ["forest-1", "plains-1"]);
        await expect(run()).rejects.toThrow(/different category/);
        expect(stub.state().players[0].hand).toHaveLength(0);
    });
});
