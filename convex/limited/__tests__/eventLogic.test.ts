// Limited Event orchestration tests (PRD #1107, ADR 0054/0055, issue #1110).
// The project has no convex-test harness — these exercise the PURE
// decisions `convex/limitedEvents.ts`'s mutations are built from, exactly
// like `convex/__tests__/decks.test.ts` does for `decks.ts`.
import { describe, it, expect } from "vitest";
import { makeRng } from "../../gre/rng";
import {
    assignFreeSeat,
    buildEmptySeats,
    DEFAULT_SEALED_BOOSTER_COUNT,
    fillBotSeats,
    generateSealedPools,
    MAX_SEATS,
    MIN_SEATS,
    type GetBoosterConfig,
    type ResolveCardMeta,
} from "../eventLogic";
import type { BoosterConfig } from "../boosterTypes";

describe("buildEmptySeats (PRD #1107 story 2)", () => {
    it("builds seatCount empty seats, indexed from 0", () => {
        const seats = buildEmptySeats(4);
        expect(seats).toHaveLength(4);
        expect(seats.map((s) => s.seatIndex)).toEqual([0, 1, 2, 3]);
        for (const seat of seats) {
            expect(seat.userId).toBeUndefined();
            expect(seat.isBot).toBeUndefined();
            expect(seat.pool).toBeUndefined();
        }
    });

    it("accepts the boundary values 2 and 8", () => {
        expect(buildEmptySeats(MIN_SEATS)).toHaveLength(MIN_SEATS);
        expect(buildEmptySeats(MAX_SEATS)).toHaveLength(MAX_SEATS);
    });

    it("rejects a seatCount below the minimum", () => {
        expect(() => buildEmptySeats(1)).toThrow(/between 2 and 8/);
    });

    it("rejects a seatCount above the maximum", () => {
        expect(() => buildEmptySeats(9)).toThrow(/between 2 and 8/);
    });

    it("rejects a non-integer seatCount", () => {
        expect(() => buildEmptySeats(4.5)).toThrow();
    });
});

describe("assignFreeSeat (PRD #1107 story 7)", () => {
    it("claims the first free seat", () => {
        const seats = buildEmptySeats(3);
        const after = assignFreeSeat(seats, "user1", "Alice");
        expect(after[0]).toMatchObject({ userId: "user1", nickname: "Alice" });
        expect(after[1].userId).toBeUndefined();
        expect(after[2].userId).toBeUndefined();
    });

    it("claims the next free seat when the first is taken", () => {
        const seats = assignFreeSeat(buildEmptySeats(3), "user1", "Alice");
        const after = assignFreeSeat(seats, "user2", "Bob");
        expect(after[0].userId).toBe("user1");
        expect(after[1]).toMatchObject({ userId: "user2", nickname: "Bob" });
    });

    it("rejects a user who already holds a seat (no double-seating)", () => {
        const seats = assignFreeSeat(buildEmptySeats(3), "user1", "Alice");
        expect(() => assignFreeSeat(seats, "user1", "Alice")).toThrow(
            /already have a seat/
        );
    });

    it("rejects joining when every seat is taken", () => {
        let seats = buildEmptySeats(2);
        seats = assignFreeSeat(seats, "user1", "Alice");
        seats = assignFreeSeat(seats, "user2", "Bob");
        expect(() => assignFreeSeat(seats, "user3", "Carol")).toThrow(
            /No open seats/
        );
    });

    it("does not mutate the input array (pure)", () => {
        const seats = buildEmptySeats(2);
        const before = JSON.stringify(seats);
        assignFreeSeat(seats, "user1", "Alice");
        expect(JSON.stringify(seats)).toBe(before);
    });
});

describe("fillBotSeats (PRD #1107 story 8)", () => {
    it("fills every empty seat with a numbered bot", () => {
        let seats = buildEmptySeats(3);
        seats = assignFreeSeat(seats, "user1", "Alice");
        const after = fillBotSeats(seats);
        expect(after[0].userId).toBe("user1");
        expect(after[0].isBot).toBeUndefined();
        expect(after[1]).toMatchObject({ isBot: true, nickname: "Bot 2" });
        expect(after[2]).toMatchObject({ isBot: true, nickname: "Bot 3" });
    });

    it("leaves an already-human seat untouched", () => {
        const seats = assignFreeSeat(buildEmptySeats(2), "user1", "Alice");
        const after = fillBotSeats(seats);
        expect(after[0].userId).toBe("user1");
        expect(after[0].isBot).toBeUndefined();
    });

    it("is idempotent on an already-bot seat", () => {
        const once = fillBotSeats(buildEmptySeats(2));
        const twice = fillBotSeats(once);
        expect(twice).toEqual(once);
    });

    it("a fully-human table is untouched", () => {
        let seats = buildEmptySeats(2);
        seats = assignFreeSeat(seats, "user1", "Alice");
        seats = assignFreeSeat(seats, "user2", "Bob");
        const after = fillBotSeats(seats);
        expect(after.every((s) => !s.isBot)).toBe(true);
    });
});

// A tiny two-sheet, two-variant-free config: 3 commons + 1 rare per pack (so
// a single generateBooster call draws a deterministic, easy-to-assert count).
function tinyConfig(setCode = "tst"): BoosterConfig {
    return {
        setCode,
        boostersTotalWeight: 1,
        boosters: [{ contents: { common: 3, rare: 1 }, weight: 1 }],
        sheets: {
            common: {
                cards: { "common-a": 1, "common-b": 1 },
                totalWeight: 2,
            },
            rare: { cards: { "rare-a": 1 }, totalWeight: 1 },
        },
    };
}

const resolveCardMeta: ResolveCardMeta = (scryfallId) => ({
    cardId: scryfallId,
    cardName: scryfallId.toUpperCase(),
});

// `generateSealedPools` itself has no seat-count constraint — `buildEmptySeats`
// does (2-8, PRD #1107 story 2). A single-seat fixture for tests that only
// care about the generator's own behavior is built directly rather than
// routed through `buildEmptySeats(1)`, which would throw.
function oneSeat() {
    return [{ seatIndex: 0 }];
}

describe("generateSealedPools (ADR 0054/0055, PRD #1107 story 17)", () => {
    const getConfig: GetBoosterConfig = (setCode) =>
        setCode === "tst" ? tinyConfig() : null;

    it("generates boosterCount * (cards per booster) entries per seat", () => {
        const seats = buildEmptySeats(2);
        const rng = makeRng(42);
        const result = generateSealedPools(
            seats,
            ["tst"],
            DEFAULT_SEALED_BOOSTER_COUNT,
            getConfig,
            resolveCardMeta,
            rng
        );
        expect(result).toHaveLength(2);
        for (const seat of result) {
            // 4 cards/booster * 6 boosters = 24.
            expect(seat.pool).toHaveLength(4 * DEFAULT_SEALED_BOOSTER_COUNT);
            expect(seat.pool!.every((c) => c.cardId === c.scryfallId)).toBe(
                true
            );
        }
    });

    it("resolves each drawn card's canonical id/name via resolveCardMeta", () => {
        const seats = oneSeat();
        const rng = makeRng(7);
        const [seat] = generateSealedPools(
            seats,
            ["tst"],
            1,
            getConfig,
            resolveCardMeta,
            rng
        );
        expect(seat.pool).toHaveLength(4);
        for (const card of seat.pool!) {
            expect(card.cardName).toBe(card.scryfallId.toUpperCase());
        }
    });

    it("is deterministic: the same seed produces byte-identical pools", () => {
        const runOnce = () =>
            generateSealedPools(
                buildEmptySeats(3),
                ["tst"],
                DEFAULT_SEALED_BOOSTER_COUNT,
                getConfig,
                resolveCardMeta,
                makeRng(1234)
            );
        expect(runOnce()).toEqual(runOnce());
    });

    it("a different seed produces a different pool (sanity — not a hard requirement, but the generator isn't a constant function)", () => {
        const a = generateSealedPools(
            oneSeat(),
            ["tst"],
            DEFAULT_SEALED_BOOSTER_COUNT,
            getConfig,
            resolveCardMeta,
            makeRng(1)
        );
        const b = generateSealedPools(
            oneSeat(),
            ["tst"],
            DEFAULT_SEALED_BOOSTER_COUNT,
            getConfig,
            resolveCardMeta,
            makeRng(2)
        );
        expect(a).not.toEqual(b);
    });

    it("every seat (human and bot alike) receives a pool", () => {
        let seats = buildEmptySeats(3);
        seats = assignFreeSeat(seats, "user1", "Alice");
        seats = fillBotSeats(seats);
        const result = generateSealedPools(
            seats,
            ["tst"],
            2,
            getConfig,
            resolveCardMeta,
            makeRng(9)
        );
        expect(result.every((s) => s.pool && s.pool.length === 8)).toBe(true);
    });

    it("cycles packSlots across boosters", () => {
        const configsBySet: Record<string, BoosterConfig> = {
            tst: tinyConfig("tst"),
            oth: tinyConfig("oth"),
        };
        const getTwoSetConfig: GetBoosterConfig = (setCode) =>
            configsBySet[setCode] ?? null;
        // With 2 packSlots and boosterCount 2, one booster comes from each.
        const [seat] = generateSealedPools(
            oneSeat(),
            ["tst", "oth"],
            2,
            getTwoSetConfig,
            resolveCardMeta,
            makeRng(3)
        );
        expect(seat.pool).toHaveLength(8);
    });

    it("throws when packSlots is empty", () => {
        expect(() =>
            generateSealedPools(
                oneSeat(),
                [],
                1,
                getConfig,
                resolveCardMeta,
                makeRng(1)
            )
        ).toThrow(/packSlots is empty/);
    });

    it("throws when a packSlot references an unresolvable set", () => {
        expect(() =>
            generateSealedPools(
                oneSeat(),
                ["unknown-set"],
                1,
                getConfig,
                resolveCardMeta,
                makeRng(1)
            )
        ).toThrow(/no Booster Config/);
    });

    it("falls back to the raw scryfallId when resolveCardMeta can't resolve", () => {
        const unresolvable: ResolveCardMeta = () => null;
        const [seat] = generateSealedPools(
            oneSeat(),
            ["tst"],
            1,
            getConfig,
            unresolvable,
            makeRng(5)
        );
        for (const card of seat.pool!) {
            expect(card.cardId).toBe(card.scryfallId);
            expect(card.cardName).toBe(card.scryfallId);
        }
    });
});
