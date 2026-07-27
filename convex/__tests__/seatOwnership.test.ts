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
import { cancelAutoPass, concede, continueMatch, mill } from "../game";
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
 *  `games` / `gameStates` reads `concede` performs. */
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
            __table: "gameStates",
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

/** LEA Mountain — a real definition, so `buildInitialGameState` can build a
 *  library out of it when the Bo3 next-Game builder runs for real. */
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

/** A Match seat as the `matches` schema stores it (deck split maindeck /
 *  sideboard), sized so `buildInitialGameState` can deal an opening hand. */
const matchSeat = (id: string, name: string) => ({
    id,
    name,
    bgColor: "#000000",
    ready: false,
    gamesWon: 0,
    deck: {
        id: "deck-1",
        name: "Deck",
        format: "freeform",
        maindeck: Array.from({ length: 10 }, () => ({
            cardId: MOUNTAIN,
            cardName: "Mountain",
        })),
        sideboard: [],
    },
});

/** The event-bound vs-AI pairing MATCH — the authority the `games` rows only
 *  mirror. `status: "sideboarding"` is the state `continueMatch` consumes to
 *  build Game 2 (PRD #387). */
const eventPairingMatch = (status: string): Row => ({
    _id: "match-1",
    __table: "matches",
    bestOf: 3,
    status,
    players: [
        matchSeat("alice-p1", "Alice (P1)"),
        matchSeat("alice-p2", "Bot"),
    ],
    currentGameNumber: 1,
    createdAt: 0,
    updatedAt: 0,
    ...EVENT_PAIRING,
});

type Handler<A, R> = { _handler: (ctx: MutationCtx, args: A) => Promise<R> };

const runConcede = (ctx: MutationCtx, args: Row) =>
    (concede as unknown as Handler<Row, null>)._handler(ctx, args);
const runMill = (ctx: MutationCtx, args: Row) =>
    (mill as unknown as Handler<Row, null>)._handler(ctx, args);
const runCancelAutoPass = (ctx: MutationCtx, args: Row) =>
    (cancelAutoPass as unknown as Handler<Row, null>)._handler(ctx, args);
const runContinueMatch = (ctx: MutationCtx, args: Row) =>
    (continueMatch as unknown as Handler<Row, { gameId: string }>)._handler(
        ctx,
        args
    );

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

// ── Game 2+ of a Bo3 pairing (issue #1645 review, round 3) ──────────────────
//
// The gate above was keyed off the `games` row, which the schema declares a
// MIRROR of the owning Match's `limitedPairing`. `buildNextGameForMatch` did
// not copy it, so from Game 2 on the mirror said "unbound" and the gate
// silently no-oped — while `recordLimitedPairingResult`, which reads the
// MATCH, still wrote the standings row. Net effect on a `matchFormat: "bo3"`
// pairing: concede your own seat in G1, then the BOT's in G2 and G3, and the
// event records a `source: "played"` 2-1 with zero games actually played.
//
// Two independent fixes, one per test below:
//   1. `concede` resolves the binding from the MATCH (the authority), so the
//      gate holds even when the mirror lies.
//   2. `buildNextGameForMatch` carries `limitedEventId` / `limitedPairing`
//      onto every later Game, so the mirror stops lying.
describe("Bo3 Game 2+ — the bot-seat gate survives the next Game (issue #1645 review)", () => {
    /** A Game 2 row in its PRE-FIX shape: bound to the Match by `matchId`, but
     *  carrying no `limitedPairing` mirror of its own. The gate must still
     *  fire — it reads the Match, not this row. */
    const gameTwoSeeds = (): Row[] => [
        ...twoPlayerSeeds("alice-p1", "alice-p2", {
            matchId: "match-1",
            gameNumber: 2,
            vsAi: true,
            solo: true,
        }),
        eventPairingMatch("playing"),
    ];

    it("refuses to concede the BOT's seat in Game 2 even when the games row lost the pairing mirror", async () => {
        const stub = makeCtx("alice", gameTwoSeeds());
        // The precondition that made this exploitable: the Game row itself
        // carries no binding at all — only the Match does.
        expect(stub.doc("game-1").limitedPairing).toBeUndefined();
        expect(stub.doc("match-1").limitedPairing).toBeDefined();

        await expect(
            runConcede(stub.ctx, {
                gameId: "game-1" as Id<"games">,
                playerId: "alice-p2",
            })
        ).rejects.toThrow(/cannot resign your bot opponent/i);

        expect(stub.doc("game-1").status).toBe("playing");
        expect(stub.doc("game-1").winner).toBeUndefined();
    });

    it("still lets the HUMAN concede their own seat in that same Game 2", async () => {
        const stub = makeCtx("alice", gameTwoSeeds());

        await runConcede(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "alice-p1",
        });

        expect(stub.doc("game-1").status).toBe("finished");
        expect(stub.doc("game-1").winner).toBe("alice-p2");
    });

    it("carries the event binding onto the next Game — the mirror stops lying", async () => {
        // Drives the REAL next-Game builder (`buildNextGameForMatch`, via
        // `continueMatch`) rather than hand-writing the row, so the assertion
        // is on what the production writer actually persists.
        const stub = makeCtx("alice", [
            { _id: "alice", __table: "users", nickname: "Alice" },
            eventPairingMatch("sideboarding"),
        ]);

        const { gameId } = await runContinueMatch(stub.ctx, {
            matchId: "match-1" as Id<"matches">,
            choice: "play",
        });

        const gameTwo = stub.doc(gameId);
        expect(gameTwo.gameNumber).toBe(2);
        expect(gameTwo.limitedEventId).toBe("event-1");
        expect(gameTwo.limitedPairing).toEqual({
            round: 1,
            seatA: 0,
            seatB: 1,
        });
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

        // `saveGameState` patches the live `gameStates` row — it is untouched,
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

// ── cancelAutoPass (issue #1645 review, round 3) ────────────────────────────
//
// The one seat-addressed gameplay mutation the first sweep missed. It writes
// no result — so it is griefing, not a scoring exploit — but it is the same
// act-as-another-seat class: clearing the OPPONENT's `autoPassPlayers` /
// `singleShotAutoPass` / `queuedEndTurn` and bumping `seq` from their seat.
// The gate binds the CALLER; the mutation's clear-only semantics (priority is
// never reclaimed from the opponent) are unchanged.
describe("cancelAutoPass — a seat-addressed mutation the caller must own (issue #1645 review)", () => {
    /** Both seats auto-passing, so a leaked cancel is visible on either. */
    const autoPassSeeds = (seatA: string, seatB: string): Row[] => {
        const seeds = twoPlayerSeeds(seatA, seatB);
        const gs = seeds.find((s) => s._id === "gs-1")!;
        (gs.state as GameState).autoPassPlayers = [seatA, seatB];
        return seeds;
    };

    it("refuses to clear the OPPONENT's auto-pass, leaving the state untouched", async () => {
        const stub = makeCtx("bob", autoPassSeeds("alice", "bob"));

        await expect(
            runCancelAutoPass(stub.ctx, {
                gameId: "game-1" as Id<"games">,
                playerId: "alice",
            })
        ).rejects.toThrow(/cannot act as another player/i);

        const state = stub.doc("gs-1").state as GameState;
        expect(state.autoPassPlayers).toEqual(["alice", "bob"]);
        expect(stub.doc("gs-1").seq).toBe(1);
    });

    it("still clears the caller's OWN auto-pass without touching priority", async () => {
        const stub = makeCtx("bob", autoPassSeeds("alice", "bob"));

        await runCancelAutoPass(stub.ctx, {
            gameId: "game-1" as Id<"games">,
            playerId: "bob",
        });

        const state = stub.doc("gs-1").state as GameState;
        expect(state.autoPassPlayers).toEqual(["alice"]);
        // Clear-only: priority stays where it was, never reclaimed.
        expect(state.priorityPlayerId).toBe("alice");
    });
});
