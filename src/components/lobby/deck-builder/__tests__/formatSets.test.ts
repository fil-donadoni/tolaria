import { describe, expect, it } from "vitest";
import type { CardPrinting } from "@convex/cards";
import { FORMAT_RULES, type FormatId } from "@convex/formats";
import { matchesFormatSets } from "../useCardSearch";

// Issue #514: the deck-builder card search is pre-filtered to the deck's Format
// allowed sets. `matchesFormatSets` is the pure gate the search composes in. It
// reads the set list from the Format registry (never a hardcoded list here), so
// these tests key off `FORMAT_RULES[...].allowedSets`.

function prints(...setCodes: string[]): CardPrinting[] {
    return setCodes.map((setCode, i) => ({
        printId: `${setCode}-${i}`,
        setCode,
    }));
}

function allowed(format: FormatId): string[] | null {
    return FORMAT_RULES[format].allowedSets;
}

describe("matchesFormatSets — per-format set narrowing (issue #514)", () => {
    describe("Freeform imposes no filter", () => {
        it("accepts a card from any set", () => {
            expect(
                matchesFormatSets(prints("xyz"), [], allowed("freeform"))
            ).toBe(true);
        });

        it("accepts a card with no printings at all", () => {
            expect(matchesFormatSets([], [], allowed("freeform"))).toBe(true);
        });
    });

    describe("Alpha 40 — only lea/leb (plus basics)", () => {
        const sets = allowed("alpha-40");

        it("shows a card printed in lea", () => {
            expect(matchesFormatSets(prints("lea"), [], sets)).toBe(true);
        });

        it("shows a card printed in leb", () => {
            expect(matchesFormatSets(prints("leb"), [], sets)).toBe(true);
        });

        it("hides a card printed only in a later set", () => {
            expect(matchesFormatSets(prints("arn"), [], sets)).toBe(false);
        });

        it("shows a card with at least one allowed printing", () => {
            expect(matchesFormatSets(prints("arn", "leb"), [], sets)).toBe(
                true
            );
        });

        it("always shows basic lands regardless of their set", () => {
            expect(
                matchesFormatSets(prints("xyz"), ["Basic", "Land"], sets)
            ).toBe(true);
        });
    });

    describe("Old School — the allowed sets", () => {
        const sets = allowed("old-school");

        it("matches the registry's allowed-set list exactly", () => {
            expect(sets).toEqual([
                "lea",
                "leb",
                "2ed",
                "3ed",
                "arn",
                "atq",
                "leg",
                "drk",
            ]);
        });

        for (const code of [
            "lea",
            "leb",
            "2ed",
            "3ed",
            "arn",
            "atq",
            "leg",
            "drk",
        ] as const) {
            it(`shows a card printed in ${code}`, () => {
                expect(matchesFormatSets(prints(code), [], sets)).toBe(true);
            });
        }

        it("hides a card from a set outside the six", () => {
            expect(matchesFormatSets(prints("fem"), [], sets)).toBe(false);
        });

        it("always shows basic lands", () => {
            expect(
                matchesFormatSets(prints("fem"), ["Basic", "Land"], sets)
            ).toBe(true);
        });
    });
});
