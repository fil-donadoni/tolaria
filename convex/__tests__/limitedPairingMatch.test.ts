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
import { saveSeats } from "../limitedSeatStore";

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
                        // `limitedSeatStore`'s payload read (the off-row Pool
                        // store) uses `.unique()`.
                        unique: async () => {
                            if (rows.length > 1) throw new Error("not unique");
                            return rows[0] ?? null;
                        },
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

/** The SAME 2-seat LEA Sealed table as `playingEvent`, but seeded through the
 *  REAL production write path (`saveSeats`, `convex/limitedSeatStore.ts`)
 *  instead of embedding `pool` inline on `event.seats`.
 *
 *  This is the fixture `playingEvent` (and every other fixture in this file)
 *  is NOT: every one of them builds `seats` in memory and drops the array
 *  straight onto the seed event row, so `event.seats[].pool` is always
 *  present — the LEGACY inline shape. `hydrateSeats`/`hydrateSeat` fall back
 *  to exactly that inline shape when no `limitedSeats` child row exists, so a
 *  test built on the inline fixture can never catch a caller that reads
 *  `event.seats[].pool` directly instead of hydrating — which is exactly the
 *  bug `resolveSeatAutoBuiltDeck` shipped with (issue #1646 review finding
 *  1): production's `saveSeats` NEVER writes `pool` back onto the event row,
 *  only a `limitedSeats` child row plus a slim `poolCount`, so the inline
 *  fixture was testing a shape production stopped producing.
 *
 *  Returns a STUB already seeded by a real `saveSeats` call — the caller
 *  drives `stub.ctx` exactly like every other fixture below, but the event
 *  row it reads back is genuinely slim. */
async function playingEventViaSaveSeats(opts: {
    eventId: string;
    seed: number;
    matchFormat: "bo1" | "bo3";
    botSeat?: boolean;
}): Promise<{ stub: Stub; deckForSeat: (seatIndex: number) => DeckPayload }> {
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

    // Seed the event row with NO inline payload at all — `saveSeats` below is
    // what actually populates it, exactly as a real draft/deckbuild mutation
    // would.
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
        seats: [],
        createdAt: 0,
        updatedAt: 0,
    };
    const seeds: Row[] = [
        event,
        { _id: "alice", __table: "users", nickname: "Alice" },
        { _id: "bob", __table: "users", nickname: "Bob" },
    ];
    const stub = makeCtx("alice", seeds);

    // The real write: slims `event.seats` and files each seat's Pool into its
    // own `limitedSeats` child row — the split `saveSeats` performs in every
    // production draft/deckbuild mutation.
    await saveSeats(
        stub.ctx,
        opts.eventId as unknown as Id<"limitedEvents">,
        seats
    );

    return { stub, deckForSeat };
}

/** A 4-seat, ALL-HUMAN LEA Sealed event in `playing`, round 1 paired
 *  (0v1)/(2v3) — both pairings pending (issue #1646's round-advance tests need
 *  TWO separate pairings in the same round to prove the advance is
 *  order-independent: whichever one is recorded LAST is what triggers it). */
function fourHumanEvent(opts: { eventId: string; seed: number }): Fixture {
    let seats = buildEmptySeats(4);
    seats = assignFreeSeat(seats, "alice", "Alice");
    seats = assignFreeSeat(seats, "bob", "Bob");
    seats = assignFreeSeat(seats, "carol", "Carol");
    seats = assignFreeSeat(seats, "dave", "Dave");
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
        seatCount: 4,
        packSlots: ["lea"],
        sealedBoosterCount: 6,
        matchFormat: "bo1",
        currentRound: 1,
        rounds: [
            {
                roundNumber: 1,
                startedAt: 0,
                pairings: [
                    { seatA: 0, seatB: 1 },
                    { seatA: 2, seatB: 3 },
                ],
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
        { _id: "carol", __table: "users", nickname: "Carol" },
        { _id: "dave", __table: "users", nickname: "Dave" },
    ];
    return { event, deckForSeat, seeds };
}

const SEAT_USER = ["alice", "bob", "carol", "dave"] as const;

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

    it("starts against the bot's deck when its Pool lives in the split `limitedSeats` child row — the PRODUCTION shape (issue #1646 review finding 1)", async () => {
        const { stub, deckForSeat } = await playingEventViaSaveSeats({
            eventId: "event-b-split",
            seed: 998,
            matchFormat: "bo3",
            botSeat: true,
        });

        // Sanity: this fixture genuinely reproduces what `saveSeats` leaves on
        // the row — no `pool` inline, unlike every other fixture in this
        // file. Without this, the test below would pass for the same wrong
        // reason `playingEvent`'s inline shape always did.
        const rawSeats = stub.doc("event-b-split").seats as Row[];
        expect(rawSeats.every((seat) => seat.pool === undefined)).toBe(true);
        expect(stub.rows("limitedSeats").length).toBeGreaterThan(0);

        const gameId = await runStart(stub.ctx, {
            eventId: "event-b-split",
            deck: deckForSeat(0),
        });

        const match = stub.doc(stub.doc(gameId).matchId as string);
        expect(match.status).toBe("pregame");
        expect(match.vsAi).toBe(true);
        const players = match.players as {
            id: string;
            deck: { maindeck: unknown[] };
        }[];
        // The whole acceptance criterion this test guards: a human-vs-bot
        // pairing Match actually starts, with the bot's deck resolved from
        // its HYDRATED Pool — not silently empty/null (which used to throw
        // "Your opponent's deck is not ready yet.").
        expect(players[1].deck.maindeck.length).toBeGreaterThan(0);
        expect(pairingOf(stub, "event-b-split").matchId).toBe(match._id);
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

// The scoring exploit this PR would otherwise open (issue #1645 review):
// `forfeitMatch` used to check only `matchBelongsToUser` — that the caller is
// IN the Match — and then forfeited whichever seat the CLIENT named. Now that a
// forfeited pairing Match records a `source: "played"` standings row, either
// seat could have written itself a free 2-0 by naming the OPPONENT.
// `convex/__tests__/seatOwnership.test.ts` covers the sibling `concede` and the
// predicate itself; this asserts the standings consequence.
describe("forfeitMatch — the caller must own the seat they forfeit (issue #1645 review)", () => {
    it("refuses a forfeit naming the OPPONENT's seat, and records no standings row", async () => {
        const fx = playingEvent({
            eventId: "event-x",
            seed: 828,
            matchFormat: "bo3",
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-x",
            deck: fx.deckForSeat(0),
        });
        const asBob = asUser(stub, "bob");
        await runJoin(asBob, { gameId, deck: fx.deckForSeat(1) });
        const matchId = stub.doc(gameId).matchId as string;

        // Bob tries to forfeit ALICE — a free 2-0 for himself.
        await expect(
            runForfeit(asBob, { matchId, playerId: "alice" })
        ).rejects.toThrow(/cannot act as another player/i);

        expect(pairingOf(stub, "event-x").result).toBeUndefined();
        expect(stub.doc(matchId).status).not.toBe("finished");
        const standings = standingsOf(stub, "event-x", "bob");
        expect(standings.find((r) => r.seatIndex === 1)!.points).toBe(0);
    });

    // The solo-bot case seat OWNERSHIP alone cannot close (issue #1645 second
    // review). Against a Bot Drafter opponent the Match is seated `alice-p1` /
    // `alice-p2` and the human owns BOTH handles, so `assertSeatOwnership`
    // passes for `alice-p2` — by design, since that is the very handle the
    // client-side Brain plays. Forfeiting it would be a one-call 2-0 in the
    // standings with zero games played. `assertNotEventBotSeat` blocks it on
    // the resignation path only.
    it("refuses a forfeit naming the BOT's seat in an event pairing, and records no standings row", async () => {
        const fx = playingEvent({
            eventId: "event-bot-x",
            seed: 616,
            matchFormat: "bo3",
            botSeat: true,
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-bot-x",
            deck: fx.deckForSeat(0),
        });
        const matchId = stub.doc(gameId).matchId as string;
        expect(
            (stub.doc(matchId).players as { id: string }[]).map((p) => p.id)
        ).toEqual(["alice-p1", "alice-p2"]);

        await expect(
            runForfeit(stub.ctx, { matchId, playerId: "alice-p2" })
        ).rejects.toThrow(/cannot resign your bot opponent/i);

        expect(pairingOf(stub, "event-bot-x").result).toBeUndefined();
        expect(stub.doc(matchId).status).not.toBe("finished");
        const standings = standingsOf(stub, "event-bot-x", "alice");
        expect(standings.find((r) => r.seatIndex === 0)!.points).toBe(0);
    });

    // The same gate must not swallow the legitimate resignation: a human who
    // gives up against the bot still concedes the pairing to the bot.
    it("still lets the human forfeit their OWN seat of a bot pairing", async () => {
        const fx = playingEvent({
            eventId: "event-bot-y",
            seed: 717,
            matchFormat: "bo3",
            botSeat: true,
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-bot-y",
            deck: fx.deckForSeat(0),
        });
        const matchId = stub.doc(gameId).matchId as string;

        await runForfeit(stub.ctx, { matchId, playerId: "alice-p1" });

        expect(pairingOf(stub, "event-bot-y").result).toEqual({
            winsA: 0,
            winsB: 2,
            source: "played",
        });
    });

    it("still lets a player forfeit their OWN seat", async () => {
        const fx = playingEvent({
            eventId: "event-y",
            seed: 929,
            matchFormat: "bo3",
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-y",
            deck: fx.deckForSeat(0),
        });
        const asBob = asUser(stub, "bob");
        await runJoin(asBob, { gameId, deck: fx.deckForSeat(1) });
        const matchId = stub.doc(gameId).matchId as string;

        await runForfeit(asBob, { matchId, playerId: "bob" });

        expect(pairingOf(stub, "event-y").result).toEqual({
            winsA: 2,
            winsB: 0,
            source: "played",
        });
    });
});

// ── Round advance + event finish (issue #1646) ───────────────────────────────

describe("recording a result advances the round / finishes the event (issue #1646)", () => {
    it("finishes a 1-round (2-seat) event the instant its only pairing decides", async () => {
        // `roundsForSeatCount(2) === 1` — a 2-seat table has no round 2, so
        // its ONE pairing deciding IS the event's last pairing (PRD story 20
        // + 39-40: "deciding the last pairing of the last round moves the
        // event to finished").
        const fx = playingEvent({
            eventId: "event-fin2",
            seed: 1646,
            matchFormat: "bo1",
        });
        const stub = makeCtx("alice", fx.seeds);
        const gameId = await runStart(stub.ctx, {
            eventId: "event-fin2",
            deck: fx.deckForSeat(0),
        });
        await runJoin(asUser(stub, "bob"), {
            gameId,
            deck: fx.deckForSeat(1),
        });

        await finishGame(stub.ctx, gameId, "alice");

        const event = stub.doc("event-fin2");
        expect(event.status).toBe("finished");
        expect(event.currentRound).toBe(1);
        expect((event.rounds as unknown[]).length).toBe(1);
        // The winner is readable through the SAME projection the client
        // receives — never a separate stored field (ADR 0076: standings are
        // derived, never stored).
        const projected = projectLimitedEvent(
            event as unknown as LimitedEventRow,
            "alice"
        );
        expect(projected.standings[0].seatIndex).toBe(0);
        expect(projected.standings[0].points).toBe(3);
    });

    it("opens round 2 exactly once round 1's LAST undecided pairing is recorded — order-independent, and never advances twice on a re-delivered result", async () => {
        const fx = fourHumanEvent({ eventId: "event-adv", seed: 1647 });
        const stub = makeCtx("alice", fx.seeds);

        // Record the (2,3) pairing FIRST — Dave beats Carol. Round 1 still
        // has (0,1) pending, so nothing advances yet.
        const gameCD = await runStart(asUser(stub, "carol"), {
            eventId: "event-adv",
            deck: fx.deckForSeat(2),
        });
        await runJoin(asUser(stub, "dave"), {
            gameId: gameCD,
            deck: fx.deckForSeat(3),
        });
        await finishGame(stub.ctx, gameCD, "dave");

        expect(stub.doc("event-adv").status).toBe("playing");
        expect(stub.doc("event-adv").currentRound).toBe(1);
        expect((stub.doc("event-adv").rounds as unknown[]).length).toBe(1);

        // NOW record (0,1) — Alice beats Bob, the round's LAST undecided
        // pairing (whichever of the two lands second is what triggers the
        // advance — this is the property that makes two players finishing
        // near-simultaneously safe: the one whose write is ordered/committed
        // SECOND is the one that observes a fully-decided round).
        const gameAB = await runStart(stub.ctx, {
            eventId: "event-adv",
            deck: fx.deckForSeat(0),
        });
        await runJoin(asUser(stub, "bob"), {
            gameId: gameAB,
            deck: fx.deckForSeat(1),
        });
        await finishGame(stub.ctx, gameAB, "alice");

        const afterRound1 = stub.doc("event-adv");
        expect(afterRound1.status).toBe("playing");
        expect(afterRound1.currentRound).toBe(2);
        const rounds = afterRound1.rounds as {
            roundNumber: number;
            pairings: { seatA: number; seatB?: number }[];
        }[];
        expect(rounds).toHaveLength(2);

        // Round 2 never repeats round 1's pairs.
        const pairKey = (a: number, b: number) =>
            a < b ? `${a}:${b}` : `${b}:${a}`;
        const round2Pairings = rounds[1].pairings;
        for (const p of round2Pairings) {
            expect([pairKey(0, 1), pairKey(2, 3)]).not.toContain(
                pairKey(p.seatA, p.seatB!)
            );
        }

        // Re-delivering the ALREADY-recorded (0,1) result again (a retried
        // mutation, or a second concurrent caller whose OCC-retried read
        // lands after the first writer already recorded it) is a no-op:
        // `recordPlayedPairing` refuses an already-decided pairing, so
        // neither the round nor the event advances a second time.
        await finishGame(stub.ctx, gameAB, "alice");
        const afterRedelivery = stub.doc("event-adv");
        expect(afterRedelivery.currentRound).toBe(2);
        expect((afterRedelivery.rounds as unknown[]).length).toBe(2);

        // Play out round 2 (the table's LAST round —
        // `roundsForSeatCount(4) === 2`) — whichever pairing decides LAST
        // finishes the event, same order-independence as round 1 above.
        const [p1, p2] = round2Pairings;
        const g1 = await runStart(asUser(stub, SEAT_USER[p1.seatA]), {
            eventId: "event-adv",
            deck: fx.deckForSeat(p1.seatA),
        });
        await runJoin(asUser(stub, SEAT_USER[p1.seatB!]), {
            gameId: g1,
            deck: fx.deckForSeat(p1.seatB!),
        });
        await finishGame(stub.ctx, g1, SEAT_USER[p1.seatA]);

        expect(stub.doc("event-adv").status).toBe("playing");

        const g2 = await runStart(asUser(stub, SEAT_USER[p2.seatA]), {
            eventId: "event-adv",
            deck: fx.deckForSeat(p2.seatA),
        });
        await runJoin(asUser(stub, SEAT_USER[p2.seatB!]), {
            gameId: g2,
            deck: fx.deckForSeat(p2.seatB!),
        });
        await finishGame(stub.ctx, g2, SEAT_USER[p2.seatA]);

        const final = stub.doc("event-adv");
        expect(final.status).toBe("finished");
        expect(final.currentRound).toBe(2);
        expect((final.rounds as unknown[]).length).toBe(2);

        const projected = projectLimitedEvent(
            final as unknown as LimitedEventRow,
            "alice"
        );
        // Every seat has exactly 2 decided matches (won its round 1 and
        // round 2 pairing, or lost both) — the standings are readable and
        // internally consistent through the wire projection.
        expect(projected.standings).toHaveLength(4);
        for (const row of projected.standings) {
            expect(row.matchWins + row.matchLosses).toBe(2);
        }
    });
});

describe("recordLimitedPairingResult — a cascade failure never rolls back a finished Match (issue #1646 review finding 2)", () => {
    it("still records the pairing result and finishes the Match when cascadeEventRounds throws", async () => {
        const fx = playingEvent({
            eventId: "event-cascade-fail",
            seed: 2001,
            matchFormat: "bo1",
        });
        const stub = makeCtx("alice", fx.seeds);

        const gameId = await runStart(stub.ctx, {
            eventId: "event-cascade-fail",
            deck: fx.deckForSeat(0),
        });
        await runJoin(asUser(stub, "bob"), {
            gameId,
            deck: fx.deckForSeat(1),
        });

        // Inflate `event.seats` past `MAX_SEATS` (8) AFTER the Match/pairing
        // already exist — `roundsForSeatCount`/`pairRound`
        // (`convex/limited/swiss.ts`) throw outside `MIN_SEATS..MAX_SEATS`
        // (2-8), and `cascadeEventRounds` calls `roundsForSeatCount`
        // unconditionally the instant the pairing just recorded completes
        // its round. These 7 filler seats never sit in a pairing, so this
        // exercises ONLY that guard — nothing else the Match-finish path
        // reads depends on `event.seats.length`.
        const event = stub.doc("event-cascade-fail");
        event.seats = [
            ...(event.seats as Row[]),
            ...Array.from({ length: 7 }, (_, i) => ({
                seatIndex: 2 + i,
                isBot: true,
                nickname: `Filler ${i}`,
            })),
        ];

        // Finishing the Match must not throw — the whole point of the fix:
        // a pairing-advance failure can never roll back the game-over
        // transaction that just finished this Match. (Without the fix, this
        // `await` rejects with `roundsForSeatCount`'s range error.)
        await finishGame(stub.ctx, gameId, "alice");

        // The Match result itself survived.
        const match = stub.doc(stub.doc(gameId).matchId as string);
        expect(match.status).toBe("finished");

        // …and so did the pairing's recorded result — `cascadeEventRounds`
        // failed, but `recordPlayedPairing`'s own write is unconditional and
        // lands regardless.
        expect(pairingOf(stub, "event-cascade-fail").result).toEqual({
            winsA: 1,
            winsB: 0,
            source: "played",
        });

        // The round-advance step was skipped, not half-applied: the event is
        // left exactly where it was before the failed cascade attempt, for
        // the next recorded pairing (or an operator) to retry.
        const afterward = stub.doc("event-cascade-fail");
        expect(afterward.status).toBe("playing");
        expect(afterward.currentRound).toBe(1);
    });
});
