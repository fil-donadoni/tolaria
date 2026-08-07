// Pool-scoped deckbuilding: Basic land resolution (PRD #1107 story 18, ADR
// 0054/0055, issue #1111). Uses real LEA registry ids (mirrors
// `src/lib/__tests__/deckTypes.test.ts`'s pattern) so this exercises the real
// card registry, not a stub.
import { describe, it, expect } from "vitest";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import {
    applyBasicLandArtPreference,
    basicLandPrintings,
    countBasicLandCopies,
    findBasicLandRemovalIndex,
    isBasicLandCardId,
    legalBasicLandPrintings,
    recordBasicLandArtChoice,
    resolveBasicLandCardIds,
    resolveCanonicalBasicLandCardIds,
    rewriteBasicLandArt,
    rewriteBasicLandArtInDeck,
    seededBasicLandArt,
} from "../basicLands";

const BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const PLAINS = "b1623d57-4729-4796-b3f7-f1837a05c6ed";
const ISLAND = "90a57c0e-fa61-45ef-955d-d296403967d5";
const SWAMP = "6176936d-72e2-4205-8871-4c5a4f1cb2d8";
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";
// A real LEB Mountain PRINT id — a different id for the same definition.
const LEB_MOUNTAIN_PRINT = "7af9c715-8d72-4eae-b412-fc89138ff588";
// A real ICE Mountain PRINT id — used to exercise a printing that's a real
// registry entry but illegal under a Format that doesn't allow `ice`.
const ICE_MOUNTAIN_PRINT = "4ecf39c3-3b5f-4263-a7b5-9881bded3494";

function poolCard(cardId: string, cardName = cardId): LimitedPoolCard {
    return { scryfallId: cardId, cardId, cardName };
}

/** Manual in-memory `Storage` mock — mirrors the pattern established by
 *  `src/lib/__tests__/deckViewPrefs.test.ts` (a `Map` behind the `Storage`
 *  interface) rather than the real jsdom global. */
function makeStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() {
            return map.size;
        },
        clear: () => map.clear(),
        getItem: (key: string) => map.get(key) ?? null,
        key: (i: number) => Array.from(map.keys())[i] ?? null,
        removeItem: (key: string) => {
            map.delete(key);
        },
        setItem: (key: string, value: string) => {
            map.set(key, value);
        },
    };
}

describe("isBasicLandCardId", () => {
    it("is true for a Basic land, false for a nonbasic card", () => {
        expect(isBasicLandCardId(MOUNTAIN)).toBe(true);
        expect(isBasicLandCardId(BOLT_LEA)).toBe(false);
    });

    it("is false for an unresolvable id", () => {
        expect(isBasicLandCardId("not-a-real-card")).toBe(false);
    });
});

describe("resolveBasicLandCardIds (issue #1111/#1576: unlimited basics — pool printing preferred, catalogue fallback always available)", () => {
    it("prefers the Pool-sourced printing for a subtype the Pool opened", () => {
        const pool = [
            poolCard(BOLT_LEA, "Lightning Bolt"),
            poolCard(MOUNTAIN, "Mountain"),
            poolCard(FOREST, "Forest"),
        ];
        const result = resolveBasicLandCardIds(pool);
        expect(result.Mountain).toBe(MOUNTAIN);
        expect(result.Forest).toBe(FOREST);
        // Never opened in this Pool — falls back to the catalogue's own
        // canonical printing rather than staying null (issue #1576).
        expect(result.Plains).toBe(PLAINS);
        expect(result.Island).toBe(ISLAND);
        expect(result.Swamp).toBe(SWAMP);
    });

    it("resolves all five subtypes from the catalogue for a Pool with no basics at all (e.g. Vintage Cube, issue #1576)", () => {
        const result = resolveBasicLandCardIds([poolCard(BOLT_LEA)]);
        expect(result).toEqual({
            Plains: PLAINS,
            Island: ISLAND,
            Swamp: SWAMP,
            Mountain: MOUNTAIN,
            Forest: FOREST,
        });
        expect(Object.values(result).every((v) => v !== null)).toBe(true);
    });

    it("resolves all five subtypes from the catalogue for an empty Pool", () => {
        const result = resolveBasicLandCardIds([]);
        expect(Object.values(result).every((v) => v !== null)).toBe(true);
    });

    it("picks the FIRST matching copy — repeats of the same subtype don't change the resolved id", () => {
        const pool = [
            poolCard(MOUNTAIN, "Mountain"),
            poolCard(MOUNTAIN, "Mountain"),
        ];
        const result = resolveBasicLandCardIds(pool);
        expect(result.Mountain).toBe(MOUNTAIN);
    });
});

describe("resolveCanonicalBasicLandCardIds (issue #1627: Constructed has no Pool)", () => {
    it("resolves every subtype to the catalogue's canonical printing, unconditionally", () => {
        expect(resolveCanonicalBasicLandCardIds()).toEqual({
            Plains: PLAINS,
            Island: ISLAND,
            Swamp: SWAMP,
            Mountain: MOUNTAIN,
            Forest: FOREST,
        });
    });
});

describe("countBasicLandCopies (issue #1627: the bar's per-subtype Maindeck counter)", () => {
    it("counts copies of each Basic subtype and ignores non-Basic cards", () => {
        const cards = [
            { cardId: MOUNTAIN },
            { cardId: MOUNTAIN },
            { cardId: MOUNTAIN },
            { cardId: FOREST },
            { cardId: BOLT_LEA },
        ];
        expect(countBasicLandCopies(cards)).toEqual({
            Plains: 0,
            Island: 0,
            Swamp: 0,
            Mountain: 3,
            Forest: 1,
        });
    });

    it("returns all-zero counts for an empty or all-nonbasic Maindeck", () => {
        expect(countBasicLandCopies([])).toEqual({
            Plains: 0,
            Island: 0,
            Swamp: 0,
            Mountain: 0,
            Forest: 0,
        });
        expect(countBasicLandCopies([{ cardId: BOLT_LEA }])).toEqual({
            Plains: 0,
            Island: 0,
            Swamp: 0,
            Mountain: 0,
            Forest: 0,
        });
    });

    it("ignores an unresolvable cardId rather than throwing", () => {
        expect(() =>
            countBasicLandCopies([{ cardId: "not-a-real-card" }])
        ).not.toThrow();
        expect(countBasicLandCopies([{ cardId: "not-a-real-card" }])).toEqual({
            Plains: 0,
            Island: 0,
            Swamp: 0,
            Mountain: 0,
            Forest: 0,
        });
    });
});

// The remove half of the bar (issue #1627, PR #2320 review B1/NB1). Its whole
// job is to be the EXACT inverse of `countBasicLandCopies` above: whatever
// that function counted, this function must be able to take out.
describe("findBasicLandRemovalIndex", () => {
    it("matches by SUBTYPE, so a non-canonical PRINTING of the same basic is removable", () => {
        // The search grid adds by print id; `tryGetDefinition` resolves this
        // LEB print back to the Mountain definition, which is exactly why the
        // counter sees it and a `cardId === MOUNTAIN` match did not.
        const cards = [{ cardId: LEB_MOUNTAIN_PRINT }];
        expect(countBasicLandCopies(cards).Mountain).toBe(1);
        expect(findBasicLandRemovalIndex(cards, "Mountain")).toBe(0);
    });

    it("never crosses subtypes, and returns -1 when the zone holds none", () => {
        const cards = [{ cardId: PLAINS }, { cardId: BOLT_LEA }];
        expect(findBasicLandRemovalIndex(cards, "Mountain")).toBe(-1);
        expect(findBasicLandRemovalIndex([], "Plains")).toBe(-1);
        expect(findBasicLandRemovalIndex(cards, "Plains")).toBe(0);
    });

    it("prefers an UNPINNED copy over a pinned Pool copy (NB1: a bar remove must never strand a recorded Column)", () => {
        const cards = [
            { cardId: MOUNTAIN, pinKey: "0" },
            { cardId: LEB_MOUNTAIN_PRINT },
        ];
        expect(findBasicLandRemovalIndex(cards, "Mountain")).toBe(1);
    });

    it("scans from the END among unpinned copies — the most recently added one is the one given back", () => {
        const cards = [
            { cardId: MOUNTAIN },
            { cardId: BOLT_LEA },
            { cardId: MOUNTAIN },
        ];
        expect(findBasicLandRemovalIndex(cards, "Mountain")).toBe(2);
    });

    it("falls back to the last pinned copy when every copy is Pool-pinned", () => {
        const cards = [
            { cardId: MOUNTAIN, pinKey: "0" },
            { cardId: MOUNTAIN, pinKey: "1" },
        ];
        expect(findBasicLandRemovalIndex(cards, "Mountain")).toBe(1);
    });

    it("an explicitly named copy always wins — a TAP on a tile removes that tile, pinned or not", () => {
        const cards = [{ cardId: MOUNTAIN, pinKey: "0" }, { cardId: MOUNTAIN }];
        expect(findBasicLandRemovalIndex(cards, "Mountain", "0")).toBe(0);
    });
});

// The basic-land art picker (issue #1629, ADR 0075 § "Basic-land art"). Real
// registry printings — Mountain has 15 in the catalogue, distributed
// `lea×2, leb×3, ice×1, 2ed×3, 3ed×3, 4ed×3` (verified against
// `convex/cards/sets/**/colorless.ts`) — so the exact counts below are load-
// bearing, not arbitrary.
describe("basicLandPrintings / legalBasicLandPrintings (issue #1629 AC2/AC3)", () => {
    it("basicLandPrintings returns every printing of the subtype's canonical definition", () => {
        const printings = basicLandPrintings("Mountain");
        expect(printings).toHaveLength(15);
        expect(printings.map((p) => p.setCode).sort()).toEqual(
            [
                "lea",
                "lea",
                "leb",
                "leb",
                "leb",
                "ice",
                "2ed",
                "2ed",
                "2ed",
                "3ed",
                "3ed",
                "3ed",
                "4ed",
                "4ed",
                "4ed",
            ].sort()
        );
    });

    it("legalBasicLandPrintings with allowedSets: null offers every printing, unfiltered (AC3: no set restriction)", () => {
        expect(legalBasicLandPrintings("Mountain", null)).toEqual(
            basicLandPrintings("Mountain")
        );
    });

    it("legalBasicLandPrintings narrows to the Format's allowed sets", () => {
        const printings = legalBasicLandPrintings("Mountain", ["lea", "leb"]);
        expect(printings).toHaveLength(5); // 2 lea + 3 leb
        expect(
            printings.every((p) => p.setCode === "lea" || p.setCode === "leb")
        ).toBe(true);
    });

    it("returns an empty grid when the Format allows none of the subtype's sets", () => {
        expect(legalBasicLandPrintings("Mountain", ["rtr"])).toEqual([]);
    });
});

describe("applyBasicLandArtPreference (issue #1629 AC7/AC8: stored preference → Pool → catalogue precedence)", () => {
    it("a legal stored preference overrides the base resolution", () => {
        const base = resolveCanonicalBasicLandCardIds();
        const result = applyBasicLandArtPreference(
            base,
            { Mountain: LEB_MOUNTAIN_PRINT },
            null
        );
        expect(result.Mountain).toBe(LEB_MOUNTAIN_PRINT);
        // Every other subtype is untouched.
        expect(result.Plains).toBe(base.Plains);
        expect(result.Forest).toBe(base.Forest);
    });

    it("a preference illegal under the deck's Format falls back silently to the base resolution (AC8)", () => {
        const base = resolveCanonicalBasicLandCardIds();
        const result = applyBasicLandArtPreference(
            base,
            { Mountain: ICE_MOUNTAIN_PRINT },
            ["lea", "leb"] // ice not allowed
        );
        expect(result.Mountain).toBe(base.Mountain);
    });

    it("a stored preference that no longer resolves to any printing falls back silently (AC8)", () => {
        const base = resolveCanonicalBasicLandCardIds();
        const result = applyBasicLandArtPreference(
            base,
            { Mountain: "not-a-real-printing-anymore" },
            null
        );
        expect(result.Mountain).toBe(base.Mountain);
    });

    it("a preference for one subtype only never subs a printing of a DIFFERENT subtype's definition", () => {
        const base = resolveCanonicalBasicLandCardIds();
        // A Forest printing is never a legal Mountain preference — it simply
        // won't be found among Mountain's own printings.
        const result = applyBasicLandArtPreference(
            base,
            { Mountain: FOREST },
            null
        );
        expect(result.Mountain).toBe(base.Mountain);
    });

    it("with no preference at all (Limited, unset), the Pool-preferred base resolution wins unchanged — the existing heuristic is untouched", () => {
        const pool = [poolCard(LEB_MOUNTAIN_PRINT, "Mountain")];
        const base = resolveBasicLandCardIds(pool);
        expect(base.Mountain).toBe(LEB_MOUNTAIN_PRINT);
        const result = applyBasicLandArtPreference(base, {}, null);
        expect(result.Mountain).toBe(LEB_MOUNTAIN_PRINT);
    });
});

describe("rewriteBasicLandArt (issue #1629 AC5: retroactive rewrite, position + pinKey preserved)", () => {
    it("rewrites every copy of the named subtype, preserving array position and pinKey, leaving other entries untouched", () => {
        const cards = [
            { cardId: MOUNTAIN, cardName: "Mountain" },
            { cardId: BOLT_LEA, cardName: "Lightning Bolt", pinKey: "b1" },
            { cardId: LEB_MOUNTAIN_PRINT, cardName: "Mountain", pinKey: "m1" },
        ];
        const next = rewriteBasicLandArt(cards, "Mountain", ICE_MOUNTAIN_PRINT);
        expect(next).toEqual([
            { cardId: ICE_MOUNTAIN_PRINT, cardName: "Mountain" },
            { cardId: BOLT_LEA, cardName: "Lightning Bolt", pinKey: "b1" },
            { cardId: ICE_MOUNTAIN_PRINT, cardName: "Mountain", pinKey: "m1" },
        ]);
    });

    it("never crosses subtypes — a Forest rewrite leaves every Mountain copy untouched", () => {
        const cards = [
            { cardId: MOUNTAIN, cardName: "Mountain" },
            { cardId: FOREST, cardName: "Forest" },
        ];
        const next = rewriteBasicLandArt(cards, "Forest", "some-forest-print");
        expect(next).toEqual([
            { cardId: MOUNTAIN, cardName: "Mountain" },
            { cardId: "some-forest-print", cardName: "Forest" },
        ]);
    });

    it("returns the SAME array reference when the zone holds no copy of the subtype (no spurious save)", () => {
        const cards = [{ cardId: BOLT_LEA, cardName: "Lightning Bolt" }];
        expect(rewriteBasicLandArt(cards, "Mountain", ICE_MOUNTAIN_PRINT)).toBe(
            cards
        );
    });
});

describe("rewriteBasicLandArtInDeck (issue #1629 AC5: rewrites BOTH Maindeck and Sideboard)", () => {
    it("rewrites copies in both zones of the open deck", () => {
        const deck = {
            cards: [{ cardId: MOUNTAIN, cardName: "Mountain" }],
            sideboard: [
                { cardId: LEB_MOUNTAIN_PRINT, cardName: "Mountain" },
                { cardId: BOLT_LEA, cardName: "Lightning Bolt" },
            ],
        };
        const next = rewriteBasicLandArtInDeck(
            deck,
            "Mountain",
            ICE_MOUNTAIN_PRINT
        );
        expect(next.cards).toEqual([
            { cardId: ICE_MOUNTAIN_PRINT, cardName: "Mountain" },
        ]);
        expect(next.sideboard).toEqual([
            { cardId: ICE_MOUNTAIN_PRINT, cardName: "Mountain" },
            { cardId: BOLT_LEA, cardName: "Lightning Bolt" },
        ]);
    });

    it("deck size is unchanged by a rewrite (AC9: art never changes deck size)", () => {
        const deck = {
            cards: [
                { cardId: MOUNTAIN, cardName: "Mountain" },
                { cardId: BOLT_LEA, cardName: "Lightning Bolt" },
            ],
            sideboard: [{ cardId: FOREST, cardName: "Forest" }],
        };
        const next = rewriteBasicLandArtInDeck(
            deck,
            "Mountain",
            ICE_MOUNTAIN_PRINT
        );
        expect(next.cards).toHaveLength(deck.cards.length);
        expect(next.sideboard).toHaveLength(deck.sideboard.length);
    });
});

describe("seededBasicLandArt / recordBasicLandArtChoice (issue #1629, mirrors deckViewPrefs's storage discipline)", () => {
    it("seeds nothing for a subtype never chosen", () => {
        expect(seededBasicLandArt(makeStorage())).toEqual({});
    });

    it("round-trips a recorded choice back out for its own subtype only", () => {
        const storage = makeStorage();
        recordBasicLandArtChoice("Mountain", LEB_MOUNTAIN_PRINT, storage);
        expect(seededBasicLandArt(storage)).toEqual({
            Mountain: LEB_MOUNTAIN_PRINT,
        });
    });
});
