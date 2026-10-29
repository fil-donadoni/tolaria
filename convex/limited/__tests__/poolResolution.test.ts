// Limited deckbuilding: Pool resolution + seat ownership (PRD #1107, ADR
// 0054/0055, issue #1111). Pure-function tests for `poolResolution.ts`,
// mirroring the local-fixture-registry pattern in
// `convex/__tests__/formats.limited.test.ts` so this file stays
// self-contained and doesn't depend on the real card registry.
import { describe, it, expect } from "vitest";
import type { DeckCardMeta } from "../../cards";
import { indexPrintRows, makeResolveCardFromRows } from "../../cards/printRows";
import type { ResolveCard } from "../../formats";
import type { LimitedPoolCard } from "../eventTypes";
import {
    assertLimitedSeatOwnership,
    findPoolIntroductions,
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

// Issue #5473, ADR 0140 §5: a Limited deck entry's `cardId` is the opened
// PRINT (`definitionId` = the canonical Card ID). Pool membership resolves the
// deck side through the table rows — the registry alone cannot resolve a Print
// ID — exactly as `userDecks.listMine` and the game-start gate build it.
describe("resolveLimitedDeckLegality — print-keyed deck entries (issue #5473)", () => {
    const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt
    const TMP_BOLT_PRINT = "11111111-2222-4333-8444-555555555555";
    const seatPool = Array.from({ length: 40 }, () => ({
        scryfallId: TMP_BOLT_PRINT,
        cardId: BOLT,
        cardName: "Lightning Bolt",
    }));
    const deck = {
        cards: Array.from({ length: 40 }, () => ({
            cardId: TMP_BOLT_PRINT,
            cardName: "Lightning Bolt",
            definitionId: BOLT,
        })),
        sideboard: [],
    };

    it("is legal when the deck side resolves through the print rows", () => {
        const rows = makeResolveCardFromRows(
            indexPrintRows([
                {
                    printId: TMP_BOLT_PRINT,
                    cardId: BOLT,
                    set: "tmp",
                    rarity: "common",
                },
            ])
        );
        const { isLegal, reasons } = resolveLimitedDeckLegality(
            deck,
            seatPool,
            rows
        );
        expect(reasons).toEqual([]);
        expect(isLegal).toBe(true);
    });

    it("the registry alone cannot resolve the print: every entry reads as not granted", () => {
        const { isLegal, reasons } = resolveLimitedDeckLegality(deck, seatPool);
        expect(isLegal).toBe(false);
        expect(reasons.some((r) => r.code === "pool-not-granted")).toBe(true);
    });
});

describe("findPoolIntroductions — the edit guard (issue #2816)", () => {
    const card = (cardId: string) => ({ cardId, cardName: cardId });
    const pool = [poolCard("lea-bolt"), poolCard("lea-bolt")];
    const deck = (main: string[], side: string[] = []) => ({
        cards: main.map(card),
        sideboard: side.map(card),
    });
    const codes = (before: ReturnType<typeof deck>, after: typeof before) =>
        findPoolIntroductions(before, after, pool, resolve).map((r) => r.code);

    it("refuses a card the Pool never granted", () => {
        const before = deck(["lea-bolt"], ["lea-bolt"]);
        expect(
            codes(before, deck(["lea-bolt", "lea-giant"], ["lea-bolt"]))
        ).toEqual(["pool-not-granted"]);
    });

    it("refuses more copies than granted", () => {
        const before = deck(["lea-bolt"], ["lea-bolt"]);
        expect(
            codes(before, deck(["lea-bolt", "lea-bolt"], ["lea-bolt"]))
        ).toEqual(["pool-excess-copies"]);
    });

    it("accepts a zone move and a removal", () => {
        const before = deck(["lea-bolt"], ["lea-bolt"]);
        expect(codes(before, deck(["lea-bolt", "lea-bolt"]))).toEqual([]);
        expect(codes(before, deck(["lea-bolt"]))).toEqual([]);
    });

    it("accepts basics freely", () => {
        const before = deck(["lea-bolt"], ["lea-bolt"]);
        expect(
            codes(before, deck(["lea-bolt", "lea-plains"], ["lea-bolt"]))
        ).toEqual([]);
    });

    it("lets an already-illegal deck be edited back into legality", () => {
        const before = deck(["lea-bolt", "lea-giant"], ["lea-bolt"]);
        expect(codes(before, deck(["lea-bolt"], ["lea-bolt"]))).toEqual([]);
        // an untouched off-Pool card is not an introduction
        expect(
            codes(
                before,
                deck(["lea-bolt", "lea-giant", "lea-plains"], ["lea-bolt"])
            )
        ).toEqual([]);
    });

    it("refuses every introduction when the deck has no Pool", () => {
        const reasons = findPoolIntroductions(
            deck([]),
            deck(["lea-bolt"]),
            null,
            resolve
        );
        expect(reasons.map((r) => r.code)).toEqual(["pool-unresolved"]);
    });
});
