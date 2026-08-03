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
//   3. UI — the real `libraryPreviewTopCard` reducer (`src/lib/
//      library-knowledge.ts`), the function the library pile actually calls to
//      decide whether to render a face-up card or a card back.
//
// A hand-built `PublicLibrary` at step 3 would prove nothing (the reducer would
// be reading a fixture, not the server), which is exactly the shape the
// proof-of-failure rule calls "the test never reaches the code".

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
import { libraryPreviewTopCard } from "~/lib/library-knowledge";
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

/** Drive the registered `getPublicState` query end-to-end for one seat and
 *  return what the UI reducer would render for `libraryOwnerId`'s pile. */
async function previewTopCardFor(
    state: GameState,
    viewerId: string,
    libraryOwnerId: string
): Promise<string | null> {
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
    const top = libraryPreviewTopCard(owner.library as never);
    return top ? top.card.id : null;
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
    it("renders the revealed top card face-up on BOTH seats' library pile", async () => {
        const state = spyBoard([mountain.id, forest.id, island.id]);

        // The controller's own pile.
        await expect(previewTopCardFor(state, "p1", "p1")).resolves.toBe(
            mountain.id
        );
        // The OPPONENT's view of that same pile — the point of the card.
        await expect(previewTopCardFor(state, "p2", "p1")).resolves.toBe(
            mountain.id
        );
    });

    it("renders a card BACK when no Goblin Spy is on the battlefield", async () => {
        const state = spyBoard([mountain.id, forest.id], false);
        await expect(previewTopCardFor(state, "p1", "p1")).resolves.toBeNull();
        await expect(previewTopCardFor(state, "p2", "p1")).resolves.toBeNull();
    });

    it("renders the NEW top card after a draw, on both seats (CR 401.6)", async () => {
        const state = spyBoard([mountain.id, forest.id, island.id]);
        drawCard(state.players[0]);
        await expect(previewTopCardFor(state, "p1", "p1")).resolves.toBe(
            forest.id
        );
        await expect(previewTopCardFor(state, "p2", "p1")).resolves.toBe(
            forest.id
        );
    });

    it("renders a card back again once the Spy leaves the battlefield (CR 604.2)", async () => {
        const state = spyBoard([mountain.id, forest.id]);
        state.players[0].battlefield = [];
        await expect(previewTopCardFor(state, "p2", "p1")).resolves.toBeNull();
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
        await expect(previewTopCardFor(state, "p1", "p2")).resolves.toBeNull();
        await expect(previewTopCardFor(state, "p2", "p2")).resolves.toBeNull();
    });

    it("renders a card back — and does not throw — on an empty library", async () => {
        const state = spyBoard([]);
        await expect(previewTopCardFor(state, "p2", "p1")).resolves.toBeNull();
    });
});
