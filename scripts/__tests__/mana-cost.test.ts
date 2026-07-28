import { describe, expect, it } from "vitest";
import { parseManaCost, formatManaCost } from "../lib/mana-cost.mjs";

// `scripts/lib/mana-cost.mjs` is the single shared printed-mana-cost parser
// used by both importers (`json-to-cards.mjs` set mode, `list-to-cards.mjs`
// list mode). Before issue #1742, each importer kept its own copy that
// silently dropped anything beyond a digit/`X`/bare colour — hybrid and
// Phyrexian pips vanished, which is how Figure of Destiny imported as a
// costless 1/1 and Vibrance misfiled into `colorless.ts` (its `{R/G}` pips
// gone). These tests are table-driven over the printed symbol families the
// engine `ManaCost` (`convex/cards/types.ts`) actually models, plus the loud
// failure case for everything it doesn't.

describe("parseManaCost — plain digits, X, and bare colours (unchanged behaviour)", () => {
    it.each([
        ["{1}{G}", { X: 1, G: 1 }],
        ["{W}{W}", { W: 2 }],
        ["{2}{U}{U}", { X: 2, U: 2 }],
        ["{X}{R}", { X: "X", R: 1 }],
        ["{X}{X}{U}", { X: "XX", U: 1 }],
        ["{C}", { C: 1 }],
    ] as const)("%s → %o", (mana, expected) => {
        expect(parseManaCost(mana)).toEqual(expected);
    });

    it("returns undefined for no cost (e.g. lands)", () => {
        expect(parseManaCost(undefined)).toBeUndefined();
        expect(parseManaCost("")).toBeUndefined();
    });

    it("returns undefined for {0} — pre-existing behaviour, unrelated to #1742", () => {
        // `genericNum > 0` gates the X field, so a zero-cost artifact (Mox-style)
        // parses to no fields at all rather than `{ X: 0 }`. Unchanged by this
        // fix; documented here so a future change to it is a deliberate choice.
        expect(parseManaCost("{0}")).toBeUndefined();
    });
});

describe("parseManaCost — guild-hybrid pips (CR 202.1a / 107.4e, issue #1742)", () => {
    it('{R/W} → hybrid: [["R","W"]] (acceptance criterion)', () => {
        expect(parseManaCost("{R/W}")).toEqual({ hybrid: [["R", "W"]] });
    });

    it("accumulates one array entry per pip, not deduped/counted (Hogaak shape)", () => {
        expect(parseManaCost("{5}{B/G}{B/G}")).toEqual({
            X: 5,
            hybrid: [
                ["B", "G"],
                ["B", "G"],
            ],
        });
    });

    it("mixes with plain coloured pips", () => {
        expect(parseManaCost("{G/W}{W}")).toEqual({
            W: 1,
            hybrid: [["G", "W"]],
        });
    });
});

describe("parseManaCost — Phyrexian pips (CR 107.4f, issue #1742)", () => {
    it("{1}{B/P}{B/P} → { X: 1, phyrexian: { B: 2 } } (acceptance criterion)", () => {
        // The issue text writes this as `generic/X: 1` — the importers' existing
        // convention (mirrored from json-to-cards.mjs pre-fix) folds a plain
        // printed numeral into the `X` field, never `ManaCost.generic` (that
        // field is reserved for fixed generic that COEXISTS with a variable
        // `{X}` pip, e.g. Soul Burn's `{X}{2}{B}`, which this parser does not
        // attempt to disambiguate — out of scope for this fix).
        expect(parseManaCost("{1}{B/P}{B/P}")).toEqual({
            X: 1,
            phyrexian: { B: 2 },
        });
    });

    it("{U/P} single pip", () => {
        expect(parseManaCost("{U/P}")).toEqual({ phyrexian: { U: 1 } });
    });

    it("mixes phyrexian and hybrid pips on the same cost", () => {
        expect(parseManaCost("{R/W}{B/P}")).toEqual({
            hybrid: [["R", "W"]],
            phyrexian: { B: 1 },
        });
    });
});

describe("parseManaCost — unrecognised symbols fail loudly (issue #1742)", () => {
    it.each([
        ["{S}", "snow"],
        ["{2/W}", "monocolour hybrid"],
        ["{G/U/P}", "Phyrexian-hybrid"],
        ["{Q}", "garbage"],
    ])("%s (%s) throws instead of being silently dropped", (mana) => {
        expect(() => parseManaCost(mana)).toThrow(/unrecognised mana symbol/i);
    });

    it("a legal pip earlier in the string does not mask a later illegal one", () => {
        expect(() => parseManaCost("{1}{G}{S}")).toThrow();
    });
});

describe("formatManaCost — round-trips a parsed cost into TS source", () => {
    it("plain cost", () => {
        expect(formatManaCost({ X: 1, G: 1 })).toBe("{ X: 1, G: 1 }");
    });

    it("undefined cost → empty object literal", () => {
        expect(formatManaCost(undefined)).toBe("{}");
    });

    it("hybrid pips serialize as a nested array", () => {
        expect(formatManaCost({ hybrid: [["R", "W"]] })).toBe(
            '{ hybrid: [["R", "W"]] }'
        );
    });

    it("multiple hybrid pips preserve order/count", () => {
        expect(
            formatManaCost({
                X: 5,
                hybrid: [
                    ["B", "G"],
                    ["B", "G"],
                ],
            })
        ).toBe('{ X: 5, hybrid: [["B", "G"], ["B", "G"]] }');
    });

    it("phyrexian pips serialize as a nested object", () => {
        expect(formatManaCost({ X: 1, phyrexian: { B: 2 } })).toBe(
            "{ X: 1, phyrexian: { B: 2 } }"
        );
    });

    it("a formatted hybrid/phyrexian cost is valid JS object-literal syntax", () => {
        const src = formatManaCost({
            X: 1,
            hybrid: [["R", "W"]],
            phyrexian: { B: 2 },
        });
        const value = new Function(`return (${src});`)();
        expect(value).toEqual({
            X: 1,
            phyrexian: { B: 2 },
            hybrid: [["R", "W"]],
        });
    });
});
