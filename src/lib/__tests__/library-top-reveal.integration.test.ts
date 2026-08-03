// End-to-end integration for the continuous library-top reveal (CR 401.5,
// issue #1095 gap 7): GRE → `convex/game.ts` → the UI render model.
//
// The per-card wire assertions live in `convex/cards/sets/inv/__tests__/
// red.test.ts`. What THIS file exists for is the boundary crossing those
// cannot see: a capability can be correct in `projectPublicState` and still be
// dead on the board, because the client never sees `GameState` — it sees what
// the `getPublicState` QUERY returns, fed into a client reducer. So the whole
// path runs here for real:
//
//   1. GRE — a real `GameState` with Goblin Spy on the battlefield, persisted
//      through `compactState` into a `gameStates` row (the serialization the
//      DB actually stores; a reveal that depended on a field the compactor
//      drops would die here);
//   2. game.ts — the REGISTERED `getPublicState` query's own `_handler`,
//      driven against a stub ctx (this repo's established seam for `game.ts`
//      integration coverage — see `gameMutationHarness.ts`), once per SEAT;
//   3. UI — `buildLibraryPileModel` (`src/lib/library-knowledge.ts`), which is
//      the reducer the pile ACTUALLY calls: `player-library.tsx:127` is its
//      one and only non-test caller, and its `faceUp` flag is what decides
//      between a rendered card face and a card back.
//
// A hand-built `PublicLibrary` at step 3 would prove nothing (the reducer would
// be reading a fixture, not the server), which is exactly the shape the
// proof-of-failure rule calls "the test never reaches the code". Note this file
// originally drove `libraryPreviewTopCard` instead — which has ZERO non-test
// callers, so gutting the pile's real `known[]` read left it green. Picking the
// plausible-looking helper over the one the component imports is the same bug
// class in a subtler dress; the rule is to follow the component's own import.

import { describe, it, expect } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import { getPublicState } from "@convex/game";
import { compactState } from "@convex/gre/serialize";
import type { GameState } from "@convex/gre/state";
import { drawCard } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { goblinSpy } from "@convex/cards/sets/inv/red";
import { mountain, forest, island } from "@convex/cards/sets/lea/colorless";
import {
    makeMutationCtx,
    gameStateSeed,
} from "@convex/__tests__/gameMutationHarness";
import { buildLibraryPileModel } from "~/lib/library-knowledge";
import type { PublicLibrary } from "~/types/game";

const GAME_ID = "game-1" as Id<"games">;

type PublicStateArgs = {
    gameId: Id<"games">;
    playerId: string;
    debugAllActions?: boolean;
};
type QueryHandler = {
    _handler: (
        ctx: MutationCtx,
        args: PublicStateArgs
    ) => Promise<{
        players: { id: string; library: PublicLibrary }[];
    } | null>;
};

/** A `games` row for a NON-solo two-player match, so `getPublicState` honors
 *  the requested `playerId` as the viewer instead of following priority. */
const gameSeed = () => ({
    _id: "game-1",
    __table: "games",
    solo: false,
    vsAi: false,
});

/** Drive the registered `getPublicState` query end-to-end for one seat, then run
 *  the pile reducer the component itself calls. Returns the rendered pile as
 *  `[definition id | null, faceUp]` per slot, top → bottom — `null` marks the
 *  synthetic face-down placeholder `buildLibraryPileModel` substitutes for an
 *  unknown position, i.e. a card BACK on screen. */
async function renderedPileFor(
    state: GameState,
    viewerId: string,
    libraryOwnerId: string
): Promise<[string | null, boolean][]> {
    const { ctx } = makeMutationCtx("user-1", [
        gameSeed(),
        // `compactState` is what `saveGameState` writes; seeding the compacted
        // form means the query's own `expandState` round-trip is exercised.
        {
            ...gameStateSeed(state),
            state: compactState(state) as unknown as GameState,
        },
    ]);
    const projected = await (
        getPublicState as unknown as QueryHandler
    )._handler(ctx, { gameId: GAME_ID, playerId: viewerId });
    const owner = projected!.players.find((p) => p.id === libraryOwnerId)!;
    return buildLibraryPileModel(owner.library as never, libraryOwnerId).map(
        (slot) => [slot.faceUp ? slot.card.card.id : null, slot.faceUp]
    );
}

/** The card the pile renders FACE-UP at the top of the library, or `null` when
 *  that slot renders as a back. */
async function renderedTopFor(
    state: GameState,
    viewerId: string,
    libraryOwnerId: string
): Promise<string | null> {
    const pile = await renderedPileFor(state, viewerId, libraryOwnerId);
    return pile.length > 0 ? pile[0][0] : null;
}

function spyBoard(libraryIds: string[], withSpy = true): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: withSpy
                    ? [
                          makeInstance(goblinSpy.id, {
                              controllerId: "p1",
                              ownerId: "p1",
                              id: "spy",
                          }),
                      ]
                    : [],
                library: libraryIds.map((cardId, i) =>
                    makeInstance(cardId, {
                        controllerId: "p1",
                        ownerId: "p1",
                        id: `p1-lib-${i}`,
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

describe("continuous library-top reveal end-to-end (CR 401.5, issue #1095)", () => {
    it("renders the revealed top card face-up — and every other slot as a BACK — on BOTH seats' pile", async () => {
        const state = spyBoard([mountain.id, forest.id, island.id]);

        // The whole rendered pile, for each seat: exactly one face-up slot at
        // the top, two backs below it. Asserting the FULL pile (not just index
        // 0) is what proves the reveal does not leak the rest of the library
        // into the UI.
        const expected: [string | null, boolean][] = [
            [mountain.id, true],
            [null, false],
            [null, false],
        ];
        // The controller's own pile.
        await expect(renderedPileFor(state, "p1", "p1")).resolves.toEqual(
            expected
        );
        // The OPPONENT's view of that same pile — the point of the card.
        await expect(renderedPileFor(state, "p2", "p1")).resolves.toEqual(
            expected
        );
    });

    it("renders a card BACK when no Goblin Spy is on the battlefield", async () => {
        const state = spyBoard([mountain.id, forest.id], false);
        await expect(renderedTopFor(state, "p1", "p1")).resolves.toBeNull();
        await expect(renderedTopFor(state, "p2", "p1")).resolves.toBeNull();
    });

    it("renders the NEW top card after a draw, on both seats (CR 401.6)", async () => {
        const state = spyBoard([mountain.id, forest.id, island.id]);
        drawCard(state.players[0]);
        await expect(renderedTopFor(state, "p1", "p1")).resolves.toBe(
            forest.id
        );
        await expect(renderedTopFor(state, "p2", "p1")).resolves.toBe(
            forest.id
        );
    });

    it("renders a card back again once the Spy leaves the battlefield (CR 604.2)", async () => {
        const state = spyBoard([mountain.id, forest.id]);
        state.players[0].battlefield = [];
        await expect(renderedTopFor(state, "p2", "p1")).resolves.toBeNull();
    });

    it('never renders the opponent\'s library top — the reveal is scoped to "your library"', async () => {
        const state = spyBoard([mountain.id, forest.id]);
        state.players[1].library = [
            makeInstance(island.id, {
                controllerId: "p2",
                ownerId: "p2",
                id: "p2-lib-0",
                zone: "library",
            }),
        ];
        await expect(renderedTopFor(state, "p1", "p2")).resolves.toBeNull();
        await expect(renderedTopFor(state, "p2", "p2")).resolves.toBeNull();
    });

    it("renders a card back — and does not throw — on an empty library", async () => {
        const state = spyBoard([]);
        await expect(renderedTopFor(state, "p2", "p1")).resolves.toBeNull();
    });
});
