import { describe, it, expect } from "vitest";
import * as path from "path";
import { findMisplacedBlocks, misplacedBlocks } from "../lib/cardTestPlacement";

/**
 * Card-test colour placement guard (issue #2256, ADR 0043).
 *
 * A card's `describe` block belongs in the colour test file parallel to the
 * colour module defining the card. Tests reach cards by `getDefinition(uuid)`,
 * so the drift is invisible at the import site; 11 blocks had accumulated
 * (Dwarven Song under `leg/__tests__/white.test.ts`, …). The rule and its
 * edges are documented in `scripts/lib/cardTestPlacement.ts`.
 */

const SETS = path.resolve(__dirname, "../../convex/cards/sets");

describe("card tests live in their card's colour test file (issue #2256)", () => {
    it("no colour test file holds a describe block for another colour's card", () => {
        const bad = findMisplacedBlocks(SETS).map(
            (b) =>
                `${b.file}:${b.line} "${b.title}" names ${b.named.join(", ")}`
        );
        expect(
            bad,
            "move each block to the test file parallel to its card's colour module"
        ).toEqual([]);
    });

    describe("rule edges (synthetic)", () => {
        const names = new Map([
            ["Dwarven Song", new Set(["red"])],
            ["Great Wall", new Set(["white"])],
            ["Undertow", new Set(["blue"])],
        ]);
        const run = (title: string, colour: string) =>
            misplacedBlocks(
                "x.test.ts",
                `describe("${title}", () => {});\n`,
                colour,
                names
            );

        it("flags a block naming only another colour's card", () => {
            expect(run("Dwarven Song (CR 305.7)", "white")).toHaveLength(1);
        });
        it("accepts the card in its own colour file", () => {
            expect(run("Dwarven Song (CR 305.7)", "red")).toEqual([]);
        });
        it("accepts a mixed block when one named card is own-colour", () => {
            expect(run("Great Wall / Undertow", "white")).toEqual([]);
        });
        it("ignores a block naming no card", () => {
            expect(run("mana-tap triggers fire end-to-end", "white")).toEqual(
                []
            );
        });
    });
});
