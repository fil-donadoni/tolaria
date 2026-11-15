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
//      integration coverage — see `gameMutationHarness.fixture.ts`), once per SEAT;
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
import { announceCast, cancelCast, getPublicState } from "@convex/game";
import { getLatestGameState, saveGameState } from "@convex/gameStateStore";
import { compactState } from "@convex/gre/serialize";
import type { GameState } from "@convex/gre/state";
import { drawCard } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getDefinition } from "@convex/cards";
import { grizzlyBears } from "@convex/cards/sets/lea/green.cards";
import {
    mountain,
    forest,
    island,
} from "@convex/cards/sets/lea/colorless.cards";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
} from "@convex/__tests__/gameMutationHarness.fixture";
import { buildLibraryPileModel } from "~/lib/library-knowledge";
import type { PublicLibrary } from "~/types/game";

const goblinSpy = () => getDefinition("2a89a099-8805-4b26-babd-5d9f48ee406a");

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
    return renderedPileIn(ctx, viewerId, libraryOwnerId);
}

/** {@link renderedPileFor} over the game already persisted in `ctx`. */
async function renderedPileIn(
    ctx: MutationCtx,
    viewerId: string,
    libraryOwnerId: string
): Promise<[string | null, boolean][]> {
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
                          makeInstance(goblinSpy().id, {
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
        const state = spyBoard([mountain().id, forest().id, island().id]);

        // The whole rendered pile, for each seat: exactly one face-up slot at
        // the top, two backs below it. Asserting the FULL pile (not just index
        // 0) is what proves the reveal does not leak the rest of the library
        // into the UI.
        const expected: [string | null, boolean][] = [
            [mountain().id, true],
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
        const state = spyBoard([mountain().id, forest().id], false);
        await expect(renderedTopFor(state, "p1", "p1")).resolves.toBeNull();
        await expect(renderedTopFor(state, "p2", "p1")).resolves.toBeNull();
    });

    it("renders the NEW top card after a draw, on both seats (CR 401.6)", async () => {
        const state = spyBoard([mountain().id, forest().id, island().id]);
        drawCard(state.players[0]);
        await expect(renderedTopFor(state, "p1", "p1")).resolves.toBe(
            forest().id
        );
        await expect(renderedTopFor(state, "p2", "p1")).resolves.toBe(
            forest().id
        );
    });

    it("renders a card back again once the Spy leaves the battlefield (CR 604.2)", async () => {
        const state = spyBoard([mountain().id, forest().id]);
        state.players[0].battlefield = [];
        await expect(renderedTopFor(state, "p2", "p1")).resolves.toBeNull();
    });

    it('never renders the opponent\'s library top — the reveal is scoped to "your library"', async () => {
        const state = spyBoard([mountain().id, forest().id]);
        state.players[1].library = [
            makeInstance(island().id, {
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

// CR 401.5 sentence 2 / CR 601.2i — the announcement window. The cast is
// announced and cancelled through the real mutations, every stable point is
// persisted by `saveGameState`, and each seat's pile is read through the real
// query and reducer. No shipped action moves a library card while a spell is
// parked mid-cast (CR 605.1a keeps mana abilities off the library, and every
// library-moving cost is paid at commit), so the one hand-made step is that
// move, persisted through the same writer.
describe("announcement-window freeze end-to-end (CR 401.5, CR 601.2i)", () => {
    const ARGS = { gameId: GAME_ID, playerId: "p1" };

    function castableSpyBoard(): GameState {
        const state = spyBoard([mountain().id, forest().id, island().id]);
        const p1 = state.players[0];
        const own = (
            cardId: string,
            id: string,
            zone: "hand" | "battlefield"
        ) =>
            makeInstance(cardId, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone,
            });
        p1.hand = [own(grizzlyBears().id, "bears", "hand")];
        // Castable, so the cast parks in its payment step.
        p1.battlefield.push(
            own(forest().id, "land-0", "battlefield"),
            own(mountain().id, "land-1", "battlefield")
        );
        state.phase = "PRECOMBAT_MAIN";
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        return state;
    }

    it("keeps a top that changed mid-cast face-down on both seats until the window closes", async () => {
        const harness = makeMutationCtx("p1", [
            gameSeed(),
            gameStateSeed(castableSpyBoard()),
        ]);
        await runMutation(announceCast, harness.ctx, {
            ...ARGS,
            cardInstanceId: "bears",
        });
        expect(harness.state().pendingCast).toBeDefined();
        // An unchanged top stays revealed through the window.
        expect((await renderedPileIn(harness.ctx, "p2", "p1"))[0]).toEqual([
            mountain().id,
            true,
        ]);

        // The top card leaves the library while the spell is being cast.
        const loaded = (await getLatestGameState(harness.ctx, GAME_ID))!;
        const moved = structuredClone(loaded.state) as GameState;
        drawCard(moved.players[0]);
        await saveGameState(
            harness.ctx,
            GAME_ID,
            loaded.seq + 1,
            moved,
            loaded
        );

        for (const viewer of ["p1", "p2"]) {
            expect(
                (await renderedPileIn(harness.ctx, viewer, "p1"))[0]
            ).toEqual([null, false]);
        }

        // The window closes: the new top is revealed again.
        await runMutation(cancelCast, harness.ctx, ARGS);
        expect(harness.state().pendingCast).toBeUndefined();
        for (const viewer of ["p1", "p2"]) {
            expect(
                (await renderedPileIn(harness.ctx, viewer, "p1"))[0]
            ).toEqual([forest().id, true]);
        }
    });
});
