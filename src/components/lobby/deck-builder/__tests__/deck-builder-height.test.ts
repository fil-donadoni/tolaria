// `DeckBuilder` (the catalogue-wide /decks/create builder) has no render
// harness in this suite — it needs a full DragDropProvider + catalogue +
// mutation-sink graph to mount, which none of the existing tests attempt.
// These are structural (source-text) assertions instead of a render test —
// legitimate here because every literal this checks is a static className
// string, not something computed per-render (see `game-stack-narrow.test.tsx`
// for the same pattern used elsewhere in this repo). A render-based
// assertion would be strictly stronger; this is the pragmatic substitute.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "..", "deck-builder.tsx"), "utf8");

describe("DeckBuilder — root surface height (issue #2056 defect 3)", () => {
    it("the root claims flex-1 min-h-0 (the shell's remaining height), never h-dvh", () => {
        expect(SRC).toContain(
            '"flex flex-1 min-h-0 flex-col bg-surface-base text-text"'
        );
        expect(SRC).not.toMatch(/"flex h-dvh flex-col/);
    });
});

describe("DeckBuilder — card-size floor (issue #2056 defect 1)", () => {
    it("CARD_BASE routes through the shared cardBase() floor, not a bare min() literal", () => {
        expect(SRC).toContain('import { cardBase } from "~/lib/cardSizing";');
        expect(SRC).toContain(
            'const CARD_BASE = cardBase("8rem", "18vw", "9.5dvh");'
        );
    });
});

describe("DeckBuilder — short-viewport chrome treatment (issue #2056 defect 2)", () => {
    it("the header band and title carry short-viewport overrides", () => {
        expect(SRC).toContain("short-viewport:py-1");
        expect(SRC).toContain("short-viewport:text-sm");
    });
});
