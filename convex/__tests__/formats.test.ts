import { describe, it, expect } from "vitest";
import {
    FORMAT_IDS,
    FORMAT_RULES,
    isFormatId,
    validateDeck,
    type FormatId,
    type ValidatableDeck,
} from "../formats";
import { normalizeLegacyFormat } from "../userDecks";

// Deck Formats — foundation slice (PRD #509, ADR 0036, issue #510). No legality
// rules are wired yet: every Format's validator returns no reasons, so every
// deck is reported legal. These tests pin that contract and the typed-Format
// boundary (the union, the type guard, the legacy migration).

const sampleDeck: ValidatableDeck = {
    cards: [
        { cardId: "bolt", cardName: "Lightning Bolt" },
        { cardId: "mountain", cardName: "Mountain" },
    ],
    sideboard: [{ cardId: "shatter", cardName: "Shatter" }],
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

describe("validateDeck — foundation slice: all decks legal (issue #510)", () => {
    it.each(FORMAT_IDS as readonly FormatId[])(
        "reports a deck legal with no reasons under %s",
        (format) => {
            const result = validateDeck(sampleDeck, format);
            expect(result.isLegal).toBe(true);
            expect(result.reasons).toEqual([]);
        }
    );

    it("treats an empty deck as legal too (no minimum enforced yet)", () => {
        const empty: ValidatableDeck = { cards: [] };
        for (const id of FORMAT_IDS) {
            expect(validateDeck(empty, id).isLegal).toBe(true);
        }
    });

    it("defends an unknown format by falling back to Freeform (legal)", () => {
        const result = validateDeck(sampleDeck, "made-up" as FormatId);
        expect(result.isLegal).toBe(true);
        expect(result.reasons).toEqual([]);
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
        // Model the internalMutation's loop: each row's raw format normalizes;
        // already-typed rows are untouched, "Freeform" rows flip to "freeform".
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
        // No row dropped; counts add up; every result is a valid FormatId.
        expect(after).toHaveLength(rows.length);
        expect(migrated).toBe(2); // "Freeform" and "Legacy junk"
        expect(unchanged).toBe(2); // already "freeform" and "old-school"
        for (const row of after) expect(isFormatId(row.format)).toBe(true);
        expect(after.map((r) => r.format)).toEqual([
            "freeform",
            "freeform",
            "old-school",
            "freeform",
        ]);
    });
});
