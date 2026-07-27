// End-to-end Limited round-pairing Match integration test (PRD #1628, ADR
// 0076, issue #1645): "event with decks → pairing → Match finished through the
// real game-over path → standings row".
//
// The project has no convex-test harness (see `convex/__tests__/adminAuth.test.ts`),
// so — exactly like `limitedPlayPhaseOpen.test.ts` — this drives the REGISTERED
// mutations' own handlers (`_handler`, the function Convex deploys) against an
// in-memory stub `MutationCtx`, and asserts the DOCUMENTS they leave behind.
// The event fixture is a REAL LEA Sealed table generated off the checked-in
// Booster Config, and every deck is built from its own seat's Pool, so the
// authoritative legality gate (`assertDeckLegal` + `loadLimitedPoolResolver`)
// runs for real rather than being stubbed away.
//
// The two ways a Match finishes are BOTH driven here — `finalizeGameOver` (the
// SBA/concede path) and the `forfeitMatch` mutation — because a result that
// lands on only one of them is the exact bug this ticket exists to prevent.
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
    finalizeGameOver,
    forfeitMatch,
    joinGame,
    startPairingMatch,
} from "../game";
import type { GameState } from "../gre/state";
import { resolveDeckCardMeta, tryGetDefinition } from "../cards";
import { makeRng } from "../gre/rng";
import {
    assignFreeSeat,
    buildEmptySeats,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../limited/eventLogic";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "../limited/eventProjection";
import { getBoosterConfig } from "../limited/registry";

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

type Row = Record<string, unknown>;

// ── The in-memory stub ctx ───────────────────────────────────────────────────

interface Stub {
    ctx: MutationCtx;
    doc: (id: string) => Row;
    rows: (table: string) => Row[];
}

/** A stub `MutationCtx` over an in-memory document store. `withIndex` applies
 *  the index's `eq(...)` bounds as a plain filter — enough to make
 *  `findActiveMatchForUser`'s `by_status` scan behave (an unfiltered version
 *  would make every FINISHED match look active and break the #155 guard the
 *  tests below assert on). */
function makeCtx(userId: string, seeds: Row[]): Stub {
    const docs = new Map<string, Row>();
    for (const seed of seeds) docs.set(seed._id as string, { ...seed });
    let counter = 0;

    const tableRows = (table: string) =>
        [...docs.values()].filter((d) => d.__table === table);

    const ctx = {
        auth: {
            getUserIdentity: async () => ({ subject: `${userId}|session1` }),
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            insert: async (table: string, doc: Row) => {
                const id = `${table}-${++counter}`;
                docs.set(id, { ...doc, _id: id, __table: table });
                return id;
            },
            patch: async (id: string, patch: Row) => {
                docs.set(id, { ...docs.get(id), ...patch });
            },
            delete: async (id: string) => {
                docs.delete(id);
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
                    const rows = tableRows(table).filter((d) =>
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
        doc: (id: string) => docs.get(id)!,
        rows: tableRows,
    };
}

/** The SAME document store seen through a different authenticated identity —
 *  how the paired opponent acts on the Match the first seat created. */
function asUser(stub: Stub, userId: string): MutationCtx {
    return {
        ...stub.ctx,
        auth: {
            getUserIdentity: async () => ({ subject: `${userId}|session1` }),
        },
    } as unknown as MutationCtx;
}

// ── The fixture: a real LEA Sealed table already in the play phase ───────────

interface DeckPayload {
    id: string;
    name: string;
    format: string;
    cards: { cardId: string; cardName: string }[];
    sideboard: { cardId: string; cardName: string }[];
    limitedEventId: string;
    limitedSeatId: string;
}

interface Fixture {
    event: Row;
    deckForSeat: (seatIndex: number) => DeckPayload;
    seeds: Row[];
}

/** A 2-seat LEA Sealed event in `playing`, round 1 paired seat 0 vs seat 1.
 *  `botSeat` fills seat 1 with a Bot Drafter instead of a second human. */
function playingEvent(opts: {
    eventId: string;
    seed: number;
    matchFormat: "bo1" | "bo3";
    botSeat?: boolean;
}): Fixture {
    let seats = assignFreeSeat(buildEmptySeats(2), "alice", "Alice");
    seats = opts.botSeat
        ? fillBotSeats(seats)
        : assignFreeSeat(seats, "bob", "Bob");
    seats = generateSealedPools(
        seats,
        ["lea"],
        6,
        getBoosterConfig,
        resolveCardMeta,
        makeRng(opts.seed)
    );

    const event: Row = {
        _id: opts.eventId,
        __table: "limitedEvents",
        createdBy: "alice",
        type: "sealed",
        status: "playing",
        seatCount: 2,
        packSlots: ["lea"],
        sealedBoosterCount: 6,
        matchFormat: opts.matchFormat,
        currentRound: 1,
        rounds: [
            {
                roundNumber: 1,
                startedAt: 0,
                pairings: [{ seatA: 0, seatB: 1 }],
            },
        ],
        seats,
        createdAt: 0,
        updatedAt: 0,
    };

    const deckForSeat = (seatIndex: number): DeckPayload => {
        const seat = seats.find((s) => s.seatIndex === seatIndex)!;
        const nonBasic = seat.pool!.filter(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic !== true
        );
        const basic = seat.pool!.find(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic === true
        )!;
        const main = nonBasic.slice(0, 30);
        return {
            id: `deck-${seatIndex}`,
            name: `Seat ${seatIndex} Deck`,
            format: "limited",
            cards: [
                ...main.map((c) => ({
                    cardId: c.cardId,
                    cardName: c.cardName,
                })),
                ...Array.from(
                    { length: Math.max(0, 40 - main.length) },
                    () => ({
                        cardId: basic.cardId,
                        cardName: basic.cardName,
                    })
                ),
            ],
            sideboard: nonBasic
                .slice(30)
                .map((c) => ({ cardId: c.cardId, cardName: c.cardName })),
            limitedEventId: opts.eventId,
            limitedSeatId: String(seatIndex),
        };
    };

    const seeds: Row[] = [
        event,
        { _id: "alice", __table: "users", nickname: "Alice" },
        { _id: "bob", __table: "users", nickname: "Bob" },
    ];
    return { event, deckForSeat, seeds };
}

// ── Registered-handler shims ────────────────────────────────────────────────

type Handler<A, R> = { _handler: (ctx: MutationCtx, args: A) => Promise<R> };

const runStart = (ctx: MutationCtx, args: Row) =>
    (startPairingMatch as unknown as Handler<Row, Id<"games">>)._handler(
        ctx,
        args
    );
const runJoin = (ctx: MutationCtx, args: Row) =>
    (joinGame as unknown as Handler<Row, null>)._handler(ctx, args);
const runForfeit = (ctx: MutationCtx, args: Row) =>
    (forfeitMatch as unknown as Handler<Row, null>)._handler(ctx, args);

/** One Game of the pairing Match ending with `winnerId` through the REAL
 *  finisher every SBA-detected game over and every concede routes through. */
const finishGame = (ctx: MutationCtx, gameId: string, winnerId: string) =>
    finalizeGameOver(ctx, gameId as Id<"games">, 1, {
        gameOver: { winnerId, loserId: "x", reason: "concede" },
    } as unknown as GameState);

function pairingOf(stub: Stub, eventId: string) {
    const rounds = stub.doc(eventId).rounds as {
        pairings: {
            seatA: number;
            seatB?: number;
            matchId?: string;
            result?: { winsA: number; winsB: number; source: string };
        }[];
    }[];
    return rounds[0].pairings[0];
}

function standingsOf(stub: Stub, eventId: string, viewer: string) {
    return projectLimitedEvent(
        stub.doc(eventId) as unknown as LimitedEventRow,
        viewer
    ).standings;
}

// ── The tests ───────────────────────────────────────────────────────────────

describe("startPairingMatch — human pairing (PRD #1628 stories 8/10, issue #1645)", () => {
    it("creates a Match ADDRESSED to the paired opponent, bound to the pairing", async () => {
        const fx = playingEvent({
            eventId: "event-h",
            seed: 555,
            matchFormat: "bo1",
        });
        const stub = makeCtx("alice", fx.seeds);

        const gameId = await runStart(stub.ctx, {
            eventId: "event-h",
            deck: fx.deckForSeat(0),
        });

        const game = stub.doc(gameId);
        const match = stub.doc(game.matchId as string);
        expect(match.status).toBe("waiting");
        expect(match.bestOf).toBe(1);
        expect(match.limitedEventId).toBe("event-h");
        expect(match.limitedPairing).toEqual({ round: 1, seatA: 0, seatB: 1 });
        // Reuses the existing challenge binding — the opponent accepts it with
        // the unchanged `joinGame` path, and the event projection already
        // surfaces it to them.
        expect(match.limitedChallenge).toEqual({
            challengerSeatIndex: 0,
            challengedUserId: "bob",
            challengedSeatIndex: 1,
        });
        // …and the pairing now points back at the Match (ADR 0076 decision 2).
        expect(pairingOf(stub, "event-h").matchId).toBe(match._id);
    });

    it("uses the EVENT's Bo3 Match Format, so the Match sideboards between games", async () => {
        const fx = playingEvent({
            eventId: "event-h3",
            seed: 556,
            matchFormat: "bo3",
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-h3",
            deck: fx.deckForSeat(0),
        });
        const match = stub.doc(stub.doc(gameId).matchId as string);
        expect(match.bestOf).toBe(3);
        // The pool remainder rides along as the Match sideboard — what the
        // between-games flow re-partitions (ADR 0055 pool-as-sideboard).
        const players = match.players as { deck: { sideboard: unknown[] } }[];
        expect(players[0].deck.sideboard.length).toBeGreaterThan(0);
    });

    it("the paired opponent accepts it with their own seat's deck", async () => {
        const fx = playingEvent({
            eventId: "event-h2",
            seed: 777,
            matchFormat: "bo1",
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-h2",
            deck: fx.deckForSeat(0),
        });

        await runJoin(asUser(stub, "bob"), {
            gameId,
            deck: fx.deckForSeat(1),
        });

        const match = stub.doc(stub.doc(gameId).matchId as string);
        expect(match.status).toBe("pregame");
        expect((match.players as unknown[]).length).toBe(2);
    });

    it("refuses an accept with a deck from the wrong SEAT", async () => {
        const fx = playingEvent({
            eventId: "event-h4",
            seed: 778,
            matchFormat: "bo1",
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-h4",
            deck: fx.deckForSeat(0),
        });
        const asBob = asUser(stub, "bob");

        await expect(
            runJoin(asBob, {
                gameId,
                // Bob's user id, but seat 0's deck — not the seat the pairing
                // addresses.
                deck: { ...fx.deckForSeat(1), limitedSeatId: "0" },
            })
        ).rejects.toThrow(/that seat's deck/);
    });
});

describe("startPairingMatch — bot pairing (PRD #1628 stories 11-12)", () => {
    it("starts immediately as a vs-AI Match against the bot's SERVER-derived deck", async () => {
        const fx = playingEvent({
            eventId: "event-b",
            seed: 999,
            matchFormat: "bo3",
            botSeat: true,
        });
        const stub = makeCtx("alice", fx.seeds);

        const gameId = await runStart(stub.ctx, {
            eventId: "event-b",
            deck: fx.deckForSeat(0),
        });

        const match = stub.doc(stub.doc(gameId).matchId as string);
        expect(match.status).toBe("pregame");
        expect(match.solo).toBe(true);
        expect(match.vsAi).toBe(true);
        expect(match.bestOf).toBe(3);
        const players = match.players as {
            id: string;
            deck: { maindeck: unknown[] };
        }[];
        expect(players.map((p) => p.id)).toEqual(["alice-p1", "alice-p2"]);
        // The bot's Auto-Built deck came from its own drafted Pool, not the
        // client: nothing in the mutation's args names a decklist for seat 1.
        expect(players[1].deck.maindeck.length).toBeGreaterThan(0);
        expect(pairingOf(stub, "event-b").matchId).toBe(match._id);
    });
});

describe("startPairingMatch — the guards (PRD #1628, issue #1645 ACs)", () => {
    it("cannot be started twice — the second call is refused", async () => {
        const fx = playingEvent({
            eventId: "event-g",
            seed: 4242,
            matchFormat: "bo1",
        });
        const stub = makeCtx("alice", fx.seeds);
        await runStart(stub.ctx, {
            eventId: "event-g",
            deck: fx.deckForSeat(0),
        });

        // Alice again: the single-active-Match guard (#155) rejects her first.
        await expect(
            runStart(stub.ctx, {
                eventId: "event-g",
                deck: fx.deckForSeat(0),
            })
        ).rejects.toThrow(/already have an active game/i);

        // Bob, who has no active Match, is refused on the pairing itself —
        // a pairing is an appointment, not a race: he accepts Alice's Match.
        const asBob = asUser(stub, "bob");
        await expect(
            runStart(asBob, { eventId: "event-g", deck: fx.deckForSeat(1) })
        ).rejects.toThrow(/already started/);
        // Exactly one Match exists for the pairing.
        expect(stub.rows("matches")).toHaveLength(1);
    });

    it("refuses a seat the caller does not occupy", async () => {
        const fx = playingEvent({
            eventId: "event-g2",
            seed: 4243,
            matchFormat: "bo1",
        });
        const stub = makeCtx("alice", fx.seeds);
        await expect(
            runStart(stub.ctx, {
                eventId: "event-g2",
                // Alice claiming Bob's seat.
                deck: fx.deckForSeat(1),
            })
        ).rejects.toThrow(/do not occupy/);
    });

    it("refuses a deck bound to a DIFFERENT event", async () => {
        const fx = playingEvent({
            eventId: "event-g3",
            seed: 4244,
            matchFormat: "bo1",
        });
        const stub = makeCtx("alice", fx.seeds);
        await expect(
            runStart(stub.ctx, {
                eventId: "event-g3",
                deck: { ...fx.deckForSeat(0), limitedEventId: "event-other" },
            })
        ).rejects.toThrow(/same Limited Event/);
    });

    it("refuses to start once the pairing is already decided", async () => {
        const fx = playingEvent({
            eventId: "event-g4",
            seed: 4245,
            matchFormat: "bo1",
        });
        (fx.event.rounds as { pairings: Row[] }[])[0].pairings[0].result = {
            winsA: 1,
            winsB: 0,
            source: "played",
        };
        const stub = makeCtx("alice", fx.seeds);
        await expect(
            runStart(stub.ctx, {
                eventId: "event-g4",
                deck: fx.deckForSeat(0),
            })
        ).rejects.toThrow(/already decided/);
    });

    it("refuses to start while the event's rounds are not running", async () => {
        const fx = playingEvent({
            eventId: "event-g5",
            seed: 4246,
            matchFormat: "bo1",
        });
        fx.event.status = "started";
        fx.event.currentRound = undefined;
        fx.event.rounds = undefined;
        const stub = makeCtx("alice", fx.seeds);
        await expect(
            runStart(stub.ctx, {
                eventId: "event-g5",
                deck: fx.deckForSeat(0),
            })
        ).rejects.toThrow(/rounds are not running/);
    });
});

describe("recording the result — the full path to the standings (issue #1645)", () => {
    it("a win through the REAL game-over path lands in the standings as `played`", async () => {
        const fx = playingEvent({
            eventId: "event-r",
            seed: 313,
            matchFormat: "bo1",
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-r",
            deck: fx.deckForSeat(0),
        });
        const asBob = asUser(stub, "bob");
        await runJoin(asBob, { gameId, deck: fx.deckForSeat(1) });

        await finishGame(stub.ctx, gameId, "alice");

        expect(pairingOf(stub, "event-r").result).toEqual({
            winsA: 1,
            winsB: 0,
            source: "played",
        });
        const standings = standingsOf(stub, "event-r", "alice");
        expect(standings[0]).toMatchObject({
            seatIndex: 0,
            points: 3,
            matchWins: 1,
            gameWins: 1,
            gameLosses: 0,
        });
        expect(standings[1]).toMatchObject({
            seatIndex: 1,
            points: 0,
            matchLosses: 1,
        });
    });

    it("records nothing until a Bo3 is actually DECIDED, then records the full 2-1", async () => {
        const fx = playingEvent({
            eventId: "event-r3",
            seed: 314,
            matchFormat: "bo3",
            botSeat: true,
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-r3",
            deck: fx.deckForSeat(0),
        });

        await finishGame(stub.ctx, gameId, "alice-p1");
        // Game 1 only routed the Match to sideboarding — no pairing result yet.
        expect(pairingOf(stub, "event-r3").result).toBeUndefined();

        await finishGame(stub.ctx, gameId, "alice-p2");
        expect(pairingOf(stub, "event-r3").result).toBeUndefined();

        await finishGame(stub.ctx, gameId, "alice-p1");
        expect(pairingOf(stub, "event-r3").result).toEqual({
            winsA: 2,
            winsB: 1,
            source: "played",
        });
    });

    it("a FORFEIT records the loss too, with a consistent game score", async () => {
        const fx = playingEvent({
            eventId: "event-f",
            seed: 424,
            matchFormat: "bo3",
            botSeat: true,
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-f",
            deck: fx.deckForSeat(0),
        });
        const matchId = stub.doc(gameId).matchId as string;

        await runForfeit(stub.ctx, { matchId, playerId: "alice-p1" });

        // `computeForfeitMatch` awards the opponent the games they needed, so
        // the recorded score is a whole Bo3 (0-2), never a mid-flight one.
        expect(pairingOf(stub, "event-f").result).toEqual({
            winsA: 0,
            winsB: 2,
            source: "played",
        });
        const standings = standingsOf(stub, "event-f", "alice");
        expect(standings.find((r) => r.seatIndex === 0)).toMatchObject({
            points: 0,
            matchLosses: 1,
            gameWins: 0,
            gameLosses: 2,
        });
        expect(standings.find((r) => r.seatIndex === 1)).toMatchObject({
            points: 3,
            matchWins: 1,
        });
    });

    it("is idempotent — a forfeit after the deciding game does not overwrite it", async () => {
        const fx = playingEvent({
            eventId: "event-i",
            seed: 525,
            matchFormat: "bo1",
            botSeat: true,
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-i",
            deck: fx.deckForSeat(0),
        });
        const matchId = stub.doc(gameId).matchId as string;

        await finishGame(stub.ctx, gameId, "alice-p1");
        expect(pairingOf(stub, "event-i").result).toEqual({
            winsA: 1,
            winsB: 0,
            source: "played",
        });

        // The Match is already finished, so the forfeit is a no-op — and the
        // recorded win must survive it.
        await runForfeit(stub.ctx, { matchId, playerId: "alice-p1" });
        expect(pairingOf(stub, "event-i").result).toEqual({
            winsA: 1,
            winsB: 0,
            source: "played",
        });
    });

    it("records the score in the PAIRING's seat order when the opponent started it", async () => {
        const fx = playingEvent({
            eventId: "event-o",
            seed: 626,
            matchFormat: "bo1",
        });
        // Seat 1 (Bob) is the one who starts, so the Match's own `players[0]`
        // is the pairing's seatB — the score must be flipped on the way in.
        (fx.event.rounds as { pairings: Row[] }[])[0].pairings[0] = {
            seatA: 0,
            seatB: 1,
        };
        const stub = makeCtx("bob", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-o",
            deck: fx.deckForSeat(1),
        });
        const asAlice = asUser(stub, "alice");
        await runJoin(asAlice, { gameId, deck: fx.deckForSeat(0) });

        await finishGame(stub.ctx, gameId, "bob");

        // Bob won 1-0, and Bob is the pairing's seatB.
        expect(pairingOf(stub, "event-o").result).toEqual({
            winsA: 0,
            winsB: 1,
            source: "played",
        });
        const standings = standingsOf(stub, "event-o", "bob");
        expect(standings.find((r) => r.seatIndex === 1)!.points).toBe(3);
        expect(standings.find((r) => r.seatIndex === 0)!.points).toBe(0);
    });

    it("leaves a NON-pairing Match alone (a plain vs-AI playtest records nothing)", async () => {
        const fx = playingEvent({
            eventId: "event-n",
            seed: 727,
            matchFormat: "bo1",
        });
        const stub = makeCtx("alice", fx.seeds);
        // A Match bound to the event but with no `limitedPairing` — the shape
        // "Play vs the Table" creates.
        const matchId = await stub.ctx.db.insert("matches", {
            bestOf: 1,
            status: "playing",
            players: [
                { id: "alice", name: "Alice", bgColor: "#1", score: 0 },
                { id: "bob", name: "Bob", bgColor: "#2", score: 0 },
            ],
            currentGameNumber: 1,
            limitedEventId: "event-n",
            createdAt: 0,
            updatedAt: 0,
        } as never);
        const gameId = await stub.ctx.db.insert("games", {
            name: "playtest",
            matchId,
            gameNumber: 1,
            status: "playing",
            players: [],
            createdAt: 0,
            updatedAt: 0,
        } as never);

        await finishGame(stub.ctx, gameId, "alice");

        expect(pairingOf(stub, "event-n").result).toBeUndefined();
    });
});
