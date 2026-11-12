// The split `gameStates` document (ADR 0179): the hot row every save rewrites
// and every public-view subscriber re-reads carries no library; the libraries
// live in a `gameLibraries` companion written only when one changed, and
// `getPublicState` reads it only when the writer could not prove the
// projection indifferent to library contents.
//
// Driven through the real seam — `saveGameState`, `getLatestGameState` and
// the registered `getPublicState` handler over the shared stub ctx — because
// what is under test is a READ SET and a WRITE SET, which nothing
// result-shaped can see.
import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { getCardByName } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getPublicState } from "../game";
import { projectPublicState } from "../gameProjections";
import { getLatestGameState, saveGameState } from "../gameStateStore";
import {
    compactState,
    expandState,
    isSplitCompactState,
    OPAQUE_LIBRARIES,
    splitCompactState,
} from "../gre/serialize";
import type { CardInstanceState, GameState } from "../gre/state";
import {
    makeMutationCtx,
    runMutation,
    type MutationStub,
    type Row,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const BEAR = getCardByName("Grizzly Bears").id;
const WURM = getCardByName("Craw Wurm").id;
const FOREST = getCardByName("Forest").id;

function libraryCard(
    cardId: string,
    owner: string,
    n: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(cardId, {
        id: `${owner}-lib-${n}`,
        controllerId: owner,
        ownerId: owner,
        zone: "library",
        ...overrides,
    });
}

function library(owner: string): CardInstanceState[] {
    return [
        libraryCard(BEAR, owner, 0),
        libraryCard(WURM, owner, 1),
        libraryCard(FOREST, owner, 2),
        libraryCard(BEAR, owner, 3),
    ];
}

/** Two seats, each with a library, a hand card and a permanent — so every
 *  zone the projection walks holds something. */
function board(p1Library = library("p1")): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                library: p1Library,
                hand: [
                    makeInstance(BEAR, {
                        id: "p1-hand",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    makeInstance(FOREST, {
                        id: "p1-forest",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    }),
                ],
            }),
            makePlayer("p2", { library: library("p2") }),
        ],
    });
}

function gameRow(): Row {
    return {
        _id: GAME_ID,
        __table: "games",
        name: "Game",
        status: "playing",
        solo: false,
        vsAi: false,
        players: [{ id: "p1" }, { id: "p2" }],
        createdAt: 0,
        updatedAt: 0,
    };
}

/** A game whose first position went through `saveGameState`'s insert branch. */
async function savedGame(state: GameState): Promise<MutationStub> {
    const stub = makeMutationCtx("u1", [gameRow()]);
    await saveGameState(stub.ctx, GAME_ID, 0, state, null);
    return stub;
}

function rowsOf(stub: MutationStub, table: string): Row[] {
    return stub.writes
        .filter((w) => w.table === table)
        .map((w) => stub.doc(w.id));
}

function publicState(ctx: MutationCtx, playerId: string): Promise<unknown> {
    return runMutation(getPublicState, ctx, { gameId: GAME_ID, playerId });
}

/** The projection the single-row document produced: the saved position
 *  round-tripped through the compact form, projected with its libraries. */
function referenceProjection(state: GameState, seq: number, viewer: string) {
    return JSON.parse(
        JSON.stringify(
            projectPublicState(
                expandState(compactState(state)),
                seq,
                viewer,
                false
            )
        )
    );
}

describe("split document codec (ADR 0179)", () => {
    it("expands to the state the single-row document expands to", () => {
        const state = board([
            libraryCard(BEAR, "p1", 0, {
                knownTo: ["p1"],
                libraryPositionKnownTo: ["p1", "p2"],
            }),
            libraryCard(WURM, "p1", 1, { knownTo: ["p2"] }),
            libraryCard(FOREST, "p1", 2),
        ]);
        const { hot, libraries } = splitCompactState(state);
        expect(expandState(hot, libraries)).toEqual(
            expandState(compactState(state))
        );
    });

    it("keeps every library card out of the hot half", () => {
        const { hot, libraries } = splitCompactState(board());
        expect(isSplitCompactState(hot)).toBe(true);
        expect(JSON.stringify(hot)).not.toContain("-lib-");
        // WURM sits only in libraries: its id is in the companion's table,
        // never in the hot half's.
        expect(hot.cardPool).not.toContain(WURM);
        expect(libraries.cardPool).toContain(WURM);
        expect(hot.libraryCounts).toEqual([4, 4]);
    });

    it("refuses a hot half expanded without its libraries", () => {
        const { hot } = splitCompactState(board());
        expect(() => expandState(hot)).toThrow(/without its libraries/);
    });

    it("opaque expansion keeps the sizes and no identity", () => {
        const { hot } = splitCompactState(board());
        const opaque = expandState(hot, OPAQUE_LIBRARIES);
        expect(opaque.players.map((p) => p.library.length)).toEqual([4, 4]);
        expect(
            JSON.stringify(opaque.players.map((p) => p.library))
        ).not.toMatch(new RegExp(`${BEAR}|${WURM}|${FOREST}|-lib-`));
    });
});

describe("saveGameState writes the library companion only on change (ADR 0179)", () => {
    it("inserts one hot row and one companion on the first save", async () => {
        const stub = await savedGame(board());
        expect(rowsOf(stub, "gameStates")).toHaveLength(1);
        expect(rowsOf(stub, "gameLibraries")).toHaveLength(1);
        const hot = rowsOf(stub, "gameStates")[0].state as Record<
            string,
            unknown
        >;
        expect(isSplitCompactState(hot)).toBe(true);
    });

    it("a save that leaves the libraries alone writes no companion", async () => {
        const stub = await savedGame(board());
        const companionId = rowsOf(stub, "gameLibraries")[0]._id as string;
        const loaded = (await getLatestGameState(stub.ctx, GAME_ID))!;
        const next = structuredClone(loaded.state) as GameState;
        next.players[0].life = 17;
        stub.writes.length = 0;
        await saveGameState(stub.ctx, GAME_ID, 1, next, loaded);
        expect(stub.writes.map((w) => w.id)).not.toContain(companionId);
        expect(stub.writes.some((w) => w.table === "gameLibraries")).toBe(
            false
        );
    });

    it("a save that changes a library patches the companion", async () => {
        const stub = await savedGame(board());
        const companionId = rowsOf(stub, "gameLibraries")[0]._id as string;
        const loaded = (await getLatestGameState(stub.ctx, GAME_ID))!;
        const next = structuredClone(loaded.state) as GameState;
        const drawn = next.players[0].library.shift()!;
        next.players[0].hand.push({ ...drawn, zone: "hand" });
        stub.writes.length = 0;
        await saveGameState(stub.ctx, GAME_ID, 1, next, loaded);
        expect(stub.writes.map((w) => w.id)).toContain(companionId);
        const reloaded = (await getLatestGameState(stub.ctx, GAME_ID))!;
        expect(
            (reloaded.state as GameState).players[0].library.map((c) => c.id)
        ).toEqual(["p1-lib-1", "p1-lib-2", "p1-lib-3"]);
    });

    it("refuses to persist an opaque view", async () => {
        const stub = await savedGame(board());
        const { hot } = splitCompactState(board());
        await expect(
            saveGameState(
                stub.ctx,
                GAME_ID,
                1,
                expandState(hot, OPAQUE_LIBRARIES),
                await getLatestGameState(stub.ctx, GAME_ID)
            )
        ).rejects.toThrow(/opaque libraries/);
    });
});

describe("getPublicState reads the hot row alone when it can (ADR 0179)", () => {
    it("reads no library companion for a hidden library, same projection", async () => {
        const state = board();
        const stub = await savedGame(state);
        expect(rowsOf(stub, "gameStates")[0].publicViewNeedsLibrary).toBe(
            false
        );
        for (const viewer of ["p1", "p2"]) {
            stub.queried.length = 0;
            const projected = await publicState(stub.ctx, viewer);
            expect(stub.queried).not.toContain("gameLibraries");
            expect(JSON.parse(JSON.stringify(projected))).toEqual(
                referenceProjection(state, 0, viewer)
            );
        }
    });

    it("reads the companion when a viewer knows a library card (ADR 0026)", async () => {
        const state = board([
            libraryCard(WURM, "p1", 0, { knownTo: ["p1"] }),
            libraryCard(BEAR, "p1", 1),
        ]);
        const stub = await savedGame(state);
        expect(rowsOf(stub, "gameStates")[0].publicViewNeedsLibrary).toBe(true);
        stub.queried.length = 0;
        const projected = JSON.parse(
            JSON.stringify(await publicState(stub.ctx, "p1"))
        );
        expect(stub.queried).toContain("gameLibraries");
        expect(projected).toEqual(referenceProjection(state, 0, "p1"));
        expect(projected.players[0].library.count).toBe(2);
        expect(projected.players[0].library.known).toHaveLength(1);
    });

    it("reads the companion for a viewer who holds no seat", async () => {
        const stub = await savedGame(board());
        stub.queried.length = 0;
        await publicState(stub.ctx, "spectator");
        expect(stub.queried).toContain("gameLibraries");
    });

    it("still loads a single-row document, and the next save splits it", async () => {
        const state = board();
        const stub = makeMutationCtx("u1", [
            gameRow(),
            {
                _id: "gs-1",
                __table: "gameStates",
                gameId: GAME_ID,
                seq: 3,
                state: compactState(state),
                solo: false,
                vsAi: false,
                updatedAt: 0,
            },
        ]);
        expect(
            JSON.parse(JSON.stringify(await publicState(stub.ctx, "p1")))
        ).toEqual(referenceProjection(state, 3, "p1"));
        const loaded = (await getLatestGameState(stub.ctx, GAME_ID))!;
        await saveGameState(stub.ctx, GAME_ID, 4, loaded.state, loaded);
        expect(
            isSplitCompactState(
                stub.doc("gs-1").state as Record<string, unknown>
            )
        ).toBe(true);
        expect(rowsOf(stub, "gameLibraries")).toHaveLength(1);
        expect(stub.state().players.map((p) => p.library)).toEqual(
            expandState(compactState(state)).players.map((p) => p.library)
        );
    });
});
