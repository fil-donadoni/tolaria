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

        // 4. createGame — the authoritative game-start gate. The deck's
        // `ResolvePool` is built from the ALREADY-FETCHED event (mirrors
        // `loadLimitedPoolResolver` in `convex/game.ts`), never from the
        // deck's own claims.
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
