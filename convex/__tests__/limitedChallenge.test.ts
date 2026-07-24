// End-to-end Limited human-vs-human challenge integration test (issue #1577
// AC: "Player A challenges human seat B; the resulting match uses both
// players' limited decks; pairing decks from different events is rejected
// server-side; an integration test covers the full challenge → join → game
// start path"). The project has no convex-test harness (see
// `convex/__tests__/limitedDeckbuild.test.ts`) — this drives the EXACT
// exported gate functions `challengeLimitedSeat` and `joinGame` call, in the
// same order, against the REAL card registry + the REAL checked-in LEA Booster
// Config, continuing `limitedDeckbuild.test.ts`'s pipeline into the pairing
// path.
import { describe, it, expect } from "vitest";
import { resolveDeckCardMeta, tryGetDefinition } from "../cards";
import { assertDeckLegal, type GateDeck } from "../formats";
import { loadLimitedPoolResolver } from "../game";
import type { MutationCtx } from "../_generated/server";
import { makeRng } from "../gre/rng";
import {
    assignFreeSeat,
    buildEmptySeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../limited/eventLogic";
import {
    assertLimitedSeatOwnership,
    resolvePoolFromEvent,
} from "../limited/poolResolution";
import {
    assertChallengeableSeat,
    assertSameEventDeck,
} from "../limited/challenge";
import { getBoosterConfig } from "../limited/registry";

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

/** Build a 2-human Sealed LEA event and a legal 40-card deck for each seat
 *  entirely from that seat's Pool — the fixture both mutations gate against. */
function buildTwoHumanEvent(eventId: string, seed: number) {
    let seats = buildEmptySeats(2);
    seats = assignFreeSeat(seats, "alice", "Alice");
    seats = assignFreeSeat(seats, "bob", "Bob");
    seats = generateSealedPools(
        seats,
        ["lea"],
        6,
        getBoosterConfig,
        resolveCardMeta,
        makeRng(seed)
    );
    const event = { _id: eventId, seats };

    const deckForSeat = (seatIndex: number): GateDeck => {
        const seat = event.seats.find((s) => s.seatIndex === seatIndex)!;
        const nonBasic = seat.pool!.filter(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic !== true
        );
        const basic = seat.pool!.find(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic === true
        )!;
        const main = nonBasic.slice(0, 30);
        const basics = Array.from(
            { length: Math.max(0, 40 - main.length) },
            () => ({ cardId: basic.cardId, cardName: basic.cardName })
        );
        return {
            name: `Seat ${seatIndex} Deck`,
            format: "limited",
            cards: [
                ...main.map((c) => ({
                    cardId: c.cardId,
                    cardName: c.cardName,
                })),
                ...basics,
            ],
            sideboard: nonBasic
                .slice(30)
                .map((c) => ({ cardId: c.cardId, cardName: c.cardName })),
            limitedEventId: event._id,
            limitedSeatId: String(seatIndex),
        };
    };

    return { event, deckForSeat };
}

describe("Limited challenge pipeline: challenge → join → game start (issue #1577)", () => {
    it("Alice challenges Bob's seat and both seats' event decks pair legally", () => {
        const { event, deckForSeat } = buildTwoHumanEvent("event-1", 555);
        const aliceDeck = deckForSeat(0);
        const bobDeck = deckForSeat(1);

        // --- challengeLimitedSeat, in the mutation's exact order ---
        // 1. Both paired decks must be Limited decks bound to THIS event.
        expect(() =>
            assertSameEventDeck(aliceDeck.limitedEventId, event._id)
        ).not.toThrow();
        // 2. Challenger owns the seat they claim (authenticated id).
        expect(() =>
            assertLimitedSeatOwnership(event, aliceDeck.limitedSeatId!, "alice")
        ).not.toThrow();
        // 3. Target is a seated human opponent.
        const challenged = assertChallengeableSeat(event, 1, "alice");
        expect(challenged.userId).toBe("bob");
        // 4. Challenger's deck is legal against her own Pool.
        const aliceResolve = () =>
            resolvePoolFromEvent(event, aliceDeck.limitedSeatId!);
        expect(() =>
            assertDeckLegal(aliceDeck, undefined, undefined, aliceResolve)
        ).not.toThrow();

        // --- joinGame (Bob accepts), event-aware branch order ---
        // The waiting Game carries `limitedEventId = event._id` +
        // `limitedChallenge.challengedUserId = "bob"`. Bob is the addressed
        // opponent and his deck belongs to the same event.
        const challengeEventId = event._id;
        expect(() =>
            assertSameEventDeck(bobDeck.limitedEventId, challengeEventId)
        ).not.toThrow();
        const bobResolve = () =>
            resolvePoolFromEvent(event, bobDeck.limitedSeatId!);
        expect(() =>
            assertDeckLegal(bobDeck, undefined, undefined, bobResolve)
        ).not.toThrow();
    });

    it("rejects pairing a deck from a DIFFERENT event (server-side)", () => {
        const eventA = buildTwoHumanEvent("event-A", 111);
        const eventB = buildTwoHumanEvent("event-B", 222);
        // The challenge was created in event-A; Bob tries to accept with a deck
        // built in event-B — the cross-event pairing the AC forbids.
        const bobDeckFromB = eventB.deckForSeat(1);
        expect(() =>
            assertSameEventDeck(bobDeckFromB.limitedEventId, eventA.event._id)
        ).toThrow(/same Limited Event/);
    });

    it("a non-occupant cannot forge a challenge from another seat", () => {
        const { event, deckForSeat } = buildTwoHumanEvent("event-2", 999);
        const aliceDeck = deckForSeat(0);
        // An attacker naming Alice's seat id is rejected at the ownership gate
        // (same authority `userDecks.create`/`loadLimitedPoolResolver` use).
        expect(() =>
            assertLimitedSeatOwnership(
                event,
                aliceDeck.limitedSeatId!,
                "attacker"
            )
        ).toThrow(/do not occupy/);
    });

    // Full game-start gate through the REAL exported `loadLimitedPoolResolver`
    // (convex/game.ts) — the resolver both `challengeLimitedSeat` and
    // `joinGame` call before `assertDeckLegal`, driven with a stub ctx exactly
    // like `limitedDeckbuild.test.ts` does.
    it("resolves each seat's Pool for its REAL occupant at game start", async () => {
        const { event, deckForSeat } = buildTwoHumanEvent("event-3", 4242);
        const stubCtx = {
            db: { get: async () => event },
        } as unknown as MutationCtx;

        for (const seatIndex of [0, 1] as const) {
            const userId = seatIndex === 0 ? "alice" : "bob";
            const deck = deckForSeat(seatIndex);
            const resolver = await loadLimitedPoolResolver(
                stubCtx,
                {
                    limitedEventId: deck.limitedEventId,
                    limitedSeatId: deck.limitedSeatId,
                },
                userId
            );
            expect(resolver).toBeDefined();
            expect(resolver!({} as GateDeck)).toEqual(
                resolvePoolFromEvent(event, deck.limitedSeatId!)
            );
        }
    });
});
