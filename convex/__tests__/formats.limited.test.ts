import { describe, it, expect } from "vitest";
import {
    assertDeckLegal,
    buildPool,
    checkPoolMembership,
    FORMAT_IDS,
    FORMAT_RULES,
    validateDeck,
    type DeckLegality,
    type Pool,
    type ResolveCard,
    type ResolvePool,
    type ValidatableDeck,
} from "../formats";
import type { DeckCard } from "../deckPresets";
import type { DeckCardMeta } from "../cards";
import { applySideboard, type MatchDeck } from "../matches";

// Limited: pool-scoped deck legality (ADR 0054/0055, issue #1109). A Limited
// deck carries its whole Pool — Maindeck >= 40 with unlimited basic lands
// added freely, and every unplayed Pool card in the Sideboard with NO 15-card
// cap. Legality compares the deck's multiset (minus basics) against the
// authoritative Pool stored on the seat; a client can never fabricate a pool
// because the Pool is injected via `ResolvePool`, never read from the deck
// itself. These tests live alongside the existing Old School/Alpha 40 format
// tests (`formats.test.ts`), per the issue's testing decision.

// A small deterministic in-memory card registry — mirrors the `POOL` fixture
// pattern in `formats.test.ts`, kept local so this file's fixtures are
// self-contained and don't leak into the (huge) shared suite.
const REGISTRY: Record<string, DeckCardMeta> = {
    "lea-bolt": {
        cardId: "lea-bolt",
        setCode: "lea",
        rarity: "common",
        isBasic: false,
    },
    "leb-giant": {
        cardId: "leb-giant",
        setCode: "leb",
        rarity: "uncommon",
        isBasic: false,
    },
    "drk-unpooled": {
        cardId: "drk-unpooled",
        setCode: "drk",
        rarity: "common",
        isBasic: false,
    },
    // Two deck-card ids collapsing to ONE canonical Card ID (an original +
    // reprint) — exercises "count by Card ID across printings" for pool
    // matching too, exactly like the shared suite's `shared-card` fixture.
    "lea-orig": {
        cardId: "canonical-shared",
        setCode: "lea",
        rarity: "rare",
        isBasic: false,
    },
    "leb-reprint": {
        cardId: "canonical-shared",
        setCode: "leb",
        rarity: "rare",
        isBasic: false,
    },
    mountain: {
        cardId: "mountain",
        setCode: "lea",
        rarity: "common",
        isBasic: true,
    },
};
const resolve: ResolveCard = (cardId) => REGISTRY[cardId] ?? null;

function card(cardId: string, cardName = cardId): DeckCard {
    return { cardId, cardName };
}
function repeat(cardId: string, n: number): DeckCard[] {
    return Array.from({ length: n }, () => card(cardId));
}

// A 40-card Pool: 35 Bolts + 5 Giants (no basics — a Pool never stores them).
const SEAT_POOL_CARDS: DeckCard[] = [
    ...repeat("lea-bolt", 35),
    ...repeat("leb-giant", 5),
];
const SEAT_POOL: Pool = buildPool(SEAT_POOL_CARDS, resolve);

/** A legal Limited deck for `SEAT_POOL`: the whole Pool re-partitioned across
 *  Maindeck (>= 40, padded with free basics) and Sideboard, referencing the
 *  seat. */
function legalLimitedDeck(): ValidatableDeck & { format: string } {
    return {
        format: "limited",
        limitedEventId: "event-1",
        limitedSeatId: "seat-1",
        cards: [...repeat("lea-bolt", 30), ...repeat("mountain", 10)], // 40
        sideboard: [...repeat("lea-bolt", 5), ...repeat("leb-giant", 5)],
    };
}

/** A `ResolvePool` that only resolves the one seat the fixtures use — any
 *  other/absent event+seat reference is unresolvable (`null`), exactly like a
 *  real seat-table lookup would report for an unknown seat. */
const resolveSeatPool: ResolvePool = (deck) =>
    deck.limitedEventId === "event-1" && deck.limitedSeatId === "seat-1"
        ? SEAT_POOL
        : null;

describe("FORMAT_RULES.limited registration (ADR 0054/0055, issue #1109)", () => {
    it("registers 'limited' without disturbing the other FormatIds", () => {
        expect(FORMAT_IDS).toContain("limited");
        expect([...FORMAT_IDS]).toEqual([
            "freeform",
            "alpha-40",
            "old-school",
            "premodern",
            "limited",
        ]);
    });

    it("is pool-scoped (no set list) with a 40-card minimum and no sideboard cap", () => {
        const meta = FORMAT_RULES.limited;
        expect(meta.label).toBe("Limited");
        expect(meta.allowedSets).toBeNull();
        expect(meta.minMain).toBe(40);
        expect(meta.maxSide).toBeNull();
    });

    it("leaves every other Format's metadata/validate untouched", () => {
        expect(FORMAT_RULES.freeform.minMain).toBe(0);
        expect(FORMAT_RULES["alpha-40"].minMain).toBe(40);
        expect(FORMAT_RULES["alpha-40"].maxSide).toBe(0);
        expect(FORMAT_RULES["old-school"].minMain).toBe(60);
        expect(FORMAT_RULES.premodern.minMain).toBe(60);
    });
});

describe("validateDeck('limited') — in-pool deck is legal (issue #1109)", () => {
    it("a deck whose whole Pool is re-partitioned across Main+Side, with free basics, is legal", () => {
        const deck = legalLimitedDeck();
        const legality: DeckLegality = validateDeck(
            deck,
            "limited",
            resolve,
            undefined,
            resolveSeatPool
        );
        expect(legality.isLegal).toBe(true);
        expect(legality.reasons).toEqual([]);
    });

    it("assertDeckLegal does not throw for the same legal deck", () => {
        const deck = { name: "Sealed Pool Deck", ...legalLimitedDeck() };
        expect(() =>
            assertDeckLegal(deck, resolve, undefined, resolveSeatPool)
        ).not.toThrow();
    });
});

describe("validateDeck('limited') — out-of-pool card is illegal (issue #1109)", () => {
    it("a card the seat's Pool never granted is rejected with a human-readable reason", () => {
        const deck = legalLimitedDeck();
        // Swap one Bolt in the sideboard for a card outside the Pool entirely
        // (the tamper case: a client fabricating a card).
        deck.sideboard = [
            ...repeat("lea-bolt", 4),
            ...repeat("leb-giant", 5),
            card("drk-unpooled", "Contraband"),
        ];
        const legality = validateDeck(
            deck,
            "limited",
            resolve,
            undefined,
            resolveSeatPool
        );
        expect(legality.isLegal).toBe(false);
        expect(legality.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "pool-not-granted",
                    message: expect.stringMatching(/not in this seat's pool/i),
                }),
            ])
        );
    });

    it("playing MORE copies of a granted card than the Pool holds is rejected", () => {
        const deck = legalLimitedDeck();
        // 31 Bolts in Main + 5 in Side = 36, but the Pool only grants 35.
        deck.cards = [...repeat("lea-bolt", 31), ...repeat("mountain", 9)]; // 40
        const legality = validateDeck(
            deck,
            "limited",
            resolve,
            undefined,
            resolveSeatPool
        );
        expect(legality.isLegal).toBe(false);
        expect(legality.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "pool-excess-copies" }),
            ])
        );
    });

    it("leaving a granted Pool card out of BOTH zones is rejected (the whole Pool must travel with the deck)", () => {
        const deck = legalLimitedDeck();
        // Drop one Giant from the sideboard entirely — the Pool grants 5, the
        // deck only places 4.
        deck.sideboard = [...repeat("lea-bolt", 5), ...repeat("leb-giant", 4)];
        const legality = validateDeck(
            deck,
            "limited",
            resolve,
            undefined,
            resolveSeatPool
        );
        expect(legality.isLegal).toBe(false);
        expect(legality.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "pool-card-unplaced" }),
            ])
        );
    });

    it("assertDeckLegal throws for a deck playing a card outside its seat's Pool", () => {
        const deck = legalLimitedDeck();
        deck.cards = [...repeat("drk-unpooled", 30), ...repeat("mountain", 10)];
        expect(() =>
            assertDeckLegal(
                { name: "Tampered Deck", ...deck },
                resolve,
                undefined,
                resolveSeatPool
            )
        ).toThrow(/not in this seat's pool/i);
    });

    it("reprints of the same card collapse to one Pool entry (count by canonical Card ID)", () => {
        const deck = legalLimitedDeck();
        // Pool must ALSO grant this card for the deck to be legal — prove the
        // reprint/original collapse on the Pool side too.
        const poolWithShared = buildPool(
            [...SEAT_POOL_CARDS, card("lea-orig", "Original")],
            resolve
        );
        deck.cards = [
            ...repeat("lea-bolt", 30),
            ...repeat("mountain", 9),
            card("leb-reprint", "Reprint"), // same canonical id as lea-orig
        ];
        const resolvePoolWithShared: ResolvePool = () => poolWithShared;
        const legality = validateDeck(
            deck,
            "limited",
            resolve,
            undefined,
            resolvePoolWithShared
        );
        expect(legality.isLegal).toBe(true);
    });
});

describe("validateDeck('limited') — basic-land exemption (issue #1109)", () => {
    it("unlimited basics are always legal regardless of the Pool", () => {
        const deck = legalLimitedDeck();
        // Replace 20 of the 30 Bolts with basics — Pool no longer needs to
        // grant them, and there is no cap on how many a deck may add.
        deck.cards = [...repeat("lea-bolt", 10), ...repeat("mountain", 30)]; // 40
        deck.sideboard = [...repeat("lea-bolt", 25), ...repeat("leb-giant", 5)];
        const legality = validateDeck(
            deck,
            "limited",
            resolve,
            undefined,
            resolveSeatPool
        );
        expect(legality.isLegal).toBe(true);
    });

    it("checkPoolMembership never counts basics on either side", () => {
        const deckAllBasics: ValidatableDeck = {
            cards: repeat("mountain", 100),
            sideboard: [],
        };
        expect(checkPoolMembership(deckAllBasics, SEAT_POOL, resolve)).toEqual(
            // Every non-basic Pool card is still unplaced — that's the ONLY
            // expected failure; no basic-related reason appears.
            expect.arrayContaining([
                expect.objectContaining({ code: "pool-card-unplaced" }),
            ])
        );
        const reasons = checkPoolMembership(deckAllBasics, SEAT_POOL, resolve);
        expect(reasons.some((r) => /mountain/i.test(r.message))).toBe(false);
    });
});

describe("validateDeck('limited') — maindeck minimum + no sideboard cap (issue #1109)", () => {
    it("rejects a maindeck under 40 cards", () => {
        const deck = legalLimitedDeck();
        deck.cards = deck.cards.slice(0, 39);
        deck.sideboard = [...(deck.sideboard ?? []), card("mountain")];
        const legality = validateDeck(
            deck,
            "limited",
            resolve,
            undefined,
            resolveSeatPool
        );
        expect(legality.isLegal).toBe(false);
        expect(legality.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "size-min" }),
            ])
        );
    });

    it("never caps the sideboard size", () => {
        // A huge Pool, entirely re-partitioned into a 40-card Main + a big
        // Sideboard — legal regardless of size.
        const bigPoolCards = repeat("lea-bolt", 200);
        const bigPool = buildPool(bigPoolCards, resolve);
        const deck: ValidatableDeck = {
            limitedEventId: "event-1",
            limitedSeatId: "seat-1",
            cards: repeat("lea-bolt", 40),
            sideboard: repeat("lea-bolt", 160),
        };
        const resolveBigPool: ResolvePool = () => bigPool;
        const legality = validateDeck(
            deck,
            "limited",
            resolve,
            undefined,
            resolveBigPool
        );
        expect(legality.isLegal).toBe(true);
    });
});

describe("validateDeck('limited') — a deck without a resolvable Pool is illegal (issue #1109 AC4)", () => {
    it("is illegal when no ResolvePool is injected at all (existing call sites are fail-closed)", () => {
        const deck = legalLimitedDeck();
        // No 4th argument — mirrors every EXISTING `assertDeckLegal` call site
        // in `convex/game.ts`, none of which pass a pool resolver yet.
        const legality = validateDeck(deck, "limited", resolve);
        expect(legality.isLegal).toBe(false);
        expect(legality.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "pool-unresolved" }),
            ])
        );
    });

    it("is illegal when the injected resolver can't find the seat (unknown event/seat reference)", () => {
        const deck = legalLimitedDeck();
        deck.limitedSeatId = "seat-does-not-exist";
        const legality = validateDeck(
            deck,
            "limited",
            resolve,
            undefined,
            resolveSeatPool
        );
        expect(legality.isLegal).toBe(false);
        expect(legality.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "pool-unresolved" }),
            ])
        );
    });

    it("is illegal when the deck carries no event/seat reference at all", () => {
        const deck: ValidatableDeck = {
            cards: repeat("lea-bolt", 40),
        };
        const legality = validateDeck(
            deck,
            "limited",
            resolve,
            undefined,
            resolveSeatPool
        );
        expect(legality.isLegal).toBe(false);
        expect(legality.reasons.some((r) => r.code === "pool-unresolved")).toBe(
            true
        );
    });

    it("assertDeckLegal rejects a limited deck at game creation when no Pool resolver is wired in yet", () => {
        const deck = { name: "New Limited Deck", ...legalLimitedDeck() };
        // Exactly how `createGame`/`joinGame`/`createSoloGame` call it today
        // (`convex/game.ts`): resolve + banlist only, no `resolvePool`.
        expect(() => assertDeckLegal(deck, resolve)).toThrow(
            /no resolvable limited pool/i
        );
    });
});

describe("buildPool — Pool construction from a flat card list (issue #1109)", () => {
    it("collapses reprints to one canonical Card ID and drops basics", () => {
        const pool = buildPool(
            [
                card("lea-orig", "Regrowth"),
                card("leb-reprint", "Regrowth"),
                card("mountain", "Mountain"),
            ],
            resolve
        );
        expect(pool.cards).toEqual([
            { cardId: "canonical-shared", cardName: "Regrowth", count: 2 },
        ]);
    });

    it("drops ids the registry can't resolve", () => {
        const pool = buildPool([card("nonexistent-card")], resolve);
        expect(pool.cards).toEqual([]);
    });
});

describe("Sideboarding across the pool boundary preserves Limited legality (issue #1109, ADR 0055)", () => {
    it("a legal Limited deck stays legal after a between-Games sideboard swap", () => {
        const legal = legalLimitedDeck();
        const matchDeck: MatchDeck = {
            id: "seat-1",
            name: "Sealed Deck",
            format: "limited",
            maindeck: legal.cards,
            sideboard: legal.sideboard ?? [],
        };

        // Confirm the PRE-swap deck validates legal.
        expect(
            validateDeck(
                {
                    ...legal,
                    cards: matchDeck.maindeck,
                    sideboard: matchDeck.sideboard,
                },
                "limited",
                resolve,
                undefined,
                resolveSeatPool
            ).isLegal
        ).toBe(true);

        // Re-partition: bring in 3 Giants from the Sideboard, send 3 Bolts out.
        const nextMaindeck: DeckCard[] = [
            ...repeat("lea-bolt", 27),
            ...repeat("mountain", 10),
            ...repeat("leb-giant", 3),
        ];
        const nextSideboard: DeckCard[] = [
            ...repeat("lea-bolt", 8),
            ...repeat("leb-giant", 2),
        ];
        const swapped = applySideboard(matchDeck, {
            maindeck: nextMaindeck,
            sideboard: nextSideboard,
        });

        // `applySideboard` only re-partitions the SAME combined pool (Match
        // invariant) — Limited legality (a DIFFERENT, Pool-vs-deck check)
        // must still hold after the swap, unchanged.
        const legality = validateDeck(
            {
                ...legal,
                cards: swapped.maindeck,
                sideboard: swapped.sideboard,
            },
            "limited",
            resolve,
            undefined,
            resolveSeatPool
        );
        expect(legality.isLegal).toBe(true);
        expect(legality.reasons).toEqual([]);
    });

    it("applySideboard itself rejects a swap that would change the combined pool (defense in depth)", () => {
        const matchDeck: MatchDeck = {
            id: "seat-1",
            name: "Sealed Deck",
            format: "limited",
            maindeck: repeat("lea-bolt", 30).concat(repeat("mountain", 10)),
            sideboard: repeat("lea-bolt", 5).concat(repeat("leb-giant", 5)),
        };
        expect(() =>
            applySideboard(matchDeck, {
                maindeck: matchDeck.maindeck,
                // Fabricates an extra card not in the original combined pool.
                sideboard: [
                    ...matchDeck.sideboard,
                    card("drk-unpooled", "Contraband"),
                ],
            })
        ).toThrow();
    });
});
