// End-to-end Limited deckbuild integration test (issue #1111 AC: "sealed
// event → build → submit → createGame succeeds end-to-end via public
// mutations"). The project has no convex-test harness (see
// `convex/__tests__/adminAuth.test.ts`) — this drives the EXACT exported pure
// functions the real mutations call, in the same order, against the REAL
// card registry and the REAL checked-in LEA Booster Config, exactly like
// `convex/__tests__/limitedEvents.test.ts` does for the event skeleton. This
// file continues that pipeline through deckbuilding (`userDecks.create`'s
// seat-ownership gate + `convex/formats.ts`'s pool legality) and the
// authoritative game-start gate (`assertDeckLegal`, `convex/game.ts`).
import { describe, it, expect } from "vitest";
import { resolveDeckCardMeta, tryGetDefinition } from "../cards";
import { assertDeckLegal, type GateDeck } from "../formats";
import {
    createGame,
    createSoloGame,
    joinGame,
    loadLimitedPoolResolver,
} from "../game";
import { deckValidator } from "../gameSeats";
import { create } from "../userDecks";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { makeInMemoryDb, type InMemoryDb } from "./fixtures/inMemoryDb.fixture";
import { makeRng } from "../gre/rng";
import {
    assignFreeSeat,
    buildEmptySeats,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../limited/eventLogic";
import {
    assertLimitedSeatOwnership,
    resolveLimitedDeckLegality,
    resolvePoolFromEvent,
} from "../limited/poolResolution";
import { getBoosterConfig } from "../limited/registry";

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

const ALICE = "user-alice";
const BOB = "user-bob";

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (fn: unknown, ctx: MutationCtx, args: unknown): Promise<any> =>
    (fn as { _handler: (c: MutationCtx, a: unknown) => Promise<any> })._handler(
        ctx,
        args
    );

describe("Limited deckbuild pipeline: sealed event → build → submit → createGame (issue #1111)", () => {
    it("a legal deck built entirely from the seat's Pool starts a real Match", () => {
        // 1. createLimitedEvent + joinLimitedEvent + startLimitedEvent — a
        // 2-seat Sealed LEA event, one human, one bot, mirroring
        // `limitedEvents.test.ts`'s lifecycle exactly.
        const packSlots = ["lea"];
        const sealedBoosterCount = 6;
        let seats = buildEmptySeats(2);
        seats = assignFreeSeat(seats, "user1", "Alice");
        seats = fillBotSeats(seats);
        seats = generateSealedPools(
            seats,
            packSlots,
            sealedBoosterCount,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(777)
        );
        const event = {
            _id: "event-1",
            seats,
        };
        const humanSeat = event.seats.find((s) => s.userId === "user1")!;
        expect(humanSeat.pool).toBeDefined();
        expect(humanSeat.pool!.length).toBeGreaterThan(0);

        // 2. Build: the pool-scoped builder starts every non-basic Pool card
        // in the Sideboard (ADR 0054/0055) and the player moves >= 40 into
        // the Maindeck, padding with free basics found in the Pool's own
        // opened commons — exactly the invariant the client-side builder
        // (`src/components/deckbuilder/pool-deck-builder.tsx`) maintains:
        // Main + Side always equals the Pool.
        const nonBasicCards = humanSeat.pool!.filter(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic !== true
        );
        const basicCard = humanSeat.pool!.find(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic === true
        );
        expect(basicCard).toBeDefined(); // LEA's common sheet carries basics

        const mainCount = Math.min(30, nonBasicCards.length);
        const mainFromPool = nonBasicCards.slice(0, mainCount);
        const sideFromPool = nonBasicCards.slice(mainCount);
        const basicsNeeded = Math.max(0, 40 - mainFromPool.length);
        const cards = [
            ...mainFromPool.map((c) => ({
                cardId: c.cardId,
                cardName: c.cardName,
            })),
            ...Array.from({ length: basicsNeeded }, () => ({
                cardId: basicCard!.cardId,
                cardName: basicCard!.cardName,
            })),
        ];
        const sideboard = sideFromPool.map((c) => ({
            cardId: c.cardId,
            cardName: c.cardName,
        }));
        expect(cards.length).toBeGreaterThanOrEqual(40);

        // 3. Submit — `userDecks.create`'s seat-ownership gate (issue #1111:
        // "a user builds only in their OWN seat — server-derive userId,
        // never trust client seat id"). The real occupant succeeds...
        expect(() =>
            assertLimitedSeatOwnership(
                event,
                String(humanSeat.seatIndex),
                "user1"
            )
        ).not.toThrow();
        // ...a DIFFERENT user impersonating that seat id is rejected, even
        // though the seat id itself is valid and public (seat indices are
        // visible in the event's seat list).
        expect(() =>
            assertLimitedSeatOwnership(
                event,
                String(humanSeat.seatIndex),
                "some-other-user"
            )
        ).toThrow(/do not occupy/);

        // The persisted deck row (what `userDecks.create` would insert).
        const deckRow = {
            name: "My Sealed Deck",
            format: "limited" as const,
            cards,
            sideboard,
            limitedEventId: event._id,
            limitedSeatId: String(humanSeat.seatIndex),
        };

        // Advisory legality (`userDecks.listMine`'s server-attached
        // isLegal/reasons, issue #1111) agrees the deck is legal.
        const advisory = resolveLimitedDeckLegality(deckRow, humanSeat.pool!);
        expect(advisory.isLegal).toBe(true);
        expect(advisory.reasons).toEqual([]);

        // 4. The pure legality decision against that Pool; the game-start path
        // proper (Deck Pool by `userDeckId`) is driven for real below.
        const gateDeck: GateDeck = { ...deckRow };
        const resolvePool = () =>
            resolvePoolFromEvent(event, gateDeck.limitedSeatId!);
        expect(() =>
            assertDeckLegal(gateDeck, undefined, undefined, resolvePool)
        ).not.toThrow();
    });

    it("createGame rejects a deck tampered with a card the seat's Pool never granted", () => {
        const packSlots = ["lea"];
        let seats = buildEmptySeats(2);
        seats = assignFreeSeat(seats, "user1", "Alice");
        seats = fillBotSeats(seats);
        seats = generateSealedPools(
            seats,
            packSlots,
            6,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(1234)
        );
        const event = { _id: "event-2", seats };
        const humanSeat = event.seats.find((s) => s.userId === "user1")!;

        const nonBasic = humanSeat.pool!.filter(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic !== true
        );
        const basic = humanSeat.pool!.find(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic === true
        )!;

        // Fabricate a Maindeck that swaps ONE granted card for a foreign one
        // never in this seat's Pool — the tamper case.
        const mainPool = nonBasic.slice(0, 29);
        const basics = Array.from({ length: 40 - mainPool.length - 1 }, () => ({
            cardId: basic.cardId,
            cardName: basic.cardName,
        }));
        const tamperedCard = {
            cardId: "not-in-any-pool",
            cardName: "Contraband",
        };
        const gateDeck: GateDeck = {
            name: "Tampered Deck",
            format: "limited",
            cards: [
                ...mainPool.map((c) => ({
                    cardId: c.cardId,
                    cardName: c.cardName,
                })),
                ...basics,
                tamperedCard,
            ],
            sideboard: nonBasic.slice(29).map((c) => ({
                cardId: c.cardId,
                cardName: c.cardName,
            })),
            limitedEventId: event._id,
            limitedSeatId: String(humanSeat.seatIndex),
        };
        const resolvePool = () =>
            resolvePoolFromEvent(event, gateDeck.limitedSeatId!);
        expect(() =>
            assertDeckLegal(gateDeck, undefined, undefined, resolvePool)
        ).toThrow(/not in this seat's Pool/i);
    });
});

// Game start resolves a Limited deck's Pool by `userDeckId` (ADR 0106 §4, issue
// #2815): the REAL handlers, in the order a player reaches them, against the
// shared in-memory ctx (no convex-test harness, see `limitedDeckPool.test.ts`).
describe("Limited game start: sealed event → build → save → event removed → createGame (issue #2815)", () => {
    const EVENT_ID = "event-sealed";

    /** A started 2-human Sealed LEA event, seen as Alice. */
    function world() {
        let seats = buildEmptySeats(2);
        seats = assignFreeSeat(seats, ALICE, "Alice");
        seats = assignFreeSeat(seats, BOB, "Bob");
        seats = generateSealedPools(
            seats,
            ["lea"],
            6,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(2815)
        );
        const db = makeInMemoryDb(
            {
                users: [
                    { _id: ALICE, nickname: "Alice" },
                    { _id: BOB, nickname: "Bob" },
                ],
                limitedEvents: [
                    {
                        _id: EVENT_ID,
                        type: "sealed",
                        status: "started",
                        packSlots: ["lea"],
                        seatCount: 2,
                        seats,
                    },
                ],
            },
            { identitySubject: `${ALICE}|session` }
        );
        return { db, seats };
    }

    const as = (ctx: MutationCtx, userId: string): MutationCtx =>
        ({
            ...ctx,
            auth: {
                getUserIdentity: async () => ({
                    subject: `${userId}|session`,
                }),
            },
        }) as unknown as MutationCtx;

    /** The deck the pool builder saves: all of the seat's non-basic Pool,
     *  30 in the Maindeck padded with basics, the rest in the Sideboard. */
    function builtDeck(
        seats: ReturnType<typeof buildEmptySeats>,
        seat: number
    ) {
        const pool = seats.find((s) => s.seatIndex === seat)!.pool!;
        const toCard = (c: { cardId: string; cardName: string }) => ({
            cardId: c.cardId,
            cardName: c.cardName,
        });
        const nonBasic = pool.filter(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic !== true
        );
        const basic = pool.find(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic === true
        )!;
        const main = nonBasic.slice(0, 30);
        return {
            name: `Seat ${seat}`,
            format: "limited",
            cards: [
                ...main.map(toCard),
                ...Array.from({ length: 40 - main.length }, () =>
                    toCard(basic)
                ),
            ],
            sideboard: nonBasic.slice(30).map(toCard),
            limitedEventId: EVENT_ID,
            limitedSeatId: String(seat),
        };
    }

    /** Saves the seat's deck through `userDecks.create` and returns the inline
     *  payload a client sends for it. */
    async function savedPayload(
        db: InMemoryDb,
        seats: ReturnType<typeof buildEmptySeats>,
        seat: number,
        owner: string
    ) {
        const deck = builtDeck(seats, seat);
        const userDeckId = await run(create, as(db.ctx, owner), {
            ...deck,
            colors: [],
        });
        return { id: userDeckId, userDeckId, ...deck };
    }

    function removeEvent(db: InMemoryDb) {
        db.tables.limitedEvents = [];
        db.tables.limitedSeats = [];
    }

    function expectNoMatchWritten(db: InMemoryDb) {
        expect(db.tables.matches ?? []).toEqual([]);
        expect(db.tables.games ?? []).toEqual([]);
    }

    describe("a Limited deck whose event is gone still starts", () => {
        it("a normal game: createGame, then joinGame with the joiner's deck", async () => {
            const { db, seats } = world();
            const alice = await savedPayload(db, seats, 0, ALICE);
            const bob = await savedPayload(db, seats, 1, BOB);
            removeEvent(db);

            const gameId = await run(createGame, db.ctx, {
                name: "t",
                deck: alice,
            });
            expect(db.tables.matches).toHaveLength(1);

            await run(joinGame, as(db.ctx, BOB), { gameId, deck: bob });
            expect(db.tables.matches![0].status).toBe("pregame");
        });

        it.each([
            ["a solo game", false],
            ["a vs-AI game", true],
        ])("%s: createSoloGame", async (_label, vsAi) => {
            const { db, seats } = world();
            const alice = await savedPayload(db, seats, 0, ALICE);
            removeEvent(db);

            await run(createSoloGame, db.ctx, {
                name: "t",
                deck: alice,
                vsAi,
            });
            expect(db.tables.matches).toHaveLength(1);
        });

        it("the event is not even read while it still exists: seat occupancy no longer gates this path", async () => {
            const { db, seats } = world();
            const alice = await savedPayload(db, seats, 0, ALICE);
            db.gets.length = 0;
            db.reads.length = 0;

            await run(createGame, db.ctx, { name: "t", deck: alice });

            expect(db.gets).not.toContain(EVENT_ID);
            expect(db.reads.map((r) => r.table)).not.toContain("limitedSeats");
        });
    });

    describe("rejections, before any Match or Game row is written", () => {
        it("a `limited` payload without `userDeckId`, on every entry point and either seat", async () => {
            const { db, seats } = world();
            const noRow = {
                ...(await savedPayload(db, seats, 0, ALICE)),
                userDeckId: undefined,
            };
            const legal = await savedPayload(db, seats, 0, ALICE);
            const NO_ROW = /must be a saved deck/;

            await expect(
                run(createGame, db.ctx, { name: "t", deck: noRow })
            ).rejects.toThrow(NO_ROW);
            await expect(
                run(createSoloGame, db.ctx, { name: "t", deck: noRow })
            ).rejects.toThrow(NO_ROW);
            await expect(
                run(createSoloGame, db.ctx, {
                    name: "t",
                    deck: legal,
                    deck2: noRow,
                })
            ).rejects.toThrow(NO_ROW);
            expectNoMatchWritten(db);
        });

        it("joinGame with a `limited` payload without `userDeckId`, leaving the waiting Match unjoined", async () => {
            const { db, seats } = world();
            const alice = await savedPayload(db, seats, 0, ALICE);
            const noRow = {
                ...(await savedPayload(db, seats, 1, BOB)),
                userDeckId: undefined,
            };
            const gameId = await run(createGame, db.ctx, {
                name: "t",
                deck: alice,
            });

            await expect(
                run(joinGame, as(db.ctx, BOB), { gameId, deck: noRow })
            ).rejects.toThrow(/must be a saved deck/);
            expect(db.tables.matches![0].status).toBe("waiting");
        });

        it("`userDeckId` pointing at another user's deck — the seat in the payload proves nothing", async () => {
            const { db, seats } = world();
            const victims = await savedPayload(db, seats, 1, BOB);

            await expect(
                run(createGame, db.ctx, { name: "t", deck: victims })
            ).rejects.toThrow(/do not own this Limited deck/);
            expectNoMatchWritten(db);
        });

        it("a `userDeckId` naming no row", async () => {
            const { db, seats } = world();
            const alice = await savedPayload(db, seats, 0, ALICE);

            await expect(
                run(createGame, db.ctx, {
                    name: "t",
                    deck: { ...alice, userDeckId: "userdeck-gone" },
                })
            ).rejects.toThrow(/do not own this Limited deck/);
            expectNoMatchWritten(db);
        });

        it("provenance the row does not carry", async () => {
            const { db, seats } = world();
            const alice = await savedPayload(db, seats, 0, ALICE);

            await expect(
                run(createGame, db.ctx, {
                    name: "t",
                    deck: { ...alice, limitedSeatId: "1" },
                })
            ).rejects.toThrow(/not built at that event's seat/);
            expectNoMatchWritten(db);
        });

        it("a card the Deck Pool does not account for, the event gone — and a Pool in the payload changes nothing", async () => {
            const { db, seats } = world();
            const alice = await savedPayload(db, seats, 0, ALICE);
            removeEvent(db);
            const contraband = {
                cardId: "not-in-any-pool",
                cardName: "Contraband",
            };
            const tampered = {
                ...alice,
                cards: [...alice.cards.slice(1), contraband],
                sideboard: [...alice.sideboard, alice.cards[0]],
            };

            await expect(
                run(createGame, db.ctx, { name: "t", deck: tampered })
            ).rejects.toThrow(/not in this seat's Pool/i);
            await expect(
                run(createGame, db.ctx, {
                    name: "t",
                    deck: {
                        ...tampered,
                        pool: [
                            {
                                scryfallId: contraband.cardId,
                                ...contraband,
                            },
                        ],
                    },
                })
            ).rejects.toThrow(/not in this seat's Pool/i);
            expectNoMatchWritten(db);
        });

        it("a row with no Deck Pool is `pool-unresolved`, never a silent pass or a fall back to the Seat", async () => {
            const { db, seats } = world();
            const alice = await savedPayload(db, seats, 0, ALICE);
            db.tables.limitedDeckPools = [];

            await expect(
                run(createGame, db.ctx, { name: "t", deck: alice })
            ).rejects.toThrow(/Pool/);
            expectNoMatchWritten(db);
        });
    });

    it("the payload's validator names no Pool field, so Convex refuses one on the wire", () => {
        const fields = Object.keys(deckValidator.fields);
        expect(fields).toContain("userDeckId");
        expect(fields.filter((f) => /pool/i.test(f))).toEqual([]);
    });

    it("a non-Limited deck never reads the row it names", async () => {
        const { ctx, gets } = makeInMemoryDb();
        const resolver = await loadLimitedPoolResolver(
            ctx,
            {
                format: "freeform",
                userDeckId: "someone-elses-deck" as Id<"userDecks">,
            },
            ALICE
        );
        expect(resolver).toBeUndefined();
        expect(gets).toEqual([]);
    });
});
