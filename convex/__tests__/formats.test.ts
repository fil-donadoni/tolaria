import { describe, it, expect } from "vitest";
import {
    assertDeckLegal,
    checkSets,
    checkSize,
    FORMAT_IDS,
    FORMAT_RULES,
    isFormatId,
    validateDeck,
    type FormatId,
    type ResolveCard,
    type ValidatableDeck,
} from "../formats";
import type { DeckCard } from "../deckPresets";
import { resolveDeckCardMeta, type DeckCardMeta } from "../cards";
import { normalizeLegacyFormat } from "../userDecks";

// Deck Formats — legality pipeline slice (PRD #509, ADR 0036, issue #512). The
// size + set-membership tracer bullet. These tests pin the registry metadata,
// the typed-Format boundary, the shared validation helpers, end-to-end
// validateDeck per Format, and the authoritative game-start gate.

// A deterministic in-memory card pool so the validator tests don't depend on
// the real registry (a separate block exercises the real resolver). Keyed by
// the cardId used in the test decks below.
const POOL: Record<string, DeckCardMeta> = {
    "lea-card": { setCode: "lea", rarity: "common", isBasic: false },
    "leb-card": { setCode: "leb", rarity: "common", isBasic: false },
    "drk-card": { setCode: "drk", rarity: "common", isBasic: false },
    "2ed-card": { setCode: "2ed", rarity: "common", isBasic: false },
    basic: { setCode: "lea", rarity: "common", isBasic: true },
};
const stubResolve: ResolveCard = (cardId) => POOL[cardId] ?? null;

function card(cardId: string, cardName = cardId): DeckCard {
    return { cardId, cardName };
}
function repeat(cardId: string, n: number): DeckCard[] {
    return Array.from({ length: n }, () => card(cardId));
}

const sampleDeck: ValidatableDeck = {
    cards: [card("lea-card", "Lightning Bolt"), card("basic", "Mountain")],
    sideboard: [card("lea-card", "Shatter")],
};

describe("FORMAT_IDS / FORMAT_RULES registry (ADR 0036)", () => {
    it("exposes exactly the three shipped Formats", () => {
        expect([...FORMAT_IDS]).toEqual(["freeform", "alpha-40", "old-school"]);
    });

    it("has a registry entry with a label for every FormatId", () => {
        for (const id of FORMAT_IDS) {
            expect(FORMAT_RULES[id]).toBeDefined();
            expect(typeof FORMAT_RULES[id].label).toBe("string");
            expect(FORMAT_RULES[id].label.length).toBeGreaterThan(0);
        }
    });

    it("carries the documented size/set metadata for the non-trivial Formats", () => {
        // Freeform: unconstrained.
        expect(FORMAT_RULES.freeform.allowedSets).toBeNull();
        expect(FORMAT_RULES.freeform.minMain).toBe(0);
        expect(FORMAT_RULES.freeform.maxSide).toBeNull();
        // Alpha 40: lea/leb, >=40 main, no sideboard.
        expect(FORMAT_RULES["alpha-40"].allowedSets).toEqual(["lea", "leb"]);
        expect(FORMAT_RULES["alpha-40"].minMain).toBe(40);
        expect(FORMAT_RULES["alpha-40"].maxSide).toBe(0);
        // Old School: six eternal sets, >=60 main, <=15 sideboard.
        expect(FORMAT_RULES["old-school"].minMain).toBe(60);
        expect(FORMAT_RULES["old-school"].maxSide).toBe(15);
        expect(FORMAT_RULES["old-school"].allowedSets).toContain("arn");
    });
});

describe("isFormatId — typed boundary guard (ADR 0036)", () => {
    it("accepts every shipped FormatId", () => {
        for (const id of FORMAT_IDS) expect(isFormatId(id)).toBe(true);
    });

    it("rejects legacy and unknown strings", () => {
        expect(isFormatId("Freeform")).toBe(false); // legacy capitalized value
        expect(isFormatId("vintage")).toBe(false);
        expect(isFormatId("")).toBe(false);
    });
});

describe("checkSize — maindeck minimum + sideboard maximum (ADR 0036)", () => {
    it("flags an under-size maindeck with a precise reason", () => {
        const deck: ValidatableDeck = { cards: repeat("lea-card", 59) };
        const reasons = checkSize(deck, FORMAT_RULES["old-school"]);
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe("size-min");
        expect(reasons[0].message).toContain("59");
        expect(reasons[0].message).toContain("60");
    });

    it("accepts a maindeck at exactly the minimum", () => {
        const deck: ValidatableDeck = { cards: repeat("lea-card", 60) };
        expect(checkSize(deck, FORMAT_RULES["old-school"])).toEqual([]);
    });

    it("flags an over-size sideboard", () => {
        const deck: ValidatableDeck = {
            cards: repeat("lea-card", 60),
            sideboard: repeat("lea-card", 16),
        };
        const reasons = checkSize(deck, FORMAT_RULES["old-school"]);
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe("size-max-side");
        expect(reasons[0].message).toContain("16");
    });

    it("treats any sideboard as a breach when maxSide is 0 (no-sideboard formats)", () => {
        const deck: ValidatableDeck = {
            cards: repeat("lea-card", 40),
            sideboard: [card("lea-card")],
        };
        const reasons = checkSize(deck, FORMAT_RULES["alpha-40"]);
        expect(reasons.map((r) => r.code)).toContain("size-max-side");
        expect(reasons[0].message.toLowerCase()).toContain("no sideboard");
    });

    it("imposes no bounds for Freeform", () => {
        const deck: ValidatableDeck = {
            cards: [card("lea-card")],
            sideboard: repeat("lea-card", 99),
        };
        expect(checkSize(deck, FORMAT_RULES.freeform)).toEqual([]);
    });
});

describe("checkSets — set membership + Basic exemption (ADR 0036)", () => {
    it("accepts any set for an allowedSets === null Format (Freeform)", () => {
        const deck: ValidatableDeck = {
            cards: [card("drk-card"), card("2ed-card")],
        };
        expect(checkSets(deck, FORMAT_RULES.freeform, stubResolve)).toEqual([]);
    });

    it("flags a card whose print set is not allowed", () => {
        const deck: ValidatableDeck = {
            cards: [card("lea-card"), card("2ed-card", "Reprint")],
        };
        const reasons = checkSets(
            deck,
            FORMAT_RULES["old-school"],
            stubResolve
        );
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe("set-not-allowed");
        expect(reasons[0].message).toContain("Reprint");
        expect(reasons[0].message).toContain("2ed");
    });

    it("never trips on a Basic land regardless of set list", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("basic", 20), card("lea-card")],
        };
        expect(checkSets(deck, FORMAT_RULES["alpha-40"], stubResolve)).toEqual(
            []
        );
    });

    it("checks the sideboard too", () => {
        const deck: ValidatableDeck = {
            cards: [card("lea-card")],
            sideboard: [card("drk-card", "Squire")],
        };
        const reasons = checkSets(deck, FORMAT_RULES["alpha-40"], stubResolve);
        expect(reasons.some((r) => r.message.includes("Squire"))).toBe(true);
    });

    it("de-duplicates by card id (a 4-of disallowed card yields one reason)", () => {
        const deck: ValidatableDeck = { cards: repeat("2ed-card", 4) };
        const reasons = checkSets(
            deck,
            FORMAT_RULES["old-school"],
            stubResolve
        );
        expect(reasons).toHaveLength(1);
    });

    it("flags an id the registry can't resolve as out-of-pool", () => {
        const deck: ValidatableDeck = {
            cards: [card("ghost-card", "Phantom")],
        };
        const reasons = checkSets(
            deck,
            FORMAT_RULES["old-school"],
            stubResolve
        );
        expect(reasons[0].code).toBe("set-unknown");
        expect(reasons[0].message).toContain("Phantom");
    });
});

describe("validateDeck — end-to-end per Format (issue #512)", () => {
    it("Freeform reports every deck legal with no reasons", () => {
        const deck: ValidatableDeck = {
            cards: [card("drk-card"), card("2ed-card")],
            sideboard: repeat("lea-card", 30),
        };
        expect(validateDeck(deck, "freeform", stubResolve)).toEqual({
            isLegal: true,
            reasons: [],
        });
    });

    it("Old School: a legal 60-card lea/leb deck (with basics + a sideboard) is legal", () => {
        const deck: ValidatableDeck = {
            cards: [
                ...repeat("lea-card", 36),
                ...repeat("leb-card", 4),
                ...repeat("drk-card", 0), // none
                ...repeat("basic", 20),
            ],
            sideboard: repeat("leb-card", 15),
        };
        expect(deck.cards).toHaveLength(60);
        expect(validateDeck(deck, "old-school", stubResolve).isLegal).toBe(
            true
        );
    });

    it("Old School: under-size + disallowed set report BOTH reasons", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("lea-card", 39), card("2ed-card", "Reprint")],
        };
        const { isLegal, reasons } = validateDeck(
            deck,
            "old-school",
            stubResolve
        );
        expect(isLegal).toBe(false);
        const codes = reasons.map((r) => r.code);
        expect(codes).toContain("size-min");
        expect(codes).toContain("set-not-allowed");
    });

    it("Alpha 40: 40 lea cards is legal; a 39-card deck or a sideboard is not", () => {
        const legal: ValidatableDeck = { cards: repeat("lea-card", 40) };
        expect(validateDeck(legal, "alpha-40", stubResolve).isLegal).toBe(true);

        const small: ValidatableDeck = { cards: repeat("lea-card", 39) };
        expect(
            validateDeck(small, "alpha-40", stubResolve).reasons.map(
                (r) => r.code
            )
        ).toContain("size-min");

        const sideboarded: ValidatableDeck = {
            cards: repeat("lea-card", 40),
            sideboard: [card("lea-card")],
        };
        expect(
            validateDeck(sideboarded, "alpha-40", stubResolve).reasons.map(
                (r) => r.code
            )
        ).toContain("size-max-side");
    });

    it("Alpha 40: a drk card (legal in Old School) is rejected", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("lea-card", 39), card("drk-card", "Squire")],
        };
        const { isLegal, reasons } = validateDeck(
            deck,
            "alpha-40",
            stubResolve
        );
        expect(isLegal).toBe(false);
        expect(reasons.some((r) => r.code === "set-not-allowed")).toBe(true);
    });

    it("defends an unknown format by falling back to Freeform (legal)", () => {
        const result = validateDeck(
            sampleDeck,
            "made-up" as FormatId,
            stubResolve
        );
        expect(result.isLegal).toBe(true);
        expect(result.reasons).toEqual([]);
    });
});

describe("validateDeck — wired to the REAL card registry (ADR 0036)", () => {
    // Real ids from sets/lea.ts, sets/drk.ts and the 2ed reprint module.
    const BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
    const BOLT_2ED = "ff1b8fc5-604a-4449-a73d-861e53642a70";
    const SQUIRE_DRK = "374df061-ebd2-4f1f-9a6e-7940a49197a9";
    const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

    it("the default resolver is the real registry resolver", () => {
        // A 60-card Old School deck of real lea cards + basics is legal with no
        // resolve override — the production path.
        const deck: ValidatableDeck = {
            cards: [
                ...Array.from({ length: 40 }, () =>
                    card(BOLT_LEA, "Lightning Bolt")
                ),
                ...Array.from({ length: 20 }, () => card(MOUNTAIN, "Mountain")),
            ],
        };
        expect(validateDeck(deck, "old-school").isLegal).toBe(true);
    });

    it("rejects a 2ed reprint in Old School via the real resolver", () => {
        const deck: ValidatableDeck = {
            cards: [
                ...Array.from({ length: 59 }, () =>
                    card(BOLT_LEA, "Lightning Bolt")
                ),
                card(BOLT_2ED, "Lightning Bolt (2ED)"),
            ],
        };
        const reasons = validateDeck(deck, "old-school").reasons;
        expect(reasons.some((r) => r.code === "set-not-allowed")).toBe(true);
    });

    it("accepts the drk card in Old School but rejects it in Alpha 40", () => {
        const main = Array.from({ length: 59 }, () =>
            card(BOLT_LEA, "Lightning Bolt")
        );
        const old: ValidatableDeck = { cards: [...main, card(SQUIRE_DRK)] };
        expect(validateDeck(old, "old-school").isLegal).toBe(true);
        const alpha: ValidatableDeck = {
            cards: [
                ...Array.from({ length: 39 }, () => card(BOLT_LEA)),
                card(SQUIRE_DRK, "Squire"),
            ],
        };
        expect(
            validateDeck(alpha, "alpha-40").reasons.some(
                (r) => r.code === "set-not-allowed"
            )
        ).toBe(true);
    });

    it("resolveDeckCardMeta exempts real Basic lands from the set check", () => {
        expect(resolveDeckCardMeta(MOUNTAIN)?.isBasic).toBe(true);
    });
});

describe("assertDeckLegal — authoritative game-start gate (ADR 0036)", () => {
    it("passes a legal deck silently", () => {
        const deck = {
            name: "Burn",
            format: "alpha-40",
            cards: repeat("lea-card", 40),
        };
        expect(() => assertDeckLegal(deck, stubResolve)).not.toThrow();
    });

    it("throws with every reason for an illegal deck", () => {
        const deck = {
            name: "Sketchy",
            format: "old-school",
            cards: [...repeat("lea-card", 39), card("2ed-card", "Reprint")],
        };
        expect(() => assertDeckLegal(deck, stubResolve)).toThrow(/Sketchy/);
        expect(() => assertDeckLegal(deck, stubResolve)).toThrow(/Old School/);
        expect(() => assertDeckLegal(deck, stubResolve)).toThrow(/minimum/);
        expect(() => assertDeckLegal(deck, stubResolve)).toThrow(/2ed/);
    });

    it("treats a Freeform deck of any contents as legal", () => {
        const deck = {
            name: "Anything",
            format: "freeform",
            cards: [card("drk-card"), card("2ed-card")],
            sideboard: repeat("lea-card", 99),
        };
        expect(() => assertDeckLegal(deck, stubResolve)).not.toThrow();
    });

    it("falls back to Freeform (legal) for a raw/unknown format string", () => {
        const deck = {
            name: "Legacy",
            format: "Freeform", // legacy capitalized string
            cards: repeat("2ed-card", 1),
        };
        expect(() => assertDeckLegal(deck, stubResolve)).not.toThrow();
    });
});

describe("validateDeck — empty deck legality", () => {
    it("treats an empty deck as legal under Freeform", () => {
        const empty: ValidatableDeck = { cards: [] };
        expect(validateDeck(empty, "freeform", stubResolve).isLegal).toBe(true);
    });

    it("treats an empty deck as ILLEGAL (under-size) under the constructed formats", () => {
        const empty: ValidatableDeck = { cards: [] };
        expect(validateDeck(empty, "alpha-40", stubResolve).isLegal).toBe(
            false
        );
        expect(validateDeck(empty, "old-school", stubResolve).isLegal).toBe(
            false
        );
    });
});

describe("normalizeLegacyFormat — migration (ADR 0036)", () => {
    it("maps the legacy 'Freeform' string to 'freeform'", () => {
        expect(normalizeLegacyFormat("Freeform")).toBe("freeform");
    });

    it("passes an already-typed FormatId through unchanged (idempotent)", () => {
        for (const id of FORMAT_IDS) {
            expect(normalizeLegacyFormat(id)).toBe(id);
        }
    });

    it("falls back to 'freeform' for any unrecognized value (never lost)", () => {
        expect(normalizeLegacyFormat("Vintage")).toBe("freeform");
        expect(normalizeLegacyFormat("")).toBe("freeform");
    });

    it("migrates a mixed table of rows without losing any (models migrateLegacyFormats)", () => {
        const rows = [
            { _id: "a", format: "Freeform" },
            { _id: "b", format: "freeform" },
            { _id: "c", format: "old-school" },
            { _id: "d", format: "Legacy junk" },
        ];
        let migrated = 0;
        let unchanged = 0;
        const after = rows.map((row) => {
            const normalized = normalizeLegacyFormat(row.format);
            if (normalized === row.format) unchanged++;
            else migrated++;
            return { ...row, format: normalized };
        });
        expect(after).toHaveLength(rows.length);
        expect(migrated).toBe(2);
        expect(unchanged).toBe(2);
        for (const row of after) expect(isFormatId(row.format)).toBe(true);
        expect(after.map((r) => r.format)).toEqual([
            "freeform",
            "freeform",
            "old-school",
            "freeform",
        ]);
    });
});
