// Limited deckbuilding: Pool resolution + seat ownership (PRD #1107, ADR
// 0054/0055, issue #1111). Pure-function tests for `poolResolution.ts`,
// mirroring the local-fixture-registry pattern in
// `convex/__tests__/formats.limited.test.ts` so this file stays
// self-contained and doesn't depend on the real card registry.
import { describe, it, expect } from "vitest";
import type { DeckCardMeta } from "../../cards";
import type { ResolveCard } from "../../formats";
import type { LimitedPoolCard } from "../eventTypes";
import {
    assertLimitedSeatOwnership,
    findSeatPool,
    poolFromLimitedPoolCards,
    resolveLimitedDeckLegality,
    resolvePoolFromEvent,
    seatOwnedByUser,
    type SeatLookup,
} from "../poolResolution";

const REGISTRY: Record<string, DeckCardMeta> = {
    "lea-bolt": {
        cardId: "lea-bolt",
        setCode: "lea",
        rarity: "common",
        isBasic: false,
    },
    "lea-giant": {
        cardId: "lea-giant",
        setCode: "lea",
        rarity: "uncommon",
        isBasic: false,
    },
    "lea-plains": {
        cardId: "lea-plains",
        setCode: "lea",
        rarity: "common",
        isBasic: true,
    },
};
const resolve: ResolveCard = (cardId) => REGISTRY[cardId] ?? null;

function poolCard(cardId: string): LimitedPoolCard {
    return { scryfallId: cardId, cardId, cardName: cardId };
}

describe("poolFromLimitedPoolCards (ADR 0054/0055)", () => {
    it("groups opened physical cards into a canonical-id multiset", () => {
        const pool = poolFromLimitedPoolCards(
            [poolCard("lea-bolt"), poolCard("lea-bolt"), poolCard("lea-giant")],
            resolve
        );
        expect(pool.cards).toEqual(
            expect.arrayContaining([
                { cardId: "lea-bolt", cardName: "lea-bolt", count: 2 },
                { cardId: "lea-giant", cardName: "lea-giant", count: 1 },
            ])
        );
        expect(pool.cards).toHaveLength(2);
    });

    it("drops basics — a Pool never stores them, even though they were opened", () => {
        const pool = poolFromLimitedPoolCards(
            [
                poolCard("lea-bolt"),
                poolCard("lea-plains"),
                poolCard("lea-plains"),
            ],
            resolve
        );
        expect(pool.cards).toEqual([
            { cardId: "lea-bolt", cardName: "lea-bolt", count: 1 },
        ]);
    });
});

describe("seatOwnedByUser / findSeatPool", () => {
    const seats: SeatLookup[] = [
        { seatIndex: 0, userId: "user1", pool: [poolCard("lea-bolt")] },
        { seatIndex: 1, userId: "user2" },
        { seatIndex: 2 }, // bot / unclaimed
    ];

    it("is true only for the seat's real occupant", () => {
        expect(seatOwnedByUser(seats, 0, "user1")).toBe(true);
        expect(seatOwnedByUser(seats, 0, "user2")).toBe(false);
        expect(seatOwnedByUser(seats, 1, "user1")).toBe(false);
        expect(seatOwnedByUser(seats, 99, "user1")).toBe(false);
    });

    it("resolves the raw opened Pool for a seat, null when absent", () => {
        expect(findSeatPool(seats, 0)).toEqual([poolCard("lea-bolt")]);
        expect(findSeatPool(seats, 2)).toBeNull();
        expect(findSeatPool(seats, 99)).toBeNull();
    });
});

describe("assertLimitedSeatOwnership (issue #1111: never trust client seat id)", () => {
    const event = {
        seats: [{ seatIndex: 0, userId: "user1" }] as SeatLookup[],
    };

    it("passes for the real occupant", () => {
        expect(() =>
            assertLimitedSeatOwnership(event, "0", "user1")
        ).not.toThrow();
    });

    it("throws for a DIFFERENT user claiming someone else's seat", () => {
        expect(() => assertLimitedSeatOwnership(event, "0", "user2")).toThrow(
            /do not occupy/
        );
    });

    it("throws for a non-numeric seat id", () => {
        expect(() =>
            assertLimitedSeatOwnership(event, "not-a-number", "user1")
        ).toThrow(/do not occupy/);
    });

    it("throws when the event itself is unresolvable", () => {
        expect(() => assertLimitedSeatOwnership(null, "0", "user1")).toThrow(
            /Event not found/
        );
    });
});

describe("resolvePoolFromEvent", () => {
    const event = {
        seats: [
            {
                seatIndex: 0,
                userId: "user1",
                pool: [poolCard("lea-bolt"), poolCard("lea-plains")],
            },
        ] as SeatLookup[],
    };

    it("resolves the legality-side Pool (basics excluded)", () => {
        const pool = resolvePoolFromEvent(event, "0", resolve);
        expect(pool).toEqual({
            cards: [{ cardId: "lea-bolt", cardName: "lea-bolt", count: 1 }],
        });
    });

    it("is null for an unresolvable event", () => {
        expect(resolvePoolFromEvent(null, "0", resolve)).toBeNull();
    });

    it("is null for a seat with no Pool yet", () => {
        const notStarted = { seats: [{ seatIndex: 0, userId: "user1" }] };
        expect(resolvePoolFromEvent(notStarted, "0", resolve)).toBeNull();
    });
});

describe("resolveLimitedDeckLegality", () => {
    it("is illegal (pool-unresolved) when the seat has no Pool", () => {
        const { isLegal, reasons } = resolveLimitedDeckLegality(
            { cards: [], sideboard: [] },
            null,
            resolve
        );
        expect(isLegal).toBe(false);
        expect(reasons.some((r) => r.code === "pool-unresolved")).toBe(true);
    });

    it("is legal once the deck's non-basic cards exactly match the Pool and maindeck >= 40", () => {
        const seatPool: LimitedPoolCard[] = [
            ...Array.from({ length: 40 }, () => poolCard("lea-bolt")),
        ];
        const deck = {
            cards: Array.from({ length: 40 }, () => ({
                cardId: "lea-bolt",
                cardName: "lea-bolt",
            })),
            sideboard: [],
        };
        const { isLegal, reasons } = resolveLimitedDeckLegality(
            deck,
            seatPool,
            resolve
        );
        expect(reasons).toEqual([]);
        expect(isLegal).toBe(true);
    });

    it("flags a tampered card (not in the Pool) even with everything else legal", () => {
        const seatPool: LimitedPoolCard[] = Array.from({ length: 40 }, () =>
            poolCard("lea-bolt")
        );
        const deck = {
            cards: [
                ...Array.from({ length: 39 }, () => ({
                    cardId: "lea-bolt",
                    cardName: "lea-bolt",
                })),
                { cardId: "lea-giant", cardName: "lea-giant" }, // never granted
            ],
            sideboard: [],
        };
        const { isLegal, reasons } = resolveLimitedDeckLegality(
            deck,
            seatPool,
            resolve
        );
        expect(isLegal).toBe(false);
        expect(reasons.some((r) => r.code === "pool-not-granted")).toBe(true);
    });
});
