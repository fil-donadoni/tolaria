// End-to-end integration for the play-lands-from-TOP-of-library capability
// (CR 305.1-analog — Courser of Kruphix): GRE → `convex/game.ts` → the UI
// render model.
//
// The GRE-level and wire-level assertions live in
// `convex/cards/sets/bng/__tests__/green.test.ts`. What THIS file exists for is
// the boundary crossing those cannot see: the affordance can be correct in
// `projectPublicState` and still be dead on the board, because the client never
// sees `GameState` — it sees what the `getPublicState` QUERY returns, fed into
// a client reducer. The whole path runs here for real:
//
//   1. GRE — a real `GameState` with a Courser on the battlefield, persisted
//      through `compactState` into a `gameStates` row (the serialization the DB
//      actually stores; an affordance riding a field the compactor drops would
//      die here);
//   2. game.ts — the REGISTERED `getPublicState` query's own `_handler`, driven
//      against a stub ctx, once per SEAT;
//   3. UI — `buildLibraryPileModel` (`src/lib/library-knowledge.ts`), the
//      reducer `player-library.tsx` actually calls, whose slot cards are what
//      `renderCardAction` receives. `LibraryPlayLandButton` gates purely on
//      `card.legalActions?.includes("play")`, so the slot card carrying (or
//      losing) that field IS the button appearing or not.
//
// A hand-built `PublicLibrary` at step 3 would prove nothing — the reducer
// would be reading a fixture, not the server.

import { describe, it, expect } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import { getPublicState } from "@convex/game";
import { compactState } from "@convex/gre/serialize";
import type { GameState } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { courserOfKruphix } from "@convex/cards/sets/bng/green";
import { forest, mountain } from "@convex/cards/sets/lea/colorless";
import { grizzlyBears } from "@convex/cards/sets/lea/green";
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

/** Drive the registered `getPublicState` query end-to-end for one seat, then
 *  run the pile reducer the component itself calls, and return exactly what
 *  `LibraryPlayLandButton` reads off the TOP slot's card: its `legalActions`.
 *  `undefined` means no button renders at all; `[]` means it renders disabled. */
async function topSlotLegalActionsFor(
    state: GameState,
    viewerId: string,
    libraryOwnerId: string
): Promise<string[] | undefined> {
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
    const pile = buildLibraryPileModel(owner.library as never, libraryOwnerId);
    return pile[0]?.card.legalActions;
}

function courserBoard(
    libraryIds: string[],
    withCourser = true,
    landsPlayedThisTurn?: number
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: withCourser
                    ? [
                          makeInstance(courserOfKruphix.id, {
                              controllerId: "p1",
                              ownerId: "p1",
                              id: "courser",
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
                ...(landsPlayedThisTurn !== undefined
                    ? { landsPlayedThisTurn }
                    : {}),
            }),
            makePlayer("p2"),
        ],
    });
}

describe("play-lands-from-top-of-library end-to-end (CR 305.1-analog, Courser of Kruphix)", () => {
    it("the controller's own top-of-library land arrives at the pile reducer with a PLAYABLE affordance", async () => {
        const state = courserBoard([forest.id, mountain.id]);
        await expect(
            topSlotLegalActionsFor(state, "p1", "p1")
        ).resolves.toContain("play");
    });

    it("the OPPONENT's view of that same card carries no affordance", async () => {
        // The CR 401.5 reveal is symmetric, so p2 genuinely sees the card — but
        // it is never theirs to play, so no Play button may reach their board.
        const state = courserBoard([forest.id, mountain.id]);
        await expect(
            topSlotLegalActionsFor(state, "p2", "p1")
        ).resolves.toBeUndefined();
    });

    it("no affordance without a Courser on the battlefield", async () => {
        const state = courserBoard([forest.id, mountain.id], false);
        await expect(
            topSlotLegalActionsFor(state, "p1", "p1")
        ).resolves.toBeUndefined();
    });

    it("no affordance when the top card is not a land", async () => {
        const state = courserBoard([grizzlyBears.id, forest.id]);
        await expect(
            topSlotLegalActionsFor(state, "p1", "p1")
        ).resolves.toBeUndefined();
    });

    it("renders DISABLED (present but empty) once the land drop is spent", async () => {
        // CR 305.2 — still "playable in principle", just not right now. The
        // button must appear greyed rather than vanish, so the player can see
        // WHY nothing happens; that distinction is carried entirely by
        // present-but-empty vs. absent.
        const state = courserBoard([forest.id, mountain.id], true, 1);
        await expect(
            topSlotLegalActionsFor(state, "p1", "p1")
        ).resolves.toEqual([]);
    });
});
