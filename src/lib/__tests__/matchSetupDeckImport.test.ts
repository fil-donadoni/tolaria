// Strict setup-flow import (PRD #5334 stories 41–48, issue #5343).
import { describe, expect, it } from "vitest";
import { getAllCardNames } from "@convex/cards";
import {
    IMPORT_FORMAT_CHOICES,
    importFormat,
    strictImportDeck,
} from "../matchSetupDeckImport";

const NAME = getAllCardNames()[0];

describe("strictImportDeck", () => {
    it("lists every unsupported line and refuses the import", () => {
        const result = strictImportDeck(
            "Mine",
            `4 ${NAME}\n4 Not A Real Card\nnonsense line`,
            "freeform"
        );
        expect(result).toEqual({
            ok: false,
            errors: [
                "Unsupported line: 4 Not A Real Card",
                "Unsupported line: nonsense line",
            ],
        });
    });

    it("refuses an inadmissible deck with its legality reasons", () => {
        const result = strictImportDeck("Mine", `1 ${NAME}`, "premodern");
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors.join(" ")).not.toMatch(/Unsupported/);
        }
    });

    it("refuses a blank name and an empty list", () => {
        expect(strictImportDeck("  ", `1 ${NAME}`, "freeform")).toEqual({
            ok: false,
            errors: ["Name the deck."],
        });
        expect(strictImportDeck("Mine", "", "freeform")).toEqual({
            ok: false,
            errors: ["The decklist is empty."],
        });
    });

    it("returns the create payload for the chosen Format on success", () => {
        const result = strictImportDeck(
            " Mine ",
            `2x ${NAME}\nSideboard\n1 ${NAME}`,
            "freeform"
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.payload.name).toBe("Mine");
            expect(result.payload.format).toBe("freeform");
            expect(result.payload.cards).toHaveLength(2);
            expect(result.payload.sideboard).toHaveLength(1);
        }
    });
});

describe("importFormat", () => {
    it("is the Match Format, except under Freeform where the select decides", () => {
        expect(importFormat("premodern", "old-school")).toBe("premodern");
        expect(importFormat("freeform", "old-school")).toBe("old-school");
    });
});

describe("IMPORT_FORMAT_CHOICES", () => {
    it("omits Formats a pasted list cannot be (Limited, Tabletop)", () => {
        expect(IMPORT_FORMAT_CHOICES).not.toContain("limited");
        expect(IMPORT_FORMAT_CHOICES).not.toContain("manual");
        expect(IMPORT_FORMAT_CHOICES).toContain("freeform");
    });
});
