// Admin gate for the debug mutations that take a client-supplied `gameId`
// with no seat argument (issue #1679). Each mutation
// (`convex/game.ts`) selects/mutates a Game/Match purely from `gameId`, so
// without an admin gate ANY authenticated caller — or, worse, an
// unauthenticated one — could act on a game they are not part of:
//   * `debugBo3Sideboard` — force-finishes a Game/Match.
//   * `debugPatchState`   — writes an ARBITRARY value to an ARBITRARY
//     dot-path of the state (issue #1679 review: proven exploitable via
//     `{ path: "players.0.life", value: 0 }` against another user's game).
//   * `debugResetGame`    — rebuilds a Game's state and its owning Match/
//     standings from scratch.
// `assertIsAdmin(ctx)` now runs FIRST in all three, before any Match/Game/
// gameStates row is read or touched (same CLAUDE.md privileged-mutation
// convention as `debugSetupScenario`, issue #768). `debugPatchState` setting
// a seat's life to 0 also reaches the Limited standings path — the next
// legitimate action's SBA sweep is the delivery mechanism
// (`checkStateBasedActions` -> `finalizeGameOver` ->
// `recordLimitedPairingResult`, see `assertCallerOwnsSeat`'s docstring in
// `gameLifecycle.ts`, issue #1645) — so this is not merely a state-corruption
// bug, it is a standings-scoring exploit reachable from `gameId` alone.
//
// Same harness discipline as `seatOwnership.test.ts` / `limitedPairingMatch.test.ts`:
// the project has no convex-test harness, so this drives each REGISTERED
// mutation's own `_handler` against an in-memory stub `MutationCtx` — not
// just the pure `isAdminUser` predicate — so the assertion is "the handler
// rejects and touches nothing", not merely "the predicate returns false".
// Uses the SHARED `gameMutationHarness` stub (issue #1779's seam) instead of
// a local copy — this file used to hand-roll its own `makeCtx`, a verbatim
// duplicate of `makeMutationCtx` save for accepting `userId: string | null`
// for the unauthenticated case; that delta is now upstreamed onto the shared
// harness itself.
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { debugBo3Sideboard, debugPatchState, debugResetGame } from "../game";
import type { GameState } from "../gre/state";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { makeMutationCtx, runMutation, type Row } from "./gameMutationHarness";

/** LEA Mountain — any real definition works; the library only needs one card
 *  for the fixture Game's `GameState`. */
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

const matchSeat = (id: string, name: string) => ({
    id,
    name,
    bgColor: "#000000",
    ready: false,
    score: 0,
    deck: {
        id: "deck-1",
        name: "Deck",
        format: "freeform",
        maindeck: [],
        sideboard: [],
    },
});

/** A solo Bo1 Match + Game + gameStates row, seated on ONE user's two solo
 *  handles (`${uid}-p1`/`${uid}-p2`) — the Debug panel's own solo-mode shape
 *  the docstring on `debugBo3Sideboard` describes. */
function soloSeeds(uid: string): Row[] {
    const seatA = `${uid}-p1`;
    const seatB = `${uid}-p2`;
    const lib = (owner: string) => [
        makeInstance(MOUNTAIN, {
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        }),
    ];
    const state: GameState = makeState({
        players: [
            makePlayer(seatA, { library: lib(seatA), life: 20 }),
            makePlayer(seatB, { library: lib(seatB), life: 20 }),
        ],
        activePlayerId: seatA,
        priorityPlayerId: seatA,
    });
    return [
        { _id: uid, __table: "users", nickname: "Debug User", isAdmin: false },
        {
            _id: "match-1",
            __table: "matches",
            bestOf: 1,
            status: "playing",
            players: [matchSeat(seatA, "P1"), matchSeat(seatB, "P2")],
            currentGameNumber: 1,
            createdAt: 0,
            updatedAt: 0,
        },
        {
            _id: "game-1",
            __table: "games",
            name: "Game",
            matchId: "match-1",
            status: "playing",
            players: [{ id: seatA }, { id: seatB }],
            createdAt: 0,
            updatedAt: 0,
        },
        {
            _id: "gs-1",
            __table: "gameStates",
            gameId: "game-1",
            seq: 1,
            state,
            updatedAt: 0,
        },
    ];
}

/** A `PlayerInput`-shaped deck (`convex/game.ts`'s exported type) with enough
 *  cards for `buildInitialGameState`'s 7-card opening draw. `debugResetGame`
 *  is the only mutation here that rebuilds decks from the `games` row. */
function playerInput(id: string) {
    return {
        id,
        name: id,
        bgColor: "#000000",
        deck: {
            id: "deck-1",
            name: "Deck",
            format: "freeform",
            cards: Array.from({ length: 10 }, () => ({
                cardId: MOUNTAIN,
                cardName: "Mountain",
            })),
        },
    };
}

/** Same solo-Match shape as `soloSeeds`, but with real decks on the `games`
 *  row's `players[]` so `debugResetGame`'s admin-success case can actually
 *  rebuild the state without crashing on an empty library. `matchId` is
 *  omitted — `debugResetGame`'s Match-reopen branch is conditional on it and
 *  isn't what this gate test is proving. */
function resettableSeeds(uid: string): Row[] {
    const seatA = `${uid}-p1`;
    const seatB = `${uid}-p2`;
    const lib = (owner: string) => [
        makeInstance(MOUNTAIN, {
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        }),
    ];
    const state: GameState = makeState({
        players: [
            makePlayer(seatA, { library: lib(seatA) }),
            makePlayer(seatB, { library: lib(seatB) }),
        ],
        activePlayerId: seatA,
        priorityPlayerId: seatA,
    });
    return [
        { _id: uid, __table: "users", nickname: "Debug User", isAdmin: false },
        {
            _id: "game-1",
            __table: "games",
            name: "Game",
            status: "finished",
            winner: seatA,
            players: [playerInput(seatA), playerInput(seatB)],
            createdAt: 0,
            updatedAt: 0,
        },
        {
            _id: "gs-1",
            __table: "gameStates",
            gameId: "game-1",
            seq: 7,
            state,
            updatedAt: 0,
        },
    ];
}

type Handler<A, R> = { _handler: (ctx: MutationCtx, args: A) => Promise<R> };

const runDebugBo3Sideboard = (ctx: MutationCtx, args: Row) =>
    (debugBo3Sideboard as unknown as Handler<Row, null>)._handler(ctx, args);

describe("debugBo3Sideboard — admin gate (issue #1679)", () => {
    it("refuses an unauthenticated caller, leaving the Game/Match untouched", async () => {
        const stub = makeMutationCtx(null, soloSeeds("alice"));

        await expect(
            runDebugBo3Sideboard(stub.ctx, { gameId: "game-1" as Id<"games"> })
        ).rejects.toThrow(/admin only/i);

        expect(stub.doc("game-1").status).toBe("playing");
        expect(stub.doc("game-1").winner).toBeUndefined();
        expect(stub.doc("match-1").status).toBe("playing");
        expect(stub.doc("match-1").bestOf).toBe(1);
        expect(stub.doc("gs-1").seq).toBe(1);
    });

    it("refuses an authenticated NON-ADMIN caller — any logged-in user could otherwise finish a Match they are not part of", async () => {
        const stub = makeMutationCtx("alice", soloSeeds("alice"));

        await expect(
            runDebugBo3Sideboard(stub.ctx, { gameId: "game-1" as Id<"games"> })
        ).rejects.toThrow(/admin only/i);

        expect(stub.doc("game-1").status).toBe("playing");
        expect(stub.doc("match-1").status).toBe("playing");
        expect(stub.doc("gs-1").seq).toBe(1);
    });

    it("lets an ADMIN caller through — Bo3 sideboarding proceeds unchanged", async () => {
        const seeds = soloSeeds("alice");
        (seeds.find((s) => s._id === "alice") as Row).isAdmin = true;
        const stub = makeMutationCtx("alice", seeds);

        await runDebugBo3Sideboard(stub.ctx, {
            gameId: "game-1" as Id<"games">,
        });

        expect(stub.doc("game-1").status).toBe("finished");
        expect(stub.doc("game-1").winner).toBe("alice-p2");
        expect(stub.doc("match-1").bestOf).toBe(3);
        expect(stub.doc("match-1").status).toBe("sideboarding");
        const state = stub.doc("gs-1").state as GameState;
        expect(state.gameOver?.winnerId).toBe("alice-p2");
        expect(state.gameOver?.loserId).toBe("alice-p1");
    });
});

describe("debugPatchState — admin gate (issue #1679)", () => {
    const patchArgs = (gameId: string) => ({
        gameId: gameId as unknown as Id<"games">,
        path: "players.0.life",
        value: 0,
    });

    it("refuses an unauthenticated caller, leaving the state untouched", async () => {
        const stub = makeMutationCtx(null, soloSeeds("alice"));

        await expect(
            runMutation(debugPatchState, stub.ctx, patchArgs("game-1"))
        ).rejects.toThrow(/admin only/i);

        expect(stub.doc("gs-1").seq).toBe(1);
        const state = stub.doc("gs-1").state as GameState;
        expect(state.players[0].life).toBe(20);
    });

    it("refuses an authenticated NON-ADMIN caller — this is the exact write the review proved exploitable (players.0.life -> 0)", async () => {
        const stub = makeMutationCtx("alice", soloSeeds("alice"));

        await expect(
            runMutation(debugPatchState, stub.ctx, patchArgs("game-1"))
        ).rejects.toThrow(/admin only/i);

        expect(stub.doc("gs-1").seq).toBe(1);
        const state = stub.doc("gs-1").state as GameState;
        expect(state.players[0].life).toBe(20);
    });

    it("lets an ADMIN caller through — the patch applies and the seq bumps", async () => {
        const seeds = soloSeeds("alice");
        (seeds.find((s) => s._id === "alice") as Row).isAdmin = true;
        const stub = makeMutationCtx("alice", seeds);

        await runMutation(debugPatchState, stub.ctx, patchArgs("game-1"));

        expect(stub.doc("gs-1").seq).toBe(2);
        expect(stub.state().players[0].life).toBe(0);
    });
});

describe("debugResetGame — admin gate (issue #1679)", () => {
    const resetArgs = (gameId: string) => ({
        gameId: gameId as unknown as Id<"games">,
    });

    it("refuses an unauthenticated caller, leaving the Game/state untouched", async () => {
        const stub = makeMutationCtx(null, resettableSeeds("alice"));

        await expect(
            runMutation(debugResetGame, stub.ctx, resetArgs("game-1"))
        ).rejects.toThrow(/admin only/i);

        expect(stub.doc("game-1").status).toBe("finished");
        expect(stub.doc("game-1").winner).toBe("alice-p1");
        expect(stub.doc("gs-1").seq).toBe(7);
    });

    it("refuses an authenticated NON-ADMIN caller — this would otherwise let any user wipe another user's Match/standings", async () => {
        const stub = makeMutationCtx("alice", resettableSeeds("alice"));

        await expect(
            runMutation(debugResetGame, stub.ctx, resetArgs("game-1"))
        ).rejects.toThrow(/admin only/i);

        expect(stub.doc("game-1").status).toBe("finished");
        expect(stub.doc("gs-1").seq).toBe(7);
    });

    it("lets an ADMIN caller through — the Game is rebuilt to a fresh MULLIGAN state", async () => {
        const seeds = resettableSeeds("alice");
        (seeds.find((s) => s._id === "alice") as Row).isAdmin = true;
        const stub = makeMutationCtx("alice", seeds);

        await runMutation(debugResetGame, stub.ctx, resetArgs("game-1"));

        expect(stub.doc("game-1").status).toBe("playing");
        expect(stub.doc("game-1").winner).toBeUndefined();
        expect(stub.doc("gs-1").seq).toBe(0);
        const state = stub.state();
        expect(state.phase).toBe("MULLIGAN");
        expect(state.players[0].hand.length).toBe(7);
    });
});
