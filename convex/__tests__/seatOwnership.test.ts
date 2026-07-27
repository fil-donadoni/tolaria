// Seat-ownership binding for the SEAT-ADDRESSED mutations (issue #1645 review).
//
// The bug class: a mutation takes a CLIENT-SUPPLIED seat handle (`playerId`)
// and acts AS that seat, while checking only that the caller is somewhere IN
// that game/match (`gameBelongsToUser` / `matchBelongsToUser`), or nothing at
// all. Either seat of a 2-player Match could then name the OPPONENT. Since a
// round-pairing Match's result lands in the Limited standings (PRD #1628),
// that is a scoring exploit, not merely griefing.
//
// The criterion is "can a caller act AS another seat?" — NOT "does this
// mutation itself finish the game?". The narrow reading is what first left
// `mill` / `drawCard` / `exileFromLibrary` open: they finish nothing alone,
// but milling the opponent's library dry and then drawing them out routes
// through `checkStateBasedActions` -> `finalizeGameOver` ->
// `recordLimitedPairingResult` all the same. The SBA sweep is the DELIVERY
// MECHANISM, not a safety net. So EVERY seat-addressed gameplay mutation in
// `convex/game.ts` now opens with `assertCallerOwnsSeat`.
//
// TWO DISTINCT GATES, at different levels — never conflate them:
//   * `assertSeatOwnership` / `assertCallerOwnsSeat` — "does the caller own
//     this handle". Correct for ordinary gameplay. A vs-AI human owns their
//     bot's `-p2` handle, so the client-side Brain keeps playing it.
//   * `assertNotEventBotSeat` (matches.ts) — "is this the bot's seat of an
//     EVENT-BOUND Match". Strictly higher, and applied ONLY to the two
//     resignation paths (`forfeitMatch`, `concede`), because applying it to
//     gameplay would make the bot unable to move.
// `forfeitMatch`'s standings-level proof lives in
// `limitedPairingMatch.test.ts` alongside the pairing fixture it exploits.
//
// Same harness discipline as `limitedPairingMatch.test.ts`: the project has no
// convex-test harness, so this drives the REGISTERED mutation's own `_handler`
// against an in-memory stub `MutationCtx`.
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { concede, mill } from "../game";
import { assertSeatOwnership, seatBelongsToUser } from "../gameLifecycle";
import type { GameState } from "../gre/state";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

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
 *  `GameState` row so the mutation runs its whole body, not just its guards.
 *  `gameFields` bolts on the event/vs-AI binding (`limitedPairing`, `vsAi`)
 *  that `startPairingMatch` mirrors onto the `games` row. Each seat gets a
 *  one-card library so the zone mutations have something to move. */
function twoPlayerSeeds(
    seatA: string,
    seatB: string,
    gameFields: Row = {}
): Row[] {
    // LEA Mountain — any real definition works; the zone mutations only move it.
    const lib = (owner: string) => [
        makeInstance("eace2c85-976c-425e-9800-5a6ccbd91b56", {
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
            ...gameFields,
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

/** The event binding `startPairingMatch`'s bot branch writes onto the `games`
 *  row: a vs-AI Match bound to round 1 of a Limited event, whose result lands
 *  in the standings (PRD #1628). */
const EVENT_PAIRING: Row = {
    vsAi: true,
    solo: true,
    limitedEventId: "event-1",
    limitedPairing: { round: 1, seatA: 0, seatB: 1 },
};

type Handler<A, R> = { _handler: (ctx: MutationCtx, args: A) => Promise<R> };

const runConcede = (ctx: MutationCtx, args: Row) =>
    (concede as unknown as Handler<Row, null>)._handler(ctx, args);
const runMill = (ctx: MutationCtx, args: Row) =>
    (mill as unknown as Handler<Row, null>)._handler(ctx, args);

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

    it("still lets a CASUAL solo player concede either of their own two seats", async () => {
        // One user legitimately drives both seats (CLAUDE.md § Player identity
        // in games), so in a game bound to NO event — nothing to score, no
        // standings row — `-p2` must stay conceded-able by its own owner.
        const seeds = twoPlayerSeeds("alice-p1", "alice-p2");
        const stub = makeCtx("alice", seeds);
        expect(stub.doc("game-1").limitedPairing).toBeUndefined();

        await runConcede(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "alice-p2",
        });

        expect(stub.doc("game-1").status).toBe("finished");
        expect(stub.doc("game-1").winner).toBe("alice-p1");
    });
});

// ── The event-bound bot seat: a SECOND, higher gate ─────────────────────────
//
// `assertSeatOwnership` is the wrong tool against the solo-bot pairing, and
// deliberately so: in a vs-AI Match the human owns BOTH handles, so it passes
// for `${uid}-p2` — which is exactly what keeps the client-side Brain able to
// play the bot's seat. The exploit it therefore cannot see: `startPairingMatch`
// seats a Bot Drafter opponent as `${uid}-p2` and carries `limitedPairing`
// onto BOTH the Match and the Game rows, so conceding/forfeiting that seat
// writes a `source: "played"` 2-0 into the Limited standings with no game
// played. `assertNotEventBotSeat` closes that on the two RESIGNATION paths
// only — never on ordinary gameplay, which the last test here pins down.
describe("event-bound vs-AI pairing — the bot's seat cannot be resigned (issue #1645 review)", () => {
    it("refuses to concede the BOT's seat when the Game is bound to a round pairing", async () => {
        const stub = makeCtx(
            "alice",
            twoPlayerSeeds("alice-p1", "alice-p2", EVENT_PAIRING)
        );

        await expect(
            runConcede(stub.ctx, {
                gameId: "game-1" as Id<"games">,
                playerId: "alice-p2",
            })
        ).rejects.toThrow(/cannot resign your bot opponent/i);

        expect(stub.doc("game-1").status).toBe("playing");
        expect(stub.doc("game-1").winner).toBeUndefined();
    });

    it("still lets the HUMAN concede their own seat in that same pairing", async () => {
        // The gate is aimed at the bot's handle only — a real resignation by
        // the human must still end the Game and score the pairing normally.
        const stub = makeCtx(
            "alice",
            twoPlayerSeeds("alice-p1", "alice-p2", EVENT_PAIRING)
        );

        await runConcede(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "alice-p1",
        });

        expect(stub.doc("game-1").status).toBe("finished");
        expect(stub.doc("game-1").winner).toBe("alice-p2");
    });

    it("LETS THE BRAIN DRIVE the bot seat's ordinary moves in that same pairing", async () => {
        // The constraint the fix must not violate: the vs-AI Brain plays
        // `${uid}-p2` through the ordinary gameplay mutations. Those carry
        // `assertCallerOwnsSeat` (which the human passes for their own `-p2`)
        // and must NOT carry the bot-seat gate — otherwise the bot cannot
        // move and the event pairing is unplayable.
        const stub = makeCtx(
            "alice",
            twoPlayerSeeds("alice-p1", "alice-p2", EVENT_PAIRING)
        );

        await runMill(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "alice-p2",
        });

        const state = stub.doc("gs-1").state as GameState;
        const bot = state.players.find((p) => p.id === "alice-p2")!;
        expect(bot.library).toHaveLength(0);
        expect(bot.graveyard).toHaveLength(1);
    });
});

// ── The zone mutations (issue #1645 review, finding 4) ──────────────────────
//
// `mill` / `drawCard` / `exileFromLibrary` finish no game by themselves, which
// is why they were originally judged safe. The judgement used the wrong
// criterion. `mill({ playerId: opponent })` xN empties the opponent's library
// and the following `drawCard({ playerId: opponent })` sets `hasDrawnFromEmpty`
// -> `checkStateBasedActions` -> `finalizeGameOver` ->
// `recordLimitedPairingResult`. The SBA sweep is the delivery mechanism, not a
// safety net. The criterion is "can a caller act AS another seat?".
describe("mill — a seat-addressed mutation the caller must own (issue #1645 review)", () => {
    it("refuses to mill the OPPONENT's library, leaving both libraries intact", async () => {
        const stub = makeCtx("bob", twoPlayerSeeds("alice", "bob"));

        await expect(
            runMill(stub.ctx, {
                gameId: "game-1" as Id<"games">,
                playerId: "alice",
            })
        ).rejects.toThrow(/cannot act as another player/i);

        // `saveGameState` patches the live `game_states` row — it is untouched,
        // so neither library moved a card.
        const state = stub.doc("gs-1").state as GameState;
        expect(stub.doc("gs-1").seq).toBe(1);
        for (const p of state.players) expect(p.library).toHaveLength(1);
    });

    it("still lets a player mill their OWN library", async () => {
        const stub = makeCtx("bob", twoPlayerSeeds("alice", "bob"));

        await runMill(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "bob",
        });

        const state = stub.doc("gs-1").state as GameState;
        const self = state.players.find((p) => p.id === "bob")!;
        expect(self.library).toHaveLength(0);
        expect(self.graveyard).toHaveLength(1);
    });
});
