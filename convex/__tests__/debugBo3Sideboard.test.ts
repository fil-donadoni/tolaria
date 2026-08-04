// debugBo3Sideboard admin gate (issue #1679). The mutation
// (`convex/game.ts`) force-finishes a Game/Match selected purely from a
// client-supplied `gameId`, with no `playerId`/seat argument for
// `assertSeatOwnership` (#1645) to bind — so any authenticated caller could
// finish a Match they are not part of. `assertIsAdmin(ctx)` now runs FIRST,
// before any Match/Game/gameStates row is touched (same CLAUDE.md
// privileged-mutation convention as `debugSetupScenario`, issue #768).
//
// Same harness discipline as `seatOwnership.test.ts` / `limitedPairingMatch.test.ts`:
// the project has no convex-test harness, so this drives the REGISTERED
// mutation's own `_handler` against an in-memory stub `MutationCtx` — not
// just the pure `isAdminUser` predicate — so the assertion is "the handler
// rejects and touches nothing", not merely "the predicate returns false".
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { debugBo3Sideboard } from "../game";
import type { GameState } from "../gre/state";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

type Row = Record<string, unknown>;

interface Stub {
    ctx: MutationCtx;
    doc: (id: string) => Row;
}

/** A stub `MutationCtx` over an in-memory document store, authenticated as
 *  `userId` (or unauthenticated when `userId` is `null`). Mirrors
 *  `seatOwnership.test.ts`'s stub. */
function makeCtx(userId: string | null, seeds: Row[]): Stub {
    const docs = new Map<string, Row>();
    for (const seed of seeds) docs.set(seed._id as string, { ...seed });

    const ctx = {
        auth: {
            getUserIdentity: async () =>
                userId === null ? null : { subject: `${userId}|session1` },
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            insert: async (table: string, doc: Row) => {
                const id = `${table}-${docs.size + 1}`;
                docs.set(id, { ...doc, _id: id, __table: table });
                return id;
            },
            patch: async (id: string, patch: Row) => {
                docs.set(id, { ...docs.get(id), ...patch });
            },
            query: (table: string) => ({
                withIndex: (_name: string, fn?: (q: unknown) => unknown) => {
                    const eqs: [string, unknown][] = [];
                    const builder = {
                        eq: (field: string, value: unknown) => {
                            eqs.push([field, value]);
                            return builder;
                        },
                    };
                    fn?.(builder);
                    const rows = [...docs.values()].filter(
                        (d) =>
                            d.__table === table &&
                            eqs.every(([f, v]) => d[f] === v)
                    );
                    const ordered = { first: async () => rows[0] ?? null };
                    return {
                        collect: async () => rows,
                        first: async () => rows[0] ?? null,
                        order: () => ordered,
                    };
                },
            }),
        },
        scheduler: { runAfter: async () => undefined },
    };

    return { ctx: ctx as unknown as MutationCtx, doc: (id) => docs.get(id)! };
}

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
            makePlayer(seatA, { library: lib(seatA) }),
            makePlayer(seatB, { library: lib(seatB) }),
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

type Handler<A, R> = { _handler: (ctx: MutationCtx, args: A) => Promise<R> };

const runDebugBo3Sideboard = (ctx: MutationCtx, args: Row) =>
    (debugBo3Sideboard as unknown as Handler<Row, null>)._handler(ctx, args);

describe("debugBo3Sideboard — admin gate (issue #1679)", () => {
    it("refuses an unauthenticated caller, leaving the Game/Match untouched", async () => {
        const stub = makeCtx(null, soloSeeds("alice"));

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
        const stub = makeCtx("alice", soloSeeds("alice"));

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
        const stub = makeCtx("alice", seeds);

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
