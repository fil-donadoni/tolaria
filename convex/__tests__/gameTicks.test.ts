// Tick row companion to `gameStates` (PRD #1776 T3, issue #1778).
//
// `saveGameState` (private, `convex/game.ts`) is the single persistence seam
// every stable point flows through; it now also writes a `gameTicks` row
// alongside `gameStates` — a ~150-byte wake-up signal a subscriber (the
// vs-AI driver) can hold instead of a second full `getPublicState`
// subscription. This test drives it through a real exported mutation
// (`mill`) and the `getGameTick` query, same stub-`MutationCtx` harness
// discipline as `seatOwnership.test.ts` (issue #1645 review): this repo has
// no convex-test harness, so integration tests run the registered
// function's own `_handler` against an in-memory document store.
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { mill, getGameTick } from "../game";
import type { GameState } from "../gre/state";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

type Row = Record<string, unknown>;

interface Stub {
    ctx: MutationCtx;
    doc: (id: string) => Row;
    table: (name: string) => Row[];
}

/** Same in-memory stub `MutationCtx` as `seatOwnership.test.ts` — no
 *  convex-test harness in this repo. Generic over table name, so it needs no
 *  changes to support the new `gameTicks` table. */
function makeCtx(userId: string, seeds: Row[]): Stub {
    const docs = new Map<string, Row>();
    for (const seed of seeds) docs.set(seed._id as string, { ...seed });
    let nextIdBySeq = 0;

    const ctx = {
        auth: {
            getUserIdentity: async () => ({ subject: `${userId}|session1` }),
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            insert: async (table: string, doc: Row) => {
                const id = `${table}-new-${nextIdBySeq++}`;
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

    return {
        ctx: ctx as unknown as MutationCtx,
        doc: (id) => docs.get(id)!,
        table: (name) => [...docs.values()].filter((d) => d.__table === name),
    };
}

// LEA Mountain — any real definition works; `mill` only moves it.
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

/** Two seats, each with a 2-card library so `mill` can run twice per seat —
 *  used to prove the tick row is PATCHED IN PLACE (one row per game) across
 *  repeated saves, not accumulated. */
function twoPlayerSeeds(seatA: string, seatB: string): Row[] {
    const lib = (owner: string) =>
        Array.from({ length: 2 }, () =>
            makeInstance(MOUNTAIN, {
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    const state: GameState = makeState({
        players: [
            makePlayer(seatA, { library: lib(seatA) }),
            makePlayer(seatB, { library: lib(seatB) }),
        ],
        activePlayerId: seatA,
        priorityPlayerId: seatA,
    });
    return [
        {
            _id: "game-1",
            __table: "games",
            name: "Game",
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

type MutationHandler<A, R> = {
    _handler: (ctx: MutationCtx, args: A) => Promise<R>;
};
type QueryHandler<A, R> = { _handler: (ctx: QueryCtx, args: A) => Promise<R> };

const runMill = (ctx: MutationCtx, args: Row) =>
    (mill as unknown as MutationHandler<Row, null>)._handler(ctx, args);
const runGetGameTick = (ctx: QueryCtx, args: Row) =>
    (getGameTick as unknown as QueryHandler<Row, Row | null>)._handler(
        ctx,
        args
    );

describe("gameTicks — the cheap wake-up signal companion to gameStates (issue #1778)", () => {
    it("writes a gameTicks row alongside the gameStates row, with a matching seq", async () => {
        const stub = makeCtx("alice", twoPlayerSeeds("alice", "bob"));

        await runMill(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "alice",
        });

        const gs = stub.doc("gs-1");
        expect(gs.seq).toBe(2);

        const ticks = stub.table("gameTicks");
        expect(ticks).toHaveLength(1);
        const tick = ticks[0];
        expect(tick.gameId).toBe("game-1");
        // Atomic with the gameStates write: same seq.
        expect(tick.seq).toBe(gs.seq);
        expect(tick.phase).toBe("PRECOMBAT_MAIN");
        expect(tick.priorityPlayerId).toBe("alice");
        // ADR 0047 — no pending choice/target/blockers on this fixture, so
        // the default Expected Input is priority, owed by the seat that
        // still holds it.
        expect(tick.expectedInputKind).toBe("priority");
        expect(tick.expectedInputPlayerId).toBe("alice");
        expect(tick.gameOver).toBe(false);
    });

    it("patches the SAME row in place across repeated saves (one row per game)", async () => {
        const stub = makeCtx("alice", twoPlayerSeeds("alice", "bob"));

        await runMill(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "alice",
        });
        await runMill(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "alice",
        });

        const ticks = stub.table("gameTicks");
        expect(ticks).toHaveLength(1);
        expect(ticks[0].seq).toBe(stub.doc("gs-1").seq);
        expect(ticks[0].seq).toBe(3);
    });

    it("getGameTick returns the persisted row for the driver's cheap subscription", async () => {
        const stub = makeCtx("alice", twoPlayerSeeds("alice", "bob"));
        await runMill(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "alice",
        });

        const tick = await runGetGameTick(stub.ctx as unknown as QueryCtx, {
            gameId: "game-1" as Id<"games">,
        });

        expect(tick).not.toBeNull();
        expect(tick!.seq).toBe(2);
        expect(tick!.expectedInputPlayerId).toBe("alice");
    });

    it("getGameTick returns null before any save", async () => {
        const stub = makeCtx("alice", [
            {
                _id: "game-2",
                __table: "games",
                name: "Game",
                status: "playing",
                players: [{ id: "alice" }, { id: "bob" }],
                createdAt: 0,
                updatedAt: 0,
            },
        ]);

        const tick = await runGetGameTick(stub.ctx as unknown as QueryCtx, {
            gameId: "game-2" as Id<"games">,
        });

        expect(tick).toBeNull();
    });
});
