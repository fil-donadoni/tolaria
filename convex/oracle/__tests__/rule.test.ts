// The combinator layer's three structural guarantees (convex/oracle/rule.ts).
//
// These are GUARDING tests in the strict sense: each one names a way a
// permissive parser silently drops input, and asserts this one cannot. They are
// the reason the compiler can claim "all-consuming" as a property rather than
// as an intention, so they matter more than any individual card's test.

import { describe, expect, it } from "vitest";
import {
    atom,
    fail,
    listOf,
    literal,
    map,
    notYetImplemented,
    ok,
    oneOf,
    pair,
    parse,
    pattern,
    rule,
    terminated,
} from "../rule";

const NO_CTX = undefined;

describe("Rule results carry no residue", () => {
    it("a successful result has only ok+value — there is no field to drop", () => {
        const result = parse(literal("Flying"), "Flying", NO_CTX);
        expect(result.ok).toBe(true);
        expect(Object.keys(result).sort()).toEqual(["ok", "value"]);
    });

    it("a literal that matches only a PREFIX fails instead of consuming it", () => {
        const result = parse(literal("Flying"), "Flying, vigilance", NO_CTX);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.fragment).toBe("Flying, vigilance");
    });

    it("a failure names the fragment it could not consume", () => {
        const result = parse(literal("Flying"), "Shadow", NO_CTX);
        expect(result).toEqual({
            ok: false,
            reason: 'expected "Flying"',
            fragment: "Shadow",
        });
    });
});

describe("atom — exact table lookup, case-insensitive", () => {
    const table = new Map([
        ["flying", "F"],
        ["trample", "T"],
    ]);

    it("matches a whole span", () => {
        expect(parse(atom("kw", table), "Flying", NO_CTX)).toEqual({
            ok: true,
            value: "F",
        });
    });

    it("refuses a span that merely contains a key", () => {
        expect(parse(atom("kw", table), "Flying and trample", NO_CTX).ok).toBe(
            false
        );
    });
});

describe("pattern — anchoring is enforced at construction", () => {
    it("throws on an unanchored regex rather than allowing a prefix match", () => {
        expect(() => pattern("n", /\d+/, (m) => m[0])).toThrow(/anchored/);
        expect(() => pattern("n", /^\d+/, (m) => m[0])).toThrow(/anchored/);
        expect(() => pattern("n", /\d+$/, (m) => m[0])).toThrow(/anchored/);
    });

    it("throws on a /g regex, whose lastIndex would make the rule stateful", () => {
        expect(() => pattern("n", /^\d+$/g, (m) => m[0])).toThrow(/lastIndex/);
    });

    it("accepts an anchored regex and consumes the whole span", () => {
        const number = pattern("number", /^(\d+)$/, (m) => Number(m[1]));
        expect(parse(number, "42", NO_CTX)).toEqual({ ok: true, value: 42 });
        expect(parse(number, "42 cards", NO_CTX).ok).toBe(false);
    });

    it("lets the mapper reject a value that is shaped right but out of range", () => {
        const small = pattern<number>("small", /^(\d+)$/, (m, span) => {
            const n = Number(m[1]);
            return n < 10 ? ok(n) : fail("too large", span);
        });
        expect(parse(small, "5", NO_CTX).ok).toBe(true);
        expect(parse(small, "50", NO_CTX).ok).toBe(false);
    });
});

describe("oneOf — unique alternation, never first-branch-wins", () => {
    const broad = rule<string>("broad", (span) =>
        span.startsWith("Fly") ? ok("broad") : fail("nope", span)
    );
    const precise = literal("Flying");

    it("returns the single alternative that matched", () => {
        expect(
            parse(
                oneOf("kw", [precise, rule("never", (s) => fail("no", s))]),
                "Flying",
                NO_CTX
            )
        ).toEqual({
            ok: true,
            value: "Flying",
        });
    });

    it("FAILS when two alternatives both consume the span — it does not pick one", () => {
        const result = parse(
            oneOf<string>("kw", [broad, precise]),
            "Flying",
            NO_CTX
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/ambiguous/);
    });

    it("is order-independent: swapping the alternatives gives the same answer", () => {
        const a = parse(
            oneOf<string>("kw", [broad, precise]),
            "Flying",
            NO_CTX
        );
        const b = parse(
            oneOf<string>("kw", [precise, broad]),
            "Flying",
            NO_CTX
        );
        expect(a).toEqual(b);
    });

    it("refuses to be built with no alternatives", () => {
        expect(() => oneOf("empty", [])).toThrow();
    });
});

describe("listOf — a list cannot lose its tail", () => {
    const table = new Map([
        ["flying", "F"],
        ["trample", "T"],
    ]);
    const kws = listOf("kws", ", ", atom("kw", table));

    it("consumes every element", () => {
        expect(parse(kws, "Flying, trample", NO_CTX)).toEqual({
            ok: true,
            value: ["F", "T"],
        });
    });

    it("fails the WHOLE list when one element is unknown", () => {
        const result = parse(kws, "Flying, banding", NO_CTX);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.fragment).toBe("banding");
    });

    it("split parts always rejoin to the original span", () => {
        const spans = ["a, b", "a", "a, b, c", "a, , b"];
        for (const span of spans)
            expect(span.split(", ").join(", ")).toBe(span);
    });

    it("refuses to be built with an empty separator", () => {
        expect(() => listOf("x", "", literal("a"))).toThrow();
    });
});

describe("pair — every split point is tried, ambiguity fails", () => {
    const anything = rule<string>("anything", (span) => ok(span));

    it("splits at the single viable separator", () => {
        const p = pair(
            "cost:effect",
            ": ",
            literal("{T}"),
            literal("Add {G}."),
            (a, b) => `${a}|${b}`
        );
        expect(parse(p, "{T}: Add {G}.", NO_CTX)).toEqual({
            ok: true,
            value: "{T}|Add {G}.",
        });
    });

    it("FAILS when more than one split point parses — it does not take the first", () => {
        const p = pair(
            "ambiguous",
            ": ",
            anything,
            anything,
            (a, b) => `${a}|${b}`
        );
        const result = parse(p, "a: b: c", NO_CTX);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/ambiguous/);
    });

    it("fails when the separator is absent", () => {
        const p = pair(
            "cost:effect",
            ": ",
            anything,
            anything,
            (a, b) => `${a}|${b}`
        );
        expect(parse(p, "no separator here", NO_CTX).ok).toBe(false);
    });
});

describe("terminated — the terminator is consumed, never ignored", () => {
    const inner = literal("Add {G}");

    it("strips a terminator that is present", () => {
        expect(parse(terminated(".", inner), "Add {G}.", NO_CTX).ok).toBe(true);
    });

    it("fails when the terminator is missing rather than parsing without it", () => {
        expect(parse(terminated(".", inner), "Add {G}", NO_CTX).ok).toBe(false);
    });

    it("fails when text follows the terminator", () => {
        expect(
            parse(terminated(".", inner), "Add {G}. Draw a card.", NO_CTX).ok
        ).toBe(false);
    });
});

describe("map and notYetImplemented", () => {
    it("map cannot affect consumption", () => {
        const doubled = map(
            pattern("n", /^(\d+)$/, (m) => Number(m[1])),
            (n) => n * 2
        );
        expect(parse(doubled, "21", NO_CTX)).toEqual({ ok: true, value: 42 });
        expect(parse(doubled, "21 cards", NO_CTX).ok).toBe(false);
    });

    it("a stub FAILS — it never returns a neutral value", () => {
        const stub = notYetImplemented<string>("target filter", "#2697");
        const result = parse(stub, "target creature you control", NO_CTX);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/#2697/);
    });
});
