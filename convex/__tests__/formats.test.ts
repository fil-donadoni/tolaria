import { describe, it, expect } from "vitest";
import {
    assertDeckLegal,
    checkAlpha40CopyCaps,
    checkBanned,
    checkCategoryBudgets,
    checkCopyLimit,
    checkRestricted,
    checkSets,
    checkSize,
    FORMAT_IDS,
    FORMAT_RULES,
    isFormatId,
    OLD_SCHOOL_BANNED,
    OLD_SCHOOL_RESTRICTED,
    validateDeck,
    type BanlistOverride,
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
// Each entry's canonical `cardId` defaults to its own key (one printing). The
// REPRINT entries below deliberately share a canonical id with their original
// to exercise "count by Card ID across printings". `restricted-card` /
// `banned-card` are stub ids the per-format list overrides target in tests.
const POOL: Record<string, DeckCardMeta> = {
    "lea-card": {
        cardId: "lea-card",
        setCode: "lea",
        rarity: "common",
        isBasic: false,
    },
    "leb-card": {
        cardId: "leb-card",
        setCode: "leb",
        rarity: "common",
        isBasic: false,
    },
    "drk-card": {
        cardId: "drk-card",
        setCode: "drk",
        rarity: "common",
        isBasic: false,
    },
    "2ed-card": {
        cardId: "2ed-card",
        setCode: "2ed",
        rarity: "common",
        isBasic: false,
    },
    "3ed-card": {
        cardId: "3ed-card",
        setCode: "3ed",
        rarity: "common",
        isBasic: false,
    },
    // A set that is NOT in any format's allowedSets (4th Edition is post-93/94),
    // used to exercise the set-not-allowed path now that 2ed and 3ed are
    // Old-School-legal.
    "4ed-card": {
        cardId: "4ed-card",
        setCode: "4ed",
        rarity: "common",
        isBasic: false,
    },
    basic: {
        cardId: "basic",
        setCode: "lea",
        rarity: "common",
        isBasic: true,
    },
    // Two distinct deck-card ids (an "original" and a "reprint") that collapse
    // to ONE canonical Card ID — the shared copy/restricted budget.
    "lea-orig": {
        cardId: "shared-card",
        setCode: "lea",
        rarity: "rare",
        isBasic: false,
    },
    "leb-reprint": {
        cardId: "shared-card",
        setCode: "leb",
        rarity: "rare",
        isBasic: false,
    },
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
    it("exposes exactly the four shipped Formats", () => {
        expect([...FORMAT_IDS]).toEqual([
            "freeform",
            "alpha-40",
            "old-school",
            "premodern",
        ]);
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
        // Premodern: 4th Edition → Scourge + Portal, >=60 main, <=15 sideboard.
        expect(FORMAT_RULES["premodern"].minMain).toBe(60);
        expect(FORMAT_RULES["premodern"].maxSide).toBe(15);
        expect(FORMAT_RULES["premodern"].allowedSets).toContain("scg");
        expect(FORMAT_RULES["premodern"].allowedSets).toContain("tmp");
        // Pre-4th-Edition sets are OUT of the Premodern pool.
        expect(FORMAT_RULES["premodern"].allowedSets).not.toContain("lea");
        expect(FORMAT_RULES["premodern"].allowedSets).not.toContain("arn");
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

describe("Premodern validator (ADR 0036)", () => {
    // A Premodern-scoped pool: a legal-set card, a pre-4th (out-of-pool) card,
    // a basic, and a banned-by-id card printed in a Premodern-legal set.
    const PM_POOL: Record<string, DeckCardMeta> = {
        "scg-card": {
            cardId: "scg-card",
            setCode: "scg",
            rarity: "common",
            isBasic: false,
        },
        "lea-card": {
            cardId: "lea-card",
            setCode: "lea", // pre-4th: out of the Premodern pool
            rarity: "common",
            isBasic: false,
        },
        island: {
            cardId: "island",
            setCode: "scg",
            rarity: "common",
            isBasic: true,
        },
        // Necropotence's canonical id — on PREMODERN_BANNED, printed in ice.
        "necro-print": {
            cardId: "54d7a0c1-efb4-4a8d-ad92-a96d43835052",
            setCode: "ice",
            rarity: "rare",
            isBasic: false,
        },
    };
    const pmResolve: ResolveCard = (id) => PM_POOL[id] ?? null;

    it("passes a legal 60-card Premodern deck", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("scg-card", 4), ...repeat("island", 56)],
        };
        expect(validateDeck(deck, "premodern", pmResolve).isLegal).toBe(true);
    });

    it("rejects a pre-4th-Edition (out-of-pool) card by set", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("lea-card", 4), ...repeat("island", 56)],
        };
        const { isLegal, reasons } = validateDeck(deck, "premodern", pmResolve);
        expect(isLegal).toBe(false);
        expect(reasons.some((r) => r.code === "set-not-allowed")).toBe(true);
    });

    it("bans a card on the banlist by Card ID across printings", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("necro-print", 1), ...repeat("island", 59)],
        };
        const { isLegal, reasons } = validateDeck(deck, "premodern", pmResolve);
        expect(isLegal).toBe(false);
        expect(reasons.some((r) => r.code === "banned")).toBe(true);
    });

    it("enforces the 4-copy limit and has no restricted list", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("scg-card", 5), ...repeat("island", 55)],
        };
        const { reasons } = validateDeck(deck, "premodern", pmResolve);
        expect(reasons.some((r) => r.code === "copy-limit")).toBe(true);
        expect(reasons.some((r) => r.code === "restricted")).toBe(false);
    });
});

// --- Injected banlist override (issue #1140, PRD #1138) -------------------
//
// `validateDeck` / `assertDeckLegal` accept an optional `banlist` of Card ID
// sets that OVERRIDES the code-side constants (`PREMODERN_BANNED`,
// `OLD_SCHOOL_BANNED`, `OLD_SCHOOL_RESTRICTED`) for the formats that read
// them. Absent the arg, behavior is identical to today — the code constants
// are the seed/fallback. These tests exercise BOTH paths against a stub pool
// so they never depend on the real registry contents changing underneath.
describe("validateDeck / assertDeckLegal — injected banlist override (issue #1140)", () => {
    // A Premodern-legal-set pool: a plain playable card + a basic, neither of
    // which sits on PREMODERN_BANNED — so any rejection below must come from
    // the injected override, not the code fallback.
    const PM_POOL: Record<string, DeckCardMeta> = {
        "scg-card": {
            cardId: "scg-card",
            setCode: "scg",
            rarity: "common",
            isBasic: false,
        },
        island: { cardId: "island", setCode: "scg", rarity: "common", isBasic: true },
    };
    const pmResolve: ResolveCard = (id) => PM_POOL[id] ?? null;

    function premodernDeck(bannedCopies: number): ValidatableDeck {
        return {
            cards: [
                ...repeat("scg-card", bannedCopies),
                ...repeat("island", 60 - bannedCopies),
            ],
        };
    }

    it("Premodern: an injected banned set rejects a card absent from PREMODERN_BANNED", () => {
        const deck = premodernDeck(1);
        // No override → legal (scg-card is not code-banned).
        expect(validateDeck(deck, "premodern", pmResolve).isLegal).toBe(true);

        // With an injected override banning scg-card → rejected, precise code.
        const banlist: BanlistOverride = {
            banned: new Set(["scg-card"]),
            restricted: new Set(),
        };
        const result = validateDeck(deck, "premodern", pmResolve, banlist);
        expect(result.isLegal).toBe(false);
        expect(result.reasons.some((r) => r.code === "banned")).toBe(true);
    });

    it("Old School: an injected restricted set caps a card absent from OLD_SCHOOL_RESTRICTED", () => {
        const osPool: Record<string, DeckCardMeta> = {
            "lea-card": {
                cardId: "lea-card",
                setCode: "lea",
                rarity: "common",
                isBasic: false,
            },
            basic: {
                cardId: "basic",
                setCode: "lea",
                rarity: "common",
                isBasic: true,
            },
        };
        const osResolve: ResolveCard = (id) => osPool[id] ?? null;
        const deck: ValidatableDeck = {
            cards: [...repeat("lea-card", 2), ...repeat("basic", 58)],
        };

        // No override → legal (lea-card is not code-restricted in this pool).
        expect(validateDeck(deck, "old-school", osResolve).isLegal).toBe(true);

        const banlist: BanlistOverride = {
            banned: new Set(),
            restricted: new Set(["lea-card"]),
        };
        const result = validateDeck(deck, "old-school", osResolve, banlist);
        expect(result.isLegal).toBe(false);
        expect(result.reasons.some((r) => r.code === "restricted")).toBe(true);
    });

    it("Old School: an injected banned set rejects a card absent from OLD_SCHOOL_BANNED", () => {
        const osPool: Record<string, DeckCardMeta> = {
            "lea-card": {
                cardId: "lea-card",
                setCode: "lea",
                rarity: "common",
                isBasic: false,
            },
            basic: {
                cardId: "basic",
                setCode: "lea",
                rarity: "common",
                isBasic: true,
            },
        };
        const osResolve: ResolveCard = (id) => osPool[id] ?? null;
        const deck: ValidatableDeck = {
            cards: [card("lea-card"), ...repeat("basic", 59)],
        };
        const banlist: BanlistOverride = {
            banned: new Set(["lea-card"]),
            restricted: new Set(),
        };
        const result = validateDeck(deck, "old-school", osResolve, banlist);
        expect(result.isLegal).toBe(false);
        expect(result.reasons.some((r) => r.code === "banned")).toBe(true);
    });

    it("with no injected banlist, the code constants are used (fallback unchanged)", () => {
        // Necropotence is on PREMODERN_BANNED by real Card ID; no override
        // supplied, so the code constant must still catch it.
        const pool: Record<string, DeckCardMeta> = {
            ...PM_POOL,
            "necro-print": {
                cardId: "54d7a0c1-efb4-4a8d-ad92-a96d43835052", // on PREMODERN_BANNED
                setCode: "ice",
                rarity: "rare",
                isBasic: false,
            },
        };
        const resolve: ResolveCard = (id) => pool[id] ?? null;
        const deck: ValidatableDeck = {
            cards: [card("necro-print"), ...repeat("island", 59)],
        };
        const result = validateDeck(deck, "premodern", resolve);
        expect(result.isLegal).toBe(false);
        expect(result.reasons.some((r) => r.code === "banned")).toBe(true);
    });

    it("assertDeckLegal threads the injected banlist through and throws with the precise reason", () => {
        const deck = {
            name: "Injected Banlist Deck",
            format: "premodern",
            cards: premodernDeck(1).cards,
        };
        const banlist: BanlistOverride = {
            banned: new Set(["scg-card"]),
            restricted: new Set(),
        };
        // Legal without the override.
        expect(() => assertDeckLegal(deck, pmResolve)).not.toThrow();
        // Illegal with the injected override, precise reason surfaced.
        expect(() => assertDeckLegal(deck, pmResolve, banlist)).toThrow(
            /banned/i
        );
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
            cards: [card("lea-card"), card("4ed-card", "Reprint")],
        };
        const reasons = checkSets(
            deck,
            FORMAT_RULES["old-school"],
            stubResolve
        );
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe("set-not-allowed");
        expect(reasons[0].message).toContain("Reprint");
        expect(reasons[0].message).toContain("4ed");
    });

    it("accepts a 2ed (Unlimited) card in Old School (#560)", () => {
        const deck: ValidatableDeck = {
            cards: [card("lea-card"), card("2ed-card", "Unlimited reprint")],
        };
        expect(
            checkSets(deck, FORMAT_RULES["old-school"], stubResolve)
        ).toEqual([]);
    });

    it("accepts a 3ed (Revised) card in Old School (#561)", () => {
        const deck: ValidatableDeck = {
            cards: [card("lea-card"), card("3ed-card", "Revised reprint")],
        };
        expect(
            checkSets(deck, FORMAT_RULES["old-school"], stubResolve)
        ).toEqual([]);
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
        const deck: ValidatableDeck = { cards: repeat("4ed-card", 4) };
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

    it("Old School: a legal 60-card lea/leb deck (4-of spells + basics + a sideboard) is legal", () => {
        // 4 of each non-basic (the copy ceiling), padded to 60 with unlimited
        // basics; the sideboard is all basics so it stays within both the size
        // and the by-Card-ID copy budget.
        const deck: ValidatableDeck = {
            cards: [
                ...repeat("lea-card", 4),
                ...repeat("leb-card", 4),
                ...repeat("drk-card", 4),
                ...repeat("basic", 48),
            ],
            sideboard: repeat("basic", 15),
        };
        expect(deck.cards).toHaveLength(60);
        expect(validateDeck(deck, "old-school", stubResolve).isLegal).toBe(
            true
        );
    });

    it("Old School: under-size + disallowed set report BOTH reasons", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("lea-card", 39), card("4ed-card", "Reprint")],
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
    const BOLT_3ED = "cb9b9a9d-ae4c-4e04-bf9d-cae48f01292c";
    // Ancestral Recall — on the EC Restricted list. The lea id is the canonical
    // CardDefinition id; the 2ed id is the Unlimited printId resolving to it.
    const ANCESTRAL_LEA = "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b";
    const ANCESTRAL_2ED = "2dd41293-d7c8-4422-9f0c-b3e96350f5c9";
    const SQUIRE_DRK = "374df061-ebd2-4f1f-9a6e-7940a49197a9";
    const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

    it("the default resolver is the real registry resolver", () => {
        // A 60-card Old School deck of real lea cards + basics is legal with no
        // resolve override — the production path. 4 Bolts (the copy limit) plus
        // 56 unlimited basics.
        const deck: ValidatableDeck = {
            cards: [
                ...Array.from({ length: 4 }, () =>
                    card(BOLT_LEA, "Lightning Bolt")
                ),
                ...Array.from({ length: 56 }, () => card(MOUNTAIN, "Mountain")),
            ],
        };
        expect(validateDeck(deck, "old-school").isLegal).toBe(true);
    });

    it("accepts a 2ed (Unlimited) reprint in Old School via the real resolver (#560)", () => {
        // 1 Unlimited Bolt + 59 basics = 60. Unlimited (2ed) is now an allowed
        // Old School set, so the deck validates end-to-end with no reasons.
        const deck: ValidatableDeck = {
            cards: [
                card(BOLT_2ED, "Lightning Bolt (2ED)"),
                ...Array.from({ length: 59 }, () => card(MOUNTAIN, "Mountain")),
            ],
        };
        const result = validateDeck(deck, "old-school");
        expect(result.isLegal).toBe(true);
        expect(result.reasons).toEqual([]);
    });

    it("accepts a 3ed (Revised) reprint in Old School via the real resolver (#561)", () => {
        // 1 Revised Bolt + 59 basics = 60. Revised (3ed) is now an allowed Old
        // School set, so the deck validates end-to-end with no reasons.
        const deck: ValidatableDeck = {
            cards: [
                card(BOLT_3ED, "Lightning Bolt (3ED)"),
                ...Array.from({ length: 59 }, () => card(MOUNTAIN, "Mountain")),
            ],
        };
        const result = validateDeck(deck, "old-school");
        expect(result.isLegal).toBe(true);
        expect(result.reasons).toEqual([]);
    });

    it("counts the copy limit by definition id across the lea/2ed printings (#560)", () => {
        // 2 lea Bolts + 3 Unlimited Bolts collapse to ONE definition id, so the
        // shared budget is 5 — over the 4-copy ceiling. The reprint must not buy
        // extra copies just because its printId differs.
        const deck: ValidatableDeck = {
            cards: [
                ...Array.from({ length: 2 }, () => card(BOLT_LEA, "Bolt")),
                ...Array.from({ length: 3 }, () =>
                    card(BOLT_2ED, "Bolt (2ED)")
                ),
                ...Array.from({ length: 55 }, () => card(MOUNTAIN, "Mountain")),
            ],
        };
        const result = validateDeck(deck, "old-school");
        expect(result.isLegal).toBe(false);
        expect(result.reasons.some((r) => r.code === "copy-limit")).toBe(true);
        // Exactly one copy-limit reason — the two printings share one budget.
        expect(
            result.reasons.filter((r) => r.code === "copy-limit")
        ).toHaveLength(1);
        // 4 total (2 lea + 2 unlimited) stays legal across printings.
        const legal: ValidatableDeck = {
            cards: [
                ...Array.from({ length: 2 }, () => card(BOLT_LEA, "Bolt")),
                ...Array.from({ length: 2 }, () =>
                    card(BOLT_2ED, "Bolt (2ED)")
                ),
                ...Array.from({ length: 56 }, () => card(MOUNTAIN, "Mountain")),
            ],
        };
        expect(validateDeck(legal, "old-school").isLegal).toBe(true);
    });

    it("enforces the Restricted one-copy cap across the lea/2ed printings (#560)", () => {
        // Ancestral Recall is on the EC Restricted list (capped at 1). A lea
        // copy plus an Unlimited copy collapse to the same definition id, so the
        // pair trips the restricted rule even though the printIds differ.
        const deck: ValidatableDeck = {
            cards: [
                card(ANCESTRAL_LEA, "Ancestral Recall"),
                card(ANCESTRAL_2ED, "Ancestral Recall (2ED)"),
                ...Array.from({ length: 58 }, () => card(MOUNTAIN, "Mountain")),
            ],
        };
        const result = validateDeck(deck, "old-school");
        expect(result.isLegal).toBe(false);
        expect(result.reasons.some((r) => r.code === "restricted")).toBe(true);
    });

    it("accepts the drk card in Old School but rejects it in Alpha 40", () => {
        // 4 Bolts + 55 basics + 1 drk creature = 60, legal in Old School.
        const old: ValidatableDeck = {
            cards: [
                ...Array.from({ length: 4 }, () => card(BOLT_LEA)),
                ...Array.from({ length: 55 }, () => card(MOUNTAIN, "Mountain")),
                card(SQUIRE_DRK, "Squire"),
            ],
        };
        expect(validateDeck(old, "old-school").isLegal).toBe(true);
        const alpha: ValidatableDeck = {
            cards: [
                ...Array.from({ length: 4 }, () => card(BOLT_LEA)),
                ...Array.from({ length: 35 }, () => card(MOUNTAIN, "Mountain")),
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

// --- Premodern printing-gap reprints (issue #980, ADR 0036) ---------------
//
// Counterspell (lea), Lightning Bolt (lea) and Ball Lightning (drk) each only
// carried a pre-Premodern printing, so a Premodern deck containing them failed
// checkSets. The fix adds a Premodern-legal CardPrint per card (Tempest,
// 4th Edition, Beatdown) — the reprint machinery collapses printId -> the
// canonical CardDefinition id. These are the real per-print Scryfall UUIDs.
describe("validateDeck — Premodern reprints, REAL registry (issue #980)", () => {
    const COUNTERSPELL_TMP = "dacdd380-71cf-4832-bd02-3697501325f3";
    const BOLT_4ED = "9521375e-0bc1-45ef-b513-6d332a25f9d2";
    const BALL_LIGHTNING_BTD = "6312e369-aef7-486e-a689-97eef04c71d8";
    const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";
    // Canonical CardDefinition ids each reprint printId must collapse to.
    const COUNTERSPELL_DEF = "0df55e3f-14de-46ef-b6b1-616618724d9e";
    const BOLT_DEF = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
    const BALL_LIGHTNING_DEF = "c1ba83ab-83f5-421d-bba1-0f925870b5c8";

    it("resolves each reprint printId to a Premodern-legal set code", () => {
        const cs = resolveDeckCardMeta(COUNTERSPELL_TMP);
        expect(cs?.setCode).toBe("tmp");
        expect(cs?.cardId).toBe(COUNTERSPELL_DEF);

        const bolt = resolveDeckCardMeta(BOLT_4ED);
        expect(bolt?.setCode).toBe("4ed");
        expect(bolt?.cardId).toBe(BOLT_DEF);

        const ball = resolveDeckCardMeta(BALL_LIGHTNING_BTD);
        expect(ball?.setCode).toBe("btd");
        expect(ball?.cardId).toBe(BALL_LIGHTNING_DEF);

        // All three sets are in the Premodern-legal pool.
        const allowed = new Set(FORMAT_RULES["premodern"].allowedSets ?? []);
        expect(allowed.has("tmp")).toBe(true);
        expect(allowed.has("4ed")).toBe(true);
        expect(allowed.has("btd")).toBe(true);
    });

    it("passes a Premodern deck containing all three reprints (no set-not-allowed)", () => {
        // 3 target reprints + 57 basics = 60. Basics are set-exempt.
        const deck: ValidatableDeck = {
            cards: [
                card(COUNTERSPELL_TMP, "Counterspell"),
                card(BOLT_4ED, "Lightning Bolt"),
                card(BALL_LIGHTNING_BTD, "Ball Lightning"),
                ...Array.from({ length: 57 }, () => card(MOUNTAIN, "Mountain")),
            ],
        };
        const { isLegal, reasons } = validateDeck(deck, "premodern");
        expect(reasons.some((r) => r.code === "set-not-allowed")).toBe(false);
        expect(reasons.some((r) => r.code === "set-unknown")).toBe(false);
        expect(isLegal).toBe(true);
        expect(reasons).toEqual([]);
    });

    it("assertDeckLegal accepts the Premodern reprint deck via the real resolver", () => {
        const deck = {
            name: "Premodern Reprints",
            format: "premodern",
            cards: [
                card(COUNTERSPELL_TMP, "Counterspell"),
                card(BOLT_4ED, "Lightning Bolt"),
                card(BALL_LIGHTNING_BTD, "Ball Lightning"),
                ...Array.from({ length: 57 }, () => card(MOUNTAIN, "Mountain")),
            ],
        };
        expect(() => assertDeckLegal(deck)).not.toThrow();
    });
});

// --- Old School full legality (issue #516, ADR 0036) ----------------------

describe("checkCopyLimit — 4-copy limit by Card ID (issue #516)", () => {
    it("flags a 5th copy of a non-basic card; 4 copies are legal", () => {
        const five: ValidatableDeck = { cards: repeat("lea-card", 5) };
        const reasons = checkCopyLimit(five, 4, stubResolve);
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe("copy-limit");
        expect(reasons[0].message).toContain("5 copies");
        expect(reasons[0].message).toContain("maximum is 4");

        const four: ValidatableDeck = { cards: repeat("lea-card", 4) };
        expect(checkCopyLimit(four, 4, stubResolve)).toEqual([]);
    });

    it("never limits basic lands (basics are unlimited)", () => {
        const deck: ValidatableDeck = { cards: repeat("basic", 40) };
        expect(checkCopyLimit(deck, 4, stubResolve)).toEqual([]);
    });

    it("counts copies across maindeck + sideboard by Card ID", () => {
        // 3 in main + 2 in sideboard = 5 of one card → over the 4 limit.
        const deck: ValidatableDeck = {
            cards: repeat("lea-card", 3),
            sideboard: repeat("lea-card", 2),
        };
        const reasons = checkCopyLimit(deck, 4, stubResolve);
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe("copy-limit");
    });

    it("merges two PRINTINGS of one card into a single budget (count by Card ID)", () => {
        // lea-orig + leb-reprint resolve to the SAME canonical id: 3 + 2 = 5.
        const deck: ValidatableDeck = {
            cards: [...repeat("lea-orig", 3), ...repeat("leb-reprint", 2)],
        };
        const reasons = checkCopyLimit(deck, 4, stubResolve);
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe("copy-limit");
        expect(reasons[0].message).toContain("5 copies");
    });
});

describe("checkRestricted — Eternal Central one-copy list (issue #516)", () => {
    const restricted = new Set(["lea-card"]);

    it("flags 2 copies of a restricted card; 1 copy is legal", () => {
        const two: ValidatableDeck = { cards: repeat("lea-card", 2) };
        const reasons = checkRestricted(two, restricted, stubResolve);
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe("restricted");
        expect(reasons[0].message).toContain("restricted to 1");

        const one: ValidatableDeck = { cards: repeat("lea-card", 1) };
        expect(checkRestricted(one, restricted, stubResolve)).toEqual([]);
    });

    it("does not restrict cards absent from the list", () => {
        const deck: ValidatableDeck = { cards: repeat("leb-card", 4) };
        expect(checkRestricted(deck, restricted, stubResolve)).toEqual([]);
    });

    it("counts a restricted card by Card ID across printings", () => {
        // shared-card listed; 1 orig + 1 reprint = 2 → over the one-copy cap.
        const shared = new Set(["shared-card"]);
        const deck: ValidatableDeck = {
            cards: [card("lea-orig"), card("leb-reprint")],
        };
        const reasons = checkRestricted(deck, shared, stubResolve);
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe("restricted");
    });
});

describe("checkBanned — zero-copy list (issue #516)", () => {
    const banned = new Set(["drk-card"]);

    it("flags any presence of a banned card", () => {
        const deck: ValidatableDeck = { cards: [card("drk-card", "Banned")] };
        const reasons = checkBanned(deck, banned, stubResolve);
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe("banned");
        expect(reasons[0].message).toContain("Banned");
    });

    it("is silent when no banned card is present", () => {
        const deck: ValidatableDeck = { cards: repeat("lea-card", 4) };
        expect(checkBanned(deck, banned, stubResolve)).toEqual([]);
    });
});

describe("Old School lists are the EC ∩ pool intersection (ADR 0036)", () => {
    it("restricts the implemented EC power cards (canonical Card IDs)", () => {
        // Spot-check a few well-known EC restricted cards by their real ids.
        const BLACK_LOTUS = "b0faa7f2-b547-42c4-a810-839da50dadfe";
        const ANCESTRAL = "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b";
        const LIBRARY = "ee266113-34ce-4189-84e7-ee2c86a2722c";
        expect(OLD_SCHOOL_RESTRICTED.has(BLACK_LOTUS)).toBe(true);
        expect(OLD_SCHOOL_RESTRICTED.has(ANCESTRAL)).toBe(true);
        expect(OLD_SCHOOL_RESTRICTED.has(LIBRARY)).toBe(true);
    });

    it("bans the Chaos Orb guard id (Swedish dexterity ban, ADR 0010)", () => {
        // The Chaos Orb stub id (commented out in sets/lea.ts) — a guard so a
        // future un-comment is rejected rather than silently legal.
        expect(
            OLD_SCHOOL_BANNED.has("92274971-7c4a-4326-b0fe-75e2d124f718")
        ).toBe(true);
    });
});

describe("validateDeck — Old School full legality, REAL registry (issue #516)", () => {
    const BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
    const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";
    const BLACK_LOTUS_LEA = "b0faa7f2-b547-42c4-a810-839da50dadfe";
    const BLACK_LOTUS_LEB = "b3a69a1c-c80f-4413-a6fd-ae54cabbce28"; // reprint

    function pad(main: DeckCard[]): ValidatableDeck {
        // Pad to 60 with unlimited basics so size never confounds the rule
        // under test.
        const fill = 60 - main.length;
        return {
            cards: [
                ...main,
                ...Array.from({ length: fill }, () =>
                    card(MOUNTAIN, "Mountain")
                ),
            ],
        };
    }

    it("a 5th copy of a non-basic is illegal; 4 is legal", () => {
        const five = pad(
            Array.from({ length: 5 }, () => card(BOLT_LEA, "Lightning Bolt"))
        );
        const fiveReasons = validateDeck(five, "old-school").reasons;
        expect(fiveReasons.some((r) => r.code === "copy-limit")).toBe(true);

        const four = pad(
            Array.from({ length: 4 }, () => card(BOLT_LEA, "Lightning Bolt"))
        );
        expect(validateDeck(four, "old-school").isLegal).toBe(true);
    });

    it("two copies of a Restricted card is illegal; one is legal", () => {
        const two = pad([
            card(BLACK_LOTUS_LEA, "Black Lotus"),
            card(BLACK_LOTUS_LEA, "Black Lotus"),
        ]);
        const reasons = validateDeck(two, "old-school").reasons;
        expect(reasons.some((r) => r.code === "restricted")).toBe(true);

        const one = pad([card(BLACK_LOTUS_LEA, "Black Lotus")]);
        expect(validateDeck(one, "old-school").isLegal).toBe(true);
    });

    it("counts a Restricted card by Card ID across two printings (lea + leb Black Lotus)", () => {
        // One LEA original + one LEB reprint = two copies of the same Card ID.
        const deck = pad([
            card(BLACK_LOTUS_LEA, "Black Lotus"),
            card(BLACK_LOTUS_LEB, "Black Lotus (LEB)"),
        ]);
        const reasons = validateDeck(deck, "old-school").reasons;
        expect(reasons.some((r) => r.code === "restricted")).toBe(true);
    });

    it("a fully legal 60-card Old School deck reports legal", () => {
        // 4 Bolts + 1 Black Lotus (restricted, one copy) + 55 basics = 60.
        const deck: ValidatableDeck = {
            cards: [
                ...Array.from({ length: 4 }, () =>
                    card(BOLT_LEA, "Lightning Bolt")
                ),
                card(BLACK_LOTUS_LEA, "Black Lotus"),
                ...Array.from({ length: 55 }, () => card(MOUNTAIN, "Mountain")),
            ],
        };
        expect(deck.cards).toHaveLength(60);
        const result = validateDeck(deck, "old-school");
        expect(result.reasons).toEqual([]);
        expect(result.isLegal).toBe(true);
    });

    it("basics are unlimited and never trip the copy limit", () => {
        const deck: ValidatableDeck = {
            cards: Array.from({ length: 60 }, () => card(MOUNTAIN, "Mountain")),
        };
        expect(validateDeck(deck, "old-school").isLegal).toBe(true);
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
            cards: [...repeat("lea-card", 39), card("4ed-card", "Reprint")],
        };
        expect(() => assertDeckLegal(deck, stubResolve)).toThrow(/Sketchy/);
        expect(() => assertDeckLegal(deck, stubResolve)).toThrow(/Old School/);
        expect(() => assertDeckLegal(deck, stubResolve)).toThrow(/minimum/);
        expect(() => assertDeckLegal(deck, stubResolve)).toThrow(/4ed/);
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

// --- Alpha 40 full legality (issue #517, ADR 0036) ------------------------
//
// Exercised against the REAL registry resolver: this also asserts every list id
// resolves to its named lea/leb card (a typo in a list id would surface here).
// Rarity caps derive from each card's printed rarity; the named lists are EC
// policy ∩ pool. Decks are padded with basics (unlimited, exempt) to clear the
// 40-card minimum so each test isolates the cap under scrutiny.
describe("Alpha 40 full legality (issue #517, ADR 0036)", () => {
    // Neutral cards on NO special list — governed purely by their rarity cap.
    const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // common
    const AIR_ELEMENTAL = "69c3b2a3-0daa-4d42-832d-fcdfda6555ea"; // uncommon
    const SHIVAN_DRAGON = "fefbf149-f988-4f8b-9f53-56f5878116a6"; // rare
    // Moderated (3 regardless of rarity).
    const LIGHTNING_BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // common
    const COUNTERSPELL = "0df55e3f-14de-46ef-b6b1-616618724d9e"; // uncommon
    // Category-budget members (1 total per group).
    const BLACK_LOTUS = "b0faa7f2-b547-42c4-a810-839da50dadfe"; // Fast Mana
    const MOX_SAPPHIRE = "82da0972-b17b-4600-9efd-e9430a0db04b"; // Fast Mana
    const TIME_WALK = "e0139f60-d48e-46fb-9f5a-1e3d7558c834"; // Power
    const BRAINGEYSER = "62b19a12-6914-430e-81ce-dcfca47884df"; // Draw
    const ANCESTRAL_RECALL = "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b"; // Power+Draw
    // Restricted (1) and Banned (0).
    const WRATH_OF_GOD = "a2788d69-6a3a-42f0-8736-cc6b57755ecd";
    const UNDERGROUND_SEA = "ff76ac86-8a8a-47fe-9388-8950ca3e26c3";
    const MIND_TWIST = "eee9e106-a248-49d2-b8c8-6bbcd56ce739";
    const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // basic land

    // Pad a deck with basic Mountains up to a 40-card maindeck so size-min never
    // fires; the caller supplies the non-basic cards under test.
    function alpha40Deck(cards: DeckCard[]): ValidatableDeck {
        const padding = Math.max(0, 40 - cards.length);
        return { cards: [...cards, ...repeat(MOUNTAIN, padding)] };
    }
    function reasonCodes(deck: ValidatableDeck): string[] {
        return validateDeck(deck, "alpha-40").reasons.map((r) => r.code);
    }

    describe("rarity caps — common ∞ / uncommon ≤6 / rare ≤3", () => {
        it("an uncommon at 6 is legal, at 7 is illegal", () => {
            expect(
                reasonCodes(alpha40Deck(repeat(AIR_ELEMENTAL, 6)))
            ).not.toContain("rarity-cap");
            expect(
                reasonCodes(alpha40Deck(repeat(AIR_ELEMENTAL, 7)))
            ).toContain("rarity-cap");
        });

        it("a rare at 3 is legal, at 4 is illegal", () => {
            expect(
                reasonCodes(alpha40Deck(repeat(SHIVAN_DRAGON, 3)))
            ).not.toContain("rarity-cap");
            expect(
                reasonCodes(alpha40Deck(repeat(SHIVAN_DRAGON, 4)))
            ).toContain("rarity-cap");
        });

        it("a common is unlimited (10 copies legal)", () => {
            expect(
                reasonCodes(alpha40Deck(repeat(GRIZZLY_BEARS, 10)))
            ).not.toContain("rarity-cap");
        });

        it("basics are exempt from every cap (40 Mountains legal)", () => {
            expect(validateDeck(alpha40Deck([]), "alpha-40").isLegal).toBe(
                true
            );
        });
    });

    describe("Moderated override — 3 copies regardless of rarity", () => {
        it("a Moderated common at 3 is legal, at 4 is illegal", () => {
            expect(
                reasonCodes(alpha40Deck(repeat(LIGHTNING_BOLT, 3)))
            ).not.toContain("moderated");
            expect(
                reasonCodes(alpha40Deck(repeat(LIGHTNING_BOLT, 4)))
            ).toContain("moderated");
        });

        it("a Moderated uncommon caps at 3, not its rarity 6", () => {
            // Counterspell is uncommon (rarity cap 6) but Moderated to 3.
            const codes = reasonCodes(alpha40Deck(repeat(COUNTERSPELL, 4)));
            expect(codes).toContain("moderated");
            expect(codes).not.toContain("rarity-cap");
        });
    });

    describe("Category Budgets — one card total per group", () => {
        it("two different Fast Mana cards are illegal; one is legal", () => {
            expect(
                reasonCodes(
                    alpha40Deck([card(BLACK_LOTUS), card(MOX_SAPPHIRE)])
                )
            ).toContain("category-budget");
            expect(reasonCodes(alpha40Deck([card(BLACK_LOTUS)]))).not.toContain(
                "category-budget"
            );
        });

        it("a card in two categories consumes BOTH budgets (Ancestral Recall)", () => {
            // Ancestral alone (1 Power, 1 Draw) is legal.
            expect(
                reasonCodes(alpha40Deck([card(ANCESTRAL_RECALL)]))
            ).not.toContain("category-budget");
            // Ancestral + another Power card → Power group over budget.
            expect(
                reasonCodes(
                    alpha40Deck([card(ANCESTRAL_RECALL), card(TIME_WALK)])
                )
            ).toContain("category-budget");
            // Ancestral + another Draw card → Draw group over budget.
            expect(
                reasonCodes(
                    alpha40Deck([card(ANCESTRAL_RECALL), card(BRAINGEYSER)])
                )
            ).toContain("category-budget");
        });

        it("names the offending group in the reason", () => {
            const { reasons } = validateDeck(
                alpha40Deck([card(BLACK_LOTUS), card(MOX_SAPPHIRE)]),
                "alpha-40"
            );
            expect(
                reasons.some(
                    (r) =>
                        r.code === "category-budget" &&
                        r.message.includes("Fast Mana")
                )
            ).toBe(true);
        });
    });

    describe("Restricted (1) and Banned (0)", () => {
        it("two copies of a Restricted card are illegal; one is legal", () => {
            expect(
                reasonCodes(alpha40Deck(repeat(UNDERGROUND_SEA, 2)))
            ).toContain("restricted");
            expect(
                reasonCodes(alpha40Deck(repeat(UNDERGROUND_SEA, 1)))
            ).not.toContain("restricted");
        });

        it("a Banned card present is illegal", () => {
            expect(reasonCodes(alpha40Deck([card(MIND_TWIST)]))).toContain(
                "banned"
            );
        });

        it("a Restricted card reports only the restricted reason, not a rarity cap", () => {
            // Wrath of God is rare (cap 3) and Restricted (1): at 2 copies only
            // the tighter restricted reason fires (precedence).
            const codes = reasonCodes(alpha40Deck(repeat(WRATH_OF_GOD, 2)));
            expect(codes).toContain("restricted");
            expect(codes).not.toContain("rarity-cap");
        });
    });

    describe("size + set membership", () => {
        it("a non-empty sideboard is illegal (maxSide 0)", () => {
            const deck: ValidatableDeck = {
                cards: repeat(MOUNTAIN, 40),
                sideboard: [card(GRIZZLY_BEARS)],
            };
            expect(reasonCodes(deck)).toContain("size-max-side");
        });

        it("a non-lea/leb card is illegal", () => {
            // The Abyss is a Legends card — not in the Alpha 40 pool.
            const THE_ABYSS = "86a27d68-3e58-4ade-976d-36381beed451";
            expect(reasonCodes(alpha40Deck([card(THE_ABYSS)]))).toContain(
                "set-not-allowed"
            );
        });

        it("an under-40 maindeck is illegal", () => {
            expect(
                validateDeck(
                    { cards: repeat(MOUNTAIN, 39) },
                    "alpha-40"
                ).reasons.map((r) => r.code)
            ).toContain("size-min");
        });
    });

    it("a fully legal Alpha 40 deck reports legal", () => {
        // 3 Bolt (moderated≤3) + 1 Black Lotus (Fast Mana) + 1 Ancestral
        // (Power+Draw, 1 each) + 3 Shivan (rare≤3) + 6 Air Elemental
        // (uncommon≤6) + 10 Grizzly (common ∞) + 16 Mountain = 40.
        const deck: ValidatableDeck = {
            cards: [
                ...repeat(LIGHTNING_BOLT, 3),
                card(BLACK_LOTUS),
                card(ANCESTRAL_RECALL),
                ...repeat(SHIVAN_DRAGON, 3),
                ...repeat(AIR_ELEMENTAL, 6),
                ...repeat(GRIZZLY_BEARS, 10),
                ...repeat(MOUNTAIN, 16),
            ],
        };
        expect(validateDeck(deck, "alpha-40").isLegal).toBe(true);
    });

    describe("helpers in isolation (real registry)", () => {
        it("checkCategoryBudgets fires once per over-budget group", () => {
            const deck = alpha40Deck([
                card(BLACK_LOTUS),
                card(MOX_SAPPHIRE),
                card(ANCESTRAL_RECALL),
                card(TIME_WALK),
            ]);
            const categories = [
                { name: "Mana", cards: new Set([BLACK_LOTUS, MOX_SAPPHIRE]) },
                {
                    name: "Power",
                    cards: new Set([ANCESTRAL_RECALL, TIME_WALK]),
                },
            ];
            const reasons = checkCategoryBudgets(
                deck,
                categories,
                resolveDeckCardMeta
            );
            // Both groups are over budget → one reason each.
            expect(reasons.length).toBe(2);
        });

        it("checkAlpha40CopyCaps skips category/restricted/banned cards", () => {
            // Black Lotus (Fast Mana) at 2 copies is a category violation, NOT a
            // copy-cap one — checkAlpha40CopyCaps must stay silent on it.
            const reasons = checkAlpha40CopyCaps(
                alpha40Deck(repeat(BLACK_LOTUS, 2)),
                resolveDeckCardMeta
            );
            expect(reasons).toEqual([]);
        });
    });
});
