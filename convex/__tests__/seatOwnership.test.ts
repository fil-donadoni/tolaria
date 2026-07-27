// Seat-ownership binding for the RESULT-WRITING mutations (issue #1645 review).
//
// The bug class: a mutation takes a CLIENT-SUPPLIED seat handle (`playerId`)
// and writes a RESULT from it — concede, forfeit, anything that finishes a Game
// or a Match — while checking only that the caller is somewhere IN that
// game/match (`gameBelongsToUser` / `matchBelongsToUser`), or nothing at all.
// Either seat of a 2-player Match could then name the OPPONENT as the loser.
// Since a round-pairing Match's result lands in the Limited standings (PRD
// #1628), that is a scoring exploit, not merely griefing.
//
// The class was swept across `convex/game.ts`, `convex/matches.ts` and
// `convex/limitedEvents.ts`: exactly two mutations fit it — `concede` (no
// identity check at all) and `forfeitMatch` (doc-level check only). Both are
// bound here; `forfeitMatch`'s standings-level proof lives in
// `limitedPairingMatch.test.ts` alongside the pairing fixture it exploits.
//
// Same harness discipline as `limitedPairingMatch.test.ts`: the project has no
// convex-test harness, so this drives the REGISTERED mutation's own `_handler`
// against an in-memory stub `MutationCtx`.
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { concede } from "../game";
import { assertSeatOwnership, seatBelongsToUser } from "../gameLifecycle";
import type { GameState } from "../gre/state";
import { makePlayer, makeState } from "../cards/__tests__/setup";

type Row = Record<string, unknown>;

interface Stub {
    ctx: MutationCtx;
    doc: (id: string) => Row;
}

/** A stub `MutationCtx` over an in-memory document store, authenticated as
 *  `userId`. Mirrors `limitedPairingMatch.test.ts`'s stub, trimmed to the
 *  `games` / `game_states` reads `concede` performs. */
function makeCtx(userId: string, seeds: Row[]): Stub {
    const docs = new Map<string, Row>();
    for (const seed of seeds) docs.set(seed._id as string, { ...seed });

    const ctx = {
        auth: {
            getUserIdentity: async () => ({ subject: `${userId}|session1` }),
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            insert: async (table: string, doc: Row) => {
                const id = `${table}-1`;
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

/** A live 2-player Game seated on two DIFFERENT users' ids, with a real
 *  `GameState` row so the mutation runs its whole body, not just its guards. */
function twoPlayerSeeds(seatA: string, seatB: string): Row[] {
    const state: GameState = makeState({
        players: [makePlayer(seatA), makePlayer(seatB)],
        activePlayerId: seatA,
        priorityPlayerId: seatA,
    });
    return [
        { _id: "alice", __table: "users", nickname: "Alice" },
        { _id: "bob", __table: "users", nickname: "Bob" },
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
            __table: "game_states",
            gameId: "game-1",
            seq: 1,
            state,
            updatedAt: 0,
        },
    ];
}

type Handler<A, R> = { _handler: (ctx: MutationCtx, args: A) => Promise<R> };

const runConcede = (ctx: MutationCtx, args: Row) =>
    (concede as unknown as Handler<Row, null>)._handler(ctx, args);

// ── The seat-ownership predicate itself ─────────────────────────────────────

describe("seatBelongsToUser — the seat-level authority (issue #1645 review)", () => {
    it("accepts the user's own id and BOTH of their solo seats", () => {
        expect(seatBelongsToUser("alice", "alice")).toBe(true);
        expect(seatBelongsToUser("alice-p1", "alice")).toBe(true);
        expect(seatBelongsToUser("alice-p2", "alice")).toBe(true);
    });

    it("rejects another user's id and another user's solo seats", () => {
        expect(seatBelongsToUser("bob", "alice")).toBe(false);
        expect(seatBelongsToUser("bob-p1", "alice")).toBe(false);
        expect(seatBelongsToUser("bob-p2", "alice")).toBe(false);
    });

    it("does not let a longer id be claimed by its prefix", () => {
        // Convex ids contain no `-`, so `alicex` can never be `alice`'s seat.
        expect(seatBelongsToUser("alicex", "alice")).toBe(false);
        expect(seatBelongsToUser("alice", "alicex")).toBe(false);
    });

    it("assertSeatOwnership throws for a foreign seat and is silent for an owned one", () => {
        expect(() => assertSeatOwnership("bob", "alice")).toThrow(
            /cannot act as another player/i
        );
        expect(() => assertSeatOwnership("alice-p2", "alice")).not.toThrow();
    });
});

// ── concede (convex/game.ts) ────────────────────────────────────────────────

describe("concede — the caller must own the seat they name (issue #1645 review)", () => {
    it("refuses to concede AS the opponent, leaving the Game untouched", async () => {
        const stub = makeCtx("bob", twoPlayerSeeds("alice", "bob"));

        await expect(
            runConcede(stub.ctx, {
                gameId: "game-1" as Id<"games">,
                playerId: "alice",
            })
        ).rejects.toThrow(/cannot act as another player/i);

        expect(stub.doc("game-1").status).toBe("playing");
        expect(stub.doc("game-1").winner).toBeUndefined();
    });

    it("refuses a seat in a Game the caller is not part of at all", async () => {
        const stub = makeCtx("carol", [
            ...twoPlayerSeeds("alice", "bob"),
            { _id: "carol", __table: "users", nickname: "Carol" },
        ]);

        await expect(
            runConcede(stub.ctx, {
                gameId: "game-1" as Id<"games">,
                playerId: "bob",
            })
        ).rejects.toThrow(/cannot act as another player/i);

        expect(stub.doc("game-1").status).toBe("playing");
    });

    it("still lets a player concede their OWN seat", async () => {
        const stub = makeCtx("alice", twoPlayerSeeds("alice", "bob"));

        await runConcede(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "alice",
        });

        expect(stub.doc("game-1").status).toBe("finished");
        expect(stub.doc("game-1").winner).toBe("bob");
    });

    it("still lets a SOLO player concede either of their own two seats", async () => {
        // One user legitimately drives both seats (CLAUDE.md § Player identity
        // in games), so `-p2` must stay conceded-able by its own owner.
        const stub = makeCtx("alice", twoPlayerSeeds("alice-p1", "alice-p2"));

        await runConcede(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "alice-p2",
        });

        expect(stub.doc("game-1").status).toBe("finished");
        expect(stub.doc("game-1").winner).toBe("alice-p1");
    });
});
