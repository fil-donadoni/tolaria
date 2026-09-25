import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
    assertDeckLegal,
    checkAlpha40CopyCaps,
    checkBanned,
    checkCategoryBudgets,
    checkCopyLimit,
    checkOracleLegality,
    checkRestricted,
    checkSets,
    checkSize,
    FORMAT_IDS,
    FORMAT_RULES,
    isFormatId,
    OLD_SCHOOL_BANLIST_SEED,
    OLD_SCHOOL_RESTRICTED,
    PREMODERN_BANLIST_SEED,
    PREMODERN_BANNED,
    resolveBanlistEnforcement,
    validateDeck,
    type BanlistEntry,
    type BanlistOverride,
    type FormatId,
    type ResolveCard,
    type ResolveCardByName,
    type ValidatableDeck,
} from "../formats";
import type { DeckCard } from "../deckPresets";
import {
    resolveDeckCardMeta,
    tryGetCardByName,
    type DeckCardMeta,
} from "../cards";
import { normalizeLegacyFormat } from "../userDecks";
import { resolveBanlistEnforcementForFormat } from "../banlists";

// Real `nameRegistry` resolver (issue #1141): structurally satisfies
// `ResolveCardByName` — used by the seed round-trip tests below to prove the
// name-keyed seed reproduces the SAME id sets as the id-keyed code consts.
const realResolveByName: ResolveCardByName = (name) => tryGetCardByName(name);

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
    it("has a registry entry with a label for every FormatId", () => {
        for (const id of FORMAT_IDS) {
            expect(FORMAT_RULES[id]).toBeDefined();
            expect(typeof FORMAT_RULES[id].label).toBe("string");
            expect(FORMAT_RULES[id].label.length).toBeGreaterThan(0);
        }
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

describe("Premodern validator — Scryfall legality (ADR 0036, issue #2695)", () => {
    // A Premodern-scoped pool, keyed by fake deck-card ids but resolving to
    // REAL Scryfall names — legality is now a NAME lookup against the
    // generated PREMODERN_LEGAL_NAMES map, not a set-code lookup, so the
    // fixture's `setCode`s below are arbitrary/unused by the checks under
    // test (kept only because `DeckCardMeta` still requires the field).
    const PM_POOL: Record<string, DeckCardMeta> = {
        "legal-card": {
            cardId: "legal-card",
            name: "Lightning Bolt", // real, Premodern-legal per Scryfall
            setCode: "arbitrary",
            rarity: "common",
            isBasic: false,
        },
        // A REAL card that Scryfall does not list as Premodern-legal (banned
        // outright, not merely a Tolaria-seed ban) — the "illegal-by-Scryfall"
        // case the generated map must reject on its own, with no id on any
        // banlist at all.
        "illegal-card": {
            cardId: "illegal-card",
            name: "Black Lotus",
            setCode: "arbitrary",
            rarity: "rare",
            isBasic: false,
        },
        // A name that exists NOWHERE in the generated map — not a real card,
        // not a typo of one. Proves the FAIL-CLOSED miss path: an unresolvable
        // name is illegal, never silently passed (never assume "unlisted
        // means legal").
        "unknown-name-card": {
            cardId: "unknown-name-card",
            name: "Not A Real Card Whatsoever",
            setCode: "arbitrary",
            rarity: "common",
            isBasic: false,
        },
        island: {
            cardId: "island",
            name: "Island",
            setCode: "scg",
            rarity: "common",
            isBasic: true,
        },
        // Necropotence's canonical id — on PREMODERN_BANNED (the code seed)
        // AND `legalities.premodern === "banned"` on Scryfall (verified
        // directly against the live API, 2026-08-25) — i.e. genuinely IN the
        // Premodern pool, merely banned. `PREMODERN_LEGAL_NAMES` is built from
        // POOL membership (legal ∪ banned ∪ restricted), not "legal" alone
        // (issue #2695 review, finding 3), specifically so this case reports
        // ONLY "banned" — never "premodern-illegal" too, which would make an
        // admin un-ban (removing the DB/seed row) insufficient on its own.
        "necro-print": {
            cardId: "54d7a0c1-efb4-4a8d-ad92-a96d43835052",
            name: "Necropotence",
            setCode: "ice",
            rarity: "rare",
            isBasic: false,
        },
    };
    const pmResolve: ResolveCard = (id) => PM_POOL[id] ?? null;

    it("passes a legal 60-card Premodern deck", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("legal-card", 4), ...repeat("island", 56)],
        };
        expect(validateDeck(deck, "premodern", pmResolve).isLegal).toBe(true);
    });

    it("rejects a REAL card that Scryfall does not list as Premodern-legal", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("illegal-card", 4), ...repeat("island", 56)],
        };
        const { isLegal, reasons } = validateDeck(deck, "premodern", pmResolve);
        expect(isLegal).toBe(false);
        expect(reasons.some((r) => r.code === "premodern-illegal")).toBe(true);
    });

    it("fails CLOSED on a name absent from the generated map (never silently legal)", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("unknown-name-card", 4), ...repeat("island", 56)],
        };
        const { isLegal, reasons } = validateDeck(deck, "premodern", pmResolve);
        expect(isLegal).toBe(false);
        expect(reasons.some((r) => r.code === "premodern-illegal")).toBe(true);
    });

    it("bans a card on the banlist by Card ID across printings", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("necro-print", 1), ...repeat("island", 59)],
        };
        const { isLegal, reasons } = validateDeck(deck, "premodern", pmResolve);
        expect(isLegal).toBe(false);
        expect(reasons.some((r) => r.code === "banned")).toBe(true);
    });

    it("a banned-but-in-pool card reports ONLY 'banned', never also 'premodern-illegal' (issue #2695 review, finding 3)", () => {
        // Necropotence is a pool member (Scryfall lists it `banned`, not
        // `not_legal`) — the pool-membership check must not ALSO reject it,
        // or an admin un-banning it (clearing the banlist override) could
        // never make it legal again without a corpus re-pin + code release.
        const deck: ValidatableDeck = {
            cards: [...repeat("necro-print", 1), ...repeat("island", 59)],
        };
        const { reasons } = validateDeck(deck, "premodern", pmResolve);
        expect(reasons.some((r) => r.code === "banned")).toBe(true);
        expect(reasons.some((r) => r.code === "premodern-illegal")).toBe(false);
    });

    it("un-banning via an injected banlist override makes the pool-member card legal again, with no re-pin needed", () => {
        // Simulates PRD #1138/#1143's live banlist sync: an empty `banned`
        // override (the un-ban) must be sufficient on its own — the pool-
        // membership map must never independently re-enforce the ban.
        const deck: ValidatableDeck = {
            cards: [...repeat("necro-print", 1), ...repeat("island", 59)],
        };
        const { isLegal, reasons } = validateDeck(
            deck,
            "premodern",
            pmResolve,
            {
                banned: new Set(),
                restricted: new Set(),
            }
        );
        expect(reasons).toEqual([]);
        expect(isLegal).toBe(true);
    });

    it("enforces the 4-copy limit and has no restricted list", () => {
        const deck: ValidatableDeck = {
            cards: [...repeat("legal-card", 5), ...repeat("island", 55)],
        };
        const { reasons } = validateDeck(deck, "premodern", pmResolve);
        expect(reasons.some((r) => r.code === "copy-limit")).toBe(true);
        expect(reasons.some((r) => r.code === "restricted")).toBe(false);
    });
});

describe("checkOracleLegality — Scryfall Premodern legality, unit (issue #2695)", () => {
    // Pure-unit tests against a hand-injected legality set — no dependency on
    // the real generated `PREMODERN_LEGAL_NAMES`, so these prove the FUNCTION,
    // not the DATA (the fixture-based describe block above proves the data).
    const legalNames = new Set(["fictional legal card"]);
    const pool: Record<string, DeckCardMeta> = {
        legal: {
            cardId: "legal",
            name: "Fictional Legal Card",
            setCode: "x",
            rarity: "common",
            isBasic: false,
        },
        illegal: {
            cardId: "illegal",
            name: "Fictional Illegal Card",
            setCode: "x",
            rarity: "common",
            isBasic: false,
        },
        basic: {
            cardId: "basic",
            name: "Fictional Illegal Card", // deliberately illegal-by-name…
            setCode: "x",
            rarity: "common",
            isBasic: true, // …but exempt as a Basic (ADR 0036)
        },
    };
    const resolve: ResolveCard = (id) => pool[id] ?? null;

    it("accepts a name present in the legality set (case-insensitive)", () => {
        const deck: ValidatableDeck = { cards: [card("legal")] };
        expect(checkOracleLegality(deck, legalNames, resolve)).toEqual([]);
    });

    it("rejects a name absent from the legality set", () => {
        const deck: ValidatableDeck = { cards: [card("illegal")] };
        const reasons = checkOracleLegality(deck, legalNames, resolve);
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe("premodern-illegal");
    });

    it("never trips on a Basic land regardless of name", () => {
        const deck: ValidatableDeck = { cards: [card("basic")] };
        expect(checkOracleLegality(deck, legalNames, resolve)).toEqual([]);
    });

    it("flags an id the registry can't resolve as out-of-pool", () => {
        const deck: ValidatableDeck = {
            cards: [card("ghost-card", "Phantom")],
        };
        const reasons = checkOracleLegality(deck, legalNames, resolve);
        expect(reasons[0].code).toBe("set-unknown");
        expect(reasons[0].message).toContain("Phantom");
    });

    it("de-duplicates by card id (a 4-of illegal card yields one reason)", () => {
        const deck: ValidatableDeck = { cards: repeat("illegal", 4) };
        expect(checkOracleLegality(deck, legalNames, resolve)).toHaveLength(1);
    });

    it("falls back to the deck's own cardName when resolve returns no name (pre-existing stub compatibility)", () => {
        const noNamePool: Record<string, DeckCardMeta> = {
            "no-name": {
                cardId: "no-name",
                setCode: "x",
                rarity: "common",
                isBasic: false,
                // `name` deliberately omitted — mirrors the many hand-rolled
                // ResolveCard stubs elsewhere that predate this field.
            },
        };
        const noNameResolve: ResolveCard = (id) => noNamePool[id] ?? null;
        const deck: ValidatableDeck = {
            cards: [card("no-name", "Fictional Legal Card")],
        };
        expect(checkOracleLegality(deck, legalNames, noNameResolve)).toEqual(
            []
        );
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
            name: "Lightning Bolt", // real, Premodern-legal per Scryfall
            setCode: "scg",
            rarity: "common",
            isBasic: false,
        },
        island: {
            cardId: "island",
            name: "Island",
            setCode: "scg",
            rarity: "common",
            isBasic: true,
        },
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
                name: "Necropotence",
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

// --- Premodern printing-gap reprints (issue #980 — SUPERSEDED by #2695) ---
//
// Counterspell (lea), Lightning Bolt (lea) and Ball Lightning (drk) each only
// carried a pre-Premodern printing, so a Premodern deck containing them used
// to fail checkSets; #980's fix was to add a Premodern-legal CardPrint per
// card (Tempest, 4th Edition, Beatdown) so the reprint machinery would
// collapse printId -> the canonical CardDefinition id inside an allowed set.
//
// #2695 supersedes that per-card workaround: `premodernValidate` no longer
// calls `checkSets`/`allowedSets` at all, so which set a card is BUILT in is
// irrelevant to its legality — only Scryfall's `legalities.premodern` (by
// name) matters. The three reprints below still validate (they already have
// an allowed-set printing from #980's fix), but the block now ALSO proves the
// stronger claim #980's own fix could not: a card whose ONLY built printing
// is in a non-Premodern-legal set (never patched with a reprint) validates
// too — the "moot by construction" case. #980 was already CLOSED before this
// change; it is commented as superseded (its own historical fix stays correct
// and harmless), not reopened.
describe("validateDeck — Premodern legality by Scryfall, REAL registry (issue #2695, supersedes #980)", () => {
    const COUNTERSPELL_TMP = "dacdd380-71cf-4832-bd02-3697501325f3";
    const BOLT_4ED = "9521375e-0bc1-45ef-b513-6d332a25f9d2";
    const BALL_LIGHTNING_BTD = "6312e369-aef7-486e-a689-97eef04c71d8";
    const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";
    // Canonical CardDefinition ids each reprint printId must collapse to.
    const COUNTERSPELL_DEF = "0df55e3f-14de-46ef-b6b1-616618724d9e";
    const BOLT_DEF = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
    const BALL_LIGHTNING_DEF = "c1ba83ab-83f5-421d-bba1-0f925870b5c8";
    // City of Brass's ONLY built printing (arn) — verified against
    // `data/card-index.json` and `convex/cards/sets/**` to have no second
    // CardDefinition/reprint anywhere in the catalogue, so `resolveDeckCardMeta`
    // can never resolve it to an allowed-set printing (unlike Animate Dead,
    // which this block used to cite here but which ALSO has a built `4ed`
    // print — `convex/cards/sets/4ed/black.ts` — so its printing-gap claim was
    // false; `4ed` is in PREMODERN_LEGAL_SETS, making the old assertion pass
    // for a reason unrelated to the class it claimed to prove — issue #2695
    // review, finding 2). City of Brass genuinely has no allowed-set printing
    // at all: a real, well-known Premodern utility land the OLD checkSets-based
    // validator would have rejected outright.
    const CITY_OF_BRASS_ARN = "f4e32327-380d-471e-813b-4c27477787ce";

    it("resolves each reprint printId to its canonical definition (unaffected by the legality change)", () => {
        const cs = resolveDeckCardMeta(COUNTERSPELL_TMP);
        expect(cs?.setCode).toBe("tmp");
        expect(cs?.cardId).toBe(COUNTERSPELL_DEF);

        const bolt = resolveDeckCardMeta(BOLT_4ED);
        expect(bolt?.setCode).toBe("4ed");
        expect(bolt?.cardId).toBe(BOLT_DEF);

        const ball = resolveDeckCardMeta(BALL_LIGHTNING_BTD);
        expect(ball?.setCode).toBe("btd");
        expect(ball?.cardId).toBe(BALL_LIGHTNING_DEF);
    });

    it("MOOT BY CONSTRUCTION: a card whose only built printing sits outside the legal-set list still validates", () => {
        // City of Brass's only built printing is `arn`, which is NOT in
        // PREMODERN_LEGAL_SETS and never received a reprint into an allowed
        // set (unlike this block's other three examples). The OLD
        // checkSets-based validator would have rejected this deck outright;
        // #2695's name-based legality does not care which set it was built
        // in at all. `setCode !== "arn"` here would mean this test stopped
        // proving what it claims (e.g. if a future `4ed`/`ice` reprint of
        // City of Brass were added) — assert it explicitly so that drift
        // fails loudly instead of silently, exactly the shape of bug finding
        // 2 caught in the Animate Dead version of this test.
        expect(resolveDeckCardMeta(CITY_OF_BRASS_ARN)?.setCode).toBe("arn");
        const deck: ValidatableDeck = {
            cards: [
                card(CITY_OF_BRASS_ARN, "City of Brass"),
                ...Array.from({ length: 59 }, () => card(MOUNTAIN, "Mountain")),
            ],
        };
        const { isLegal, reasons } = validateDeck(deck, "premodern");
        expect(reasons.some((r) => r.code === "premodern-illegal")).toBe(false);
        expect(isLegal).toBe(true);
    });

    it("passes a Premodern deck containing all three reprints (no premodern-illegal)", () => {
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
        expect(reasons.some((r) => r.code === "premodern-illegal")).toBe(false);
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

// --- The canonical Premodern Tier 1 lists (issue #2719) -------------------
//
// This block replaces the ARCHETYPE SPOT-CHECK that stood here while the lists
// did not exist. That spot-check said so in its own comment — "once #2696's
// canonical lists land, they can replace this spot-check with the literal
// nine" — and picked one already-built staple per archetype instead, because
// several archetype-defining cards (Goblin Piledriver, Psychatog, Oath of
// Druids, Aluren itself) were among PRD #2693's 49 missing cards. Issues
// #2713-#2718 built them, so the substitute has served its purpose and the
// real lists are asserted here.
//
// "Nine" is the PRD's arithmetic — three already-shipped Premodern presets
// plus the six supplied lists — and only the six are assertable HERE. The
// three shipped presets are rows in the `presetDecks` table, deliberately
// carried in `data/premodern-tier1-decks.json` as a SLUG and nothing else
// (`ShippedPreset`): copying their 75 cards into the repo would create a
// second source of truth that drifts the first time an Admin edits the preset,
// and a `presetDecks` row is deployment-local (#770/#1455) and can never be an
// offline gate assertion in the first place. Their cards are hand-written by
// construction, which is what made them shippable.
//
// Two assertions, and they are not the same claim. A name that resolves is not
// a legal deck (wrong copy counts, a banned card, a 59-card list), and a legal
// deck is not one the engine can build (a name the registry does not carry
// cannot be seated at all). The compiler-state half — every card `ready` or
// `ours` — lives in `scripts/__tests__/tier1-decks.test.ts`, which reads the
// Oracle lockfile this project does not.
describe("validateDeck — the canonical Premodern Tier 1 lists (issue #2719)", () => {
    const REPO_ROOT = join(
        dirname(new URL(import.meta.url).pathname),
        "..",
        ".."
    );
    const tier1 = JSON.parse(
        readFileSync(
            join(REPO_ROOT, "data", "premodern-tier1-decks.json"),
            "utf8"
        )
    ) as {
        shippedPresets: { slug: string; name: string }[];
        decks: {
            slug: string;
            name: string;
            main: { count: number; name: string }[];
            sideboard: { count: number; name: string }[];
        }[];
    };
    const cases = tier1.decks.map((d) => [d.slug, d] as const);

    /** The 75 as `DeckCard`s, one entry per copy, resolved by NAME through the
     *  real registry — the same seam `scripts/lib/preset-deck-seed.ts` uses to
     *  build the Preset Deck row, so a list that validates here is a list the
     *  seeder can publish. */
    function expand(rows: { count: number; name: string }[]): DeckCard[] {
        return rows.flatMap((row) => {
            const def = tryGetCardByName(row.name);
            if (!def) return [];
            return Array.from({ length: row.count }, () =>
                card(def.id, def.name)
            );
        });
    }

    it.each(cases)(
        "%s — every card resolves through the registry seam",
        (_slug, deck) => {
            // Named, not counted: "3 unresolved" sends the reader back to the
            // file, and the name IS the fix (a typo in the list, or a card
            // nobody has built).
            const unresolved = [...deck.main, ...deck.sideboard]
                .map((r) => r.name)
                .filter((name) => tryGetCardByName(name) === null);
            expect(unresolved).toEqual([]);
        }
    );

    it.each(cases)("%s — validates legal in Premodern", (_slug, deck) => {
        const built: ValidatableDeck = {
            cards: expand(deck.main),
            sideboard: expand(deck.sideboard),
        };
        // Sizes first: `expand` drops an unresolved name, so a 60 + 15 built
        // list is also the proof that nothing silently fell out of it and the
        // legality verdict below is about the whole deck.
        expect(built.cards).toHaveLength(60);
        expect(built.sideboard).toHaveLength(15);
        const { isLegal, reasons } = validateDeck(built, "premodern");
        expect(reasons).toEqual([]);
        expect(isLegal).toBe(true);
    });

    it("names the three already-shipped presets by slug only", () => {
        // The join key to the `presetDecks` table, and the reason the block
        // above asserts six lists rather than nine. A card list appearing here
        // would be the drift the `ShippedPreset` type exists to prevent.
        expect(tier1.shippedPresets.map((p) => p.slug)).toEqual([
            "deck-1",
            "burn",
            "enchantress",
        ]);
        for (const preset of tier1.shippedPresets) {
            expect(Object.keys(preset).sort()).toEqual(["name", "slug"]);
        }
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

// --- resolveBanlistEnforcement (PRD #1138, issue #1141) --------------------
//
// The pure name→id resolver `getBanlistEnforcement` (convex/banlists.ts)
// delegates to. A stub `resolve` stands in for the real `nameRegistry`
// (`tryGetCardByName`) so these tests never touch the card catalogue.

describe("resolveBanlistEnforcement — name→id resolution (issue #1141)", () => {
    // A tiny stub registry: only "Demonic Tutor" and "Balance" are "built".
    // "Parallax Tide" is deliberately absent — the unbuilt-name case.
    const stubResolve: ResolveCardByName = (name) => {
        const ids: Record<string, string> = {
            "Demonic Tutor": "id-demonic-tutor",
            Balance: "id-balance",
        };
        const id = ids[name];
        return id ? { id } : null;
    };

    it("maps a built name into the correct set by status", () => {
        const entries: BanlistEntry[] = [
            { cardName: "Demonic Tutor", status: "banned" },
            { cardName: "Balance", status: "restricted" },
        ];
        const { banned, restricted } = resolveBanlistEnforcement(
            entries,
            stubResolve
        );
        expect(banned.has("id-demonic-tutor")).toBe(true);
        expect(restricted.has("id-balance")).toBe(true);
        expect(banned.size).toBe(1);
        expect(restricted.size).toBe(1);
    });

    it("drops an unbuilt name (Parallax Tide) from enforcement", () => {
        const entries: BanlistEntry[] = [
            { cardName: "Demonic Tutor", status: "banned" },
            { cardName: "Parallax Tide", status: "banned" },
        ];
        const { banned, restricted } = resolveBanlistEnforcement(
            entries,
            stubResolve
        );
        // Only the built name resolves into enforcement...
        expect(banned.has("id-demonic-tutor")).toBe(true);
        expect(banned.size).toBe(1);
        // ...Parallax Tide contributes nothing (dropped, not thrown).
        expect(restricted.size).toBe(0);
    });

    it("an empty entry list resolves to empty sets", () => {
        const { banned, restricted } = resolveBanlistEnforcement(
            [],
            stubResolve
        );
        expect(banned.size).toBe(0);
        expect(restricted.size).toBe(0);
    });
});

describe("Banlist seeds (issue #1141) — non-empty, Parallax Tide present", () => {
    it("PREMODERN_BANLIST_SEED is non-empty and includes Parallax Tide", () => {
        expect(PREMODERN_BANLIST_SEED.length).toBeGreaterThan(0);
        expect(
            PREMODERN_BANLIST_SEED.some((e) => e.cardName === "Parallax Tide")
        ).toBe(true);
        // Premodern has no official restricted list — every seed row is banned.
        expect(PREMODERN_BANLIST_SEED.every((e) => e.status === "banned")).toBe(
            true
        );
    });

    it("OLD_SCHOOL_BANLIST_SEED is non-empty and covers both statuses", () => {
        expect(OLD_SCHOOL_BANLIST_SEED.length).toBeGreaterThan(0);
        expect(
            OLD_SCHOOL_BANLIST_SEED.some((e) => e.status === "restricted")
        ).toBe(true);
        expect(OLD_SCHOOL_BANLIST_SEED.some((e) => e.status === "banned")).toBe(
            true
        );
    });

    it("resolving the Old School seed's restricted names through the REAL registry reproduces OLD_SCHOOL_RESTRICTED", () => {
        // Every Restricted-list card IS built, so the name-keyed seed must
        // resolve to the exact same id set as the id-keyed code const —
        // otherwise the seed has silently drifted from OLD_SCHOOL_RESTRICTED.
        const { restricted } = resolveBanlistEnforcement(
            OLD_SCHOOL_BANLIST_SEED,
            realResolveByName
        );
        expect(restricted).toEqual(OLD_SCHOOL_RESTRICTED);
    });

    it("the Old School seed's banned names (Chaos Orb, Falling Star, Shahrazad) are all unbuilt — dropped, not the guard id", () => {
        // OLD_SCHOOL_BANNED hardcodes a documentation-guard id for the
        // commented-out Chaos Orb stub (it isn't resolvable by name because
        // it isn't registered). Resolving the seed's banned names through the
        // REAL registry must therefore come back EMPTY — proof the drop
        // behavior holds for the real catalogue, not just a stub.
        const { banned } = resolveBanlistEnforcement(
            OLD_SCHOOL_BANLIST_SEED,
            realResolveByName
        );
        expect(banned.size).toBe(0);
    });

    it("the Premodern seed's built names cover PREMODERN_BANNED and pick up cards built since the guard comment was written", () => {
        // Real-registry round trip (no stub): every id PREMODERN_BANNED
        // already lists must still resolve from the seed's names (no drift),
        // PLUS Parallax Tide/Mystical Tutor/Vampiric Tutor — cards that were
        // stubbed guards when this seed's rationale was written but have
        // since shipped, so they now correctly enforce too. Amulet of Quoz
        // stays deferred (ADR 0010, ante card) and is still dropped.
        const { banned } = resolveBanlistEnforcement(
            PREMODERN_BANLIST_SEED,
            realResolveByName
        );
        for (const id of PREMODERN_BANNED) {
            expect(banned.has(id)).toBe(true);
        }
        for (const name of [
            "Parallax Tide",
            "Mystical Tutor",
            "Vampiric Tutor",
        ]) {
            const card = tryGetCardByName(name);
            expect(card).not.toBeNull();
            expect(banned.has(card!.id)).toBe(true);
        }
        expect(tryGetCardByName("Amulet of Quoz")).toBeNull();
        expect(banned.size).toBe(PREMODERN_BANNED.size + 3);
    });
});

// --- Server-gate integration: loadBanlistOverrides resolution + assertDeckLegal
// (PRD #1138, issue #1144) --------------------------------------------------
//
// `loadBanlistOverrides` (`convex/banlists.ts`) is a thin wrapper: read DB rows
// via `ctx.db`, then resolve them with `resolveBanlistEnforcementForFormat`
// (the SAME pure core `getBanlistEnforcement` uses) — exactly the shape the
// project's no-convex-test-harness convention models directly (prior art:
// `decks.test.ts`, `matchLifecycle.test.ts`). These tests exercise that
// resolution against the REAL card registry (`tryGetCardByName`) and feed the
// result straight into `assertDeckLegal`, the authoritative game-start gate
// (`game.ts`) and the deck-save legality seam (`decks.ts`) both call after
// `loadBanlistOverrides` resolves — the highest seam short of a real mutation.
describe("Server-gate integration — loadBanlistOverrides resolution + assertDeckLegal (issue #1144)", () => {
    // Necropotence: banned in Premodern, with a Premodern-legal (ice) printing
    // — chosen (like the earlier fallback test) so a rejection is unambiguously
    // the BANNED reason, not an incidental set-not-allowed from an off-pool
    // printing.
    const NECRO_ID = "54d7a0c1-efb4-4a8d-ad92-a96d43835052";
    const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

    function premodernDeckWith(necroCopies: 0 | 1) {
        return {
            name: "Necro Sync Test",
            format: "premodern",
            cards: [
                ...(necroCopies === 1 ? [card(NECRO_ID, "Necropotence")] : []),
                ...Array.from({ length: 60 - necroCopies }, () =>
                    card(MOUNTAIN, "Mountain")
                ),
            ],
        };
    }

    it("a DB row (simulating a post-sync `formatBanlists` table) rejects a deck with the banned built card", () => {
        // Models the DB read `loadBanlistOverrides` performs: a single fresh
        // row, resolved through the SAME pure core the server helper wraps.
        const dbRows = [
            { cardName: "Necropotence", status: "banned" as const },
        ];
        const banlist = resolveBanlistEnforcementForFormat(
            "premodern",
            dbRows,
            tryGetCardByName
        );
        expect(banlist.banned.size).toBeGreaterThan(0);

        const legalDeck = premodernDeckWith(0);
        expect(() =>
            assertDeckLegal(legalDeck, undefined, banlist)
        ).not.toThrow();

        const illegalDeck = premodernDeckWith(1);
        expect(() => assertDeckLegal(illegalDeck, undefined, banlist)).toThrow(
            /banned/i
        );
    });

    it("empty DB rows fall back to the code-side seed, resolving to the SAME rejection (no silent-legal window pre-sync)", () => {
        // `loadBanlistOverrides` never returns an empty override for an empty
        // table — `resolveBanlistEnforcementForFormat` falls back to
        // `BANLIST_SEEDS[format]` first, so a fresh deploy still enforces a
        // sane banlist.
        const banlistFromEmptyDb = resolveBanlistEnforcementForFormat(
            "premodern",
            [],
            tryGetCardByName
        );
        expect(banlistFromEmptyDb.banned.has(NECRO_ID)).toBe(true);

        const illegalDeck = premodernDeckWith(1);
        expect(() =>
            assertDeckLegal(illegalDeck, undefined, banlistFromEmptyDb)
        ).toThrow(/banned/i);
    });

    it("advisory client and authoritative server never disagree: the seed-resolved override and the bare code-const fallback reject the SAME deck", () => {
        const illegalDeck = premodernDeckWith(1);

        // Path A: `loadBanlistOverrides`-style resolution against an empty DB
        // (the seed fallback inside `resolveBanlistEnforcementForFormat`).
        const seedOverride = resolveBanlistEnforcementForFormat(
            "premodern",
            [],
            tryGetCardByName
        );
        // Path B: no `banlist` argument at all — `validateDeck`'s OWN internal
        // fallback to the code constant `PREMODERN_BANNED` (formats.ts).
        expect(() =>
            assertDeckLegal(illegalDeck, undefined, seedOverride)
        ).toThrow(/banned/i);
        expect(() => assertDeckLegal(illegalDeck)).toThrow(/banned/i);
    });
});

// --- Server-gate integration: Old School — restricted (1-copy) + banned via
// DB overrides (PRD #1138, issue #1147) --------------------------------------
//
// `checkRestricted`/`checkBanned`, `resolveBanlistEnforcement`, and
// `loadBanlistOverrides`/`resolveBanlistEnforcementForFormat` are ALL already
// format-generic (they key off `BanlistOverride.restricted`/`.banned`
// regardless of which `BanlistFormatId` produced them) — issue #1147's actual
// gap was the missing Old School exercise of that same seam the Premodern
// block above already covers, plus proving the RESTRICTED dimension
// specifically (the Premodern slice only exercised `banned`). These tests
// mirror the Premodern "Server-gate integration" block exactly, resolving
// against the REAL card registry (`tryGetCardByName`) and feeding the result
// straight into `assertDeckLegal`.
describe("Server-gate integration — Old School restricted + banned via loadBanlistOverrides resolution (issue #1147)", () => {
    // Regrowth: officially RESTRICTED in Old School (on `OLD_SCHOOL_RESTRICTED`
    // by real Card ID), with an Old-School-legal (lea) printing — chosen so a
    // rejection is unambiguously the RESTRICTED reason, not an incidental
    // set-not-allowed from an off-pool printing.
    const REGROWTH_ID = "badc73ec-3728-4246-90c7-5f4eb7051ed5";
    // Sol Ring: also officially restricted in Old School, but used here as the
    // DB-BANNED subject — a distinct card from Regrowth so the two tests don't
    // overlap — proving `checkBanned` keys off the injected `banned` set
    // independently of what the code-side `OLD_SCHOOL_RESTRICTED`/`OLD_SCHOOL_
    // BANNED` constants say about the same card.
    const SOL_RING_ID = "c4300d24-1cae-4dd5-be7e-38cc677cf5bd";
    // Time Walk: officially RESTRICTED in Old School AND has a real
    // `CardDefinition` (unlike the code `OLD_SCHOOL_BANNED` guard entries —
    // Chaos Orb/Falling Star/Shahrazad — which are all unbuilt stubs with no
    // resolvable id), so it's the one that can prove the empty-DB → code-seed
    // fallback still enforces without a silent-legal window.
    const TIME_WALK_ID = "e0139f60-d48e-46fb-9f5a-1e3d7558c834";
    const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

    function oldSchoolDeckWith(
        cardId: string,
        copies: 0 | 1 | 2
    ): {
        name: string;
        format: "old-school";
        cards: DeckCard[];
    } {
        return {
            name: "Old School Sync Test",
            format: "old-school",
            cards: [
                ...repeat(cardId, copies),
                ...repeat(MOUNTAIN, 60 - copies),
            ],
        };
    }

    it("a DB row (restricted) rejects a deck with 2 copies of the DB-restricted card, allows 1", () => {
        const dbRows = [
            { cardName: "Regrowth", status: "restricted" as const },
        ];
        const banlist = resolveBanlistEnforcementForFormat(
            "old-school",
            dbRows,
            tryGetCardByName
        );
        expect(banlist.restricted.has(REGROWTH_ID)).toBe(true);

        const oneCopy = oldSchoolDeckWith(REGROWTH_ID, 1);
        expect(() =>
            assertDeckLegal(oneCopy, undefined, banlist)
        ).not.toThrow();

        const twoCopies = oldSchoolDeckWith(REGROWTH_ID, 2);
        expect(() => assertDeckLegal(twoCopies, undefined, banlist)).toThrow(
            /restricted/i
        );
    });

    it("a DB row (banned) rejects a deck with the DB-banned built card", () => {
        const dbRows = [{ cardName: "Sol Ring", status: "banned" as const }];
        const banlist = resolveBanlistEnforcementForFormat(
            "old-school",
            dbRows,
            tryGetCardByName
        );
        expect(banlist.banned.has(SOL_RING_ID)).toBe(true);

        const legalDeck = oldSchoolDeckWith(SOL_RING_ID, 0);
        expect(() =>
            assertDeckLegal(legalDeck, undefined, banlist)
        ).not.toThrow();

        const illegalDeck = oldSchoolDeckWith(SOL_RING_ID, 1);
        expect(() => assertDeckLegal(illegalDeck, undefined, banlist)).toThrow(
            /banned/i
        );
    });

    it("empty DB rows fall back to the code-side seed, still enforcing the restricted 1-copy cap (no silent-legal window pre-sync)", () => {
        const banlistFromEmptyDb = resolveBanlistEnforcementForFormat(
            "old-school",
            [],
            tryGetCardByName
        );
        expect(banlistFromEmptyDb.restricted.has(TIME_WALK_ID)).toBe(true);

        const illegalDeck = oldSchoolDeckWith(TIME_WALK_ID, 2);
        expect(() =>
            assertDeckLegal(illegalDeck, undefined, banlistFromEmptyDb)
        ).toThrow(/restricted/i);
    });

    it("advisory client and authoritative server never disagree: the seed-resolved override and the bare code-const fallback reject the SAME deck", () => {
        const illegalDeck = oldSchoolDeckWith(TIME_WALK_ID, 2);

        // Path A: `loadBanlistOverrides`-style resolution against an empty DB
        // (the seed fallback inside `resolveBanlistEnforcementForFormat`).
        const seedOverride = resolveBanlistEnforcementForFormat(
            "old-school",
            [],
            tryGetCardByName
        );
        // Path B: no `banlist` argument at all — `validateDeck`'s OWN internal
        // fallback to the code constant `OLD_SCHOOL_RESTRICTED` (formats.ts).
        expect(() =>
            assertDeckLegal(illegalDeck, undefined, seedOverride)
        ).toThrow(/restricted/i);
        expect(() => assertDeckLegal(illegalDeck)).toThrow(/restricted/i);
    });
});
