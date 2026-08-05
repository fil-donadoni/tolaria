import { describe, expect, it } from "vitest";
import { parseManaCost, formatManaCost } from "../lib/mana-cost.mjs";
import { normalizeManaCost } from "../../convex/gre/state.ts";

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
        ["{X}{X}{U}", { X: "X", xFactor: 2, U: 1 }],
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

describe("parseManaCost — fixed generic coexisting with variable X (CR 107.3 / 202.3, issue #1774)", () => {
    it.each([
        ["{X}{1}{W}", { X: "X", generic: 1, W: 1 }],
        ["{1}", { X: 1 }],
        ["{X}{X}{U}", { X: "X", xFactor: 2, U: 1 }],
        ["{X}{2}{B}", { X: "X", generic: 2, B: 1 }],
    ] as const)(
        "%s → %o (X-only / generic-only / X+generic table)",
        (mana, expected) => {
            expect(parseManaCost(mana)).toEqual(expected);
        }
    );

    it('{X}{1}{W} → { X: "X", generic: 1, W: 1 } (acceptance criterion — generic pip no longer dropped)', () => {
        expect(parseManaCost("{X}{1}{W}")).toEqual({
            X: "X",
            generic: 1,
            W: 1,
        });
    });

    it("{X}{X}{U} → canonical xFactor: 2 shape, no generic invented (acceptance criterion)", () => {
        // A repeated {X} is CR 107.3's `xFactor` shape (Recall/Part
        // Water/Meteor Shower/Walking Ballista), not a longer X string —
        // `normalizeManaCost` (convex/gre/state.ts) treats any string X as
        // ONE variable pip times `xFactor` (default 1), so `{ X: "XX" }`
        // would price identically to a single {X} and silently undercharge
        // the spell (issue #1774 fixup — see the round-trip test below).
        const result = parseManaCost("{X}{X}{U}");
        expect(result).toEqual({ X: "X", xFactor: 2, U: 1 });
        expect(result).not.toHaveProperty("generic");
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
        // printed numeral into the `X` field when there is no `{X}` pip in the
        // cost. `ManaCost.generic` is reserved for fixed generic that COEXISTS
        // with a variable `{X}` pip, e.g. Soul Burn's `{X}{2}{B}` — see the
        // "fixed generic coexisting with variable X" describe block above
        // (issue #1774). A REPEATED `{X}` pip (`{X}{X}`) is a different case
        // again: the canonical `X: "X", xFactor: 2` shape (CR 107.3), never a
        // longer `X` string — see the `{X}{X}{U}` cases above and the
        // round-trip test below (issue #1774 fixup).
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

    it("fixed generic alongside variable X round-trips (issue #1774, {X}{1}{W} shape)", () => {
        expect(formatManaCost({ X: "X", generic: 1, W: 1 })).toBe(
            '{ X: "X", generic: 1, W: 1 }'
        );
    });

    it("xFactor round-trips instead of being dropped at emit (issue #1774 fixup, Recall {X}{X}{U} shape)", () => {
        // Before this fix COLOR_ORDER omitted "xFactor" entirely, so a
        // correctly-PARSED { X: "X", xFactor: 2, U: 1 } cost was silently
        // stripped back down to `{ X: "X", U: 1 }` at the emit step — the
        // same latent hole the "generic" field had before issue #1774.
        expect(formatManaCost({ X: "X", xFactor: 2, U: 1 })).toBe(
            '{ X: "X", xFactor: 2, U: 1 }'
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

    it("a formatted X+generic cost is valid JS object-literal syntax (issue #1774)", () => {
        const src = formatManaCost({ X: "X", generic: 1, W: 1 });
        const value = new Function(`return (${src});`)();
        expect(value).toEqual({ X: "X", generic: 1, W: 1 });
    });
});

describe("parseManaCost — repeated {X} prices correctly through the engine's own normalizeManaCost (issue #1774 fixup, Recall shape)", () => {
    // The bug this guards against: `cost.X = "X".repeat(xCount)` produces a
    // string like "XX" that LOOKS like it preserves both X's, but
    // `normalizeManaCost` (convex/gre/state.ts) treats ANY string `X` as ONE
    // variable pip multiplied by `xFactor` (default 1) — it never reads the
    // string's length. A `"XX"` cost therefore prices identically to a
    // single `{X}`, silently charging half of what `{X}{X}{U}` should. This
    // test drives the parser's OUTPUT through the real consumer instead of
    // just asserting the object shape, so a regression to the string-repeat
    // encoding fails here even if a future change tolerated it in
    // isolation.
    it("{X}{X}{U} with chosenX: 3 normalizes to U:1, X:6 (twice the chosen X)", () => {
        const parsed = parseManaCost("{X}{X}{U}");
        const normalized = normalizeManaCost(parsed!, { chosenX: 3 });
        expect(normalized).toEqual({ U: 1, X: 6 });
    });

    it("{X}{U} (single X) with chosenX: 3 normalizes to U:1, X:3 — the contrast case", () => {
        const parsed = parseManaCost("{X}{U}");
        const normalized = normalizeManaCost(parsed!, { chosenX: 3 });
        expect(normalized).toEqual({ U: 1, X: 3 });
    });
});
