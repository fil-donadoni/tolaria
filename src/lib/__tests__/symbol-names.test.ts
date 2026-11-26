import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    SYMBOL_NAMES,
    hasSymbolToken,
    symbolName,
    symbolSrc,
    symbolsToSpokenText,
} from "../symbol-names";

const SYMBOLS_DIR = path.resolve(__dirname, "../../../public/img/symbols");

describe("SYMBOL_NAMES — the one symbol mapping (issue #9834)", () => {
    it("has a row for exactly the symbol assets that exist, both ways", () => {
        const assets = fs
            .readdirSync(SYMBOLS_DIR)
            .filter((f) => f.endsWith(".svg"))
            .map((f) => `/img/symbols/${f}`)
            .sort();
        const mapped = Object.keys(SYMBOL_NAMES).map(symbolSrc).sort();
        expect(mapped).toEqual(assets);
    });

    it("names mana, hybrid, Phyrexian, tap and energy tokens; leaves unmappable ones unnamed", () => {
        expect(symbolName("R")).toBe("red mana");
        expect(symbolName("t")).toBe("tap");
        expect(symbolName("W/U")).toBe("white or blue mana");
        expect(symbolName("2/W")).toBe("two generic or white mana");
        expect(symbolName("B/P")).toBe("Phyrexian black mana");
        expect(symbolName("E")).toBe("energy");
        expect(symbolName("foo")).toBeUndefined();
        expect(hasSymbolToken("config {foo}")).toBe(false);
        expect(hasSymbolToken("Pay {2}")).toBe(true);
    });

    it("renders attribute sinks with spoken names, never braces", () => {
        expect(symbolsToSpokenText("3 energy counters ({E})")).toBe(
            "3 energy counters (energy)"
        );
        expect(symbolsToSpokenText("Pay {2}{R}?")).toBe(
            "Pay 2 generic mana red mana?"
        );
        expect(symbolsToSpokenText("{T}: Add {R}.")).toBe("tap: Add red mana.");
        expect(symbolsToSpokenText("keep {foo}")).toBe("keep {foo}");
    });
});
