import { describe, expect, it } from "vitest";

import {
    JOIN_CODE_ALPHABET,
    JOIN_CODE_LENGTH,
    formatJoinCode,
    generateJoinCode,
    normalizeJoinCode,
} from "../joinCodes";

/** Pure join-code vocabulary (issue #2649). Randomness lives at the mutation
 *  call site (`Math.random`, the `pickCoinTossWinner` split — `game.ts`), so
 *  everything here is deterministic and testable without a Convex ctx. */
describe("join codes — alphabet", () => {
    it("is Crockford Base32: 32 chars, no I/L/O/U", () => {
        expect(JOIN_CODE_ALPHABET).toHaveLength(32);
        expect(new Set(JOIN_CODE_ALPHABET).size).toBe(32);
        for (const c of "ILOU") expect(JOIN_CODE_ALPHABET).not.toContain(c);
    });
});

describe("join codes — generation", () => {
    it("emits JOIN_CODE_LENGTH characters, all from the alphabet", () => {
        let n = 0;
        const rand = () => ((n++ * 7919) % 1000) / 1000;
        const code = generateJoinCode(rand);
        expect(code).toHaveLength(JOIN_CODE_LENGTH);
        for (const c of code) expect(JOIN_CODE_ALPHABET).toContain(c);
    });

    it("is a pure function of the supplied RNG (no Math.random inside)", () => {
        const seq = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
        const make = () => {
            let i = 0;
            return generateJoinCode(() => seq[i++]!);
        };
        expect(make()).toBe(make());
    });

    it("maps rand()=0 to the first alphabet char and rand()→1 to the last", () => {
        expect(generateJoinCode(() => 0)).toBe(
            JOIN_CODE_ALPHABET[0]!.repeat(JOIN_CODE_LENGTH)
        );
        expect(generateJoinCode(() => 0.999999)).toBe(
            JOIN_CODE_ALPHABET[JOIN_CODE_ALPHABET.length - 1]!.repeat(
                JOIN_CODE_LENGTH
            )
        );
    });

    it("clamps a degenerate rand() of exactly 1 instead of emitting undefined", () => {
        const code = generateJoinCode(() => 1);
        expect(code).toHaveLength(JOIN_CODE_LENGTH);
        for (const c of code) expect(JOIN_CODE_ALPHABET).toContain(c);
    });

    it("spreads over the alphabet for a real RNG", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 200; i++)
            for (const c of generateJoinCode(Math.random)) seen.add(c);
        expect(seen.size).toBeGreaterThan(25);
    });
});

describe("join codes — normalization (fail-closed)", () => {
    it("accepts a canonical code unchanged", () => {
        expect(normalizeJoinCode("K3M9XZ")).toBe("K3M9XZ");
    });

    it("upper-cases and strips separators and whitespace", () => {
        expect(normalizeJoinCode("  k3m-9xz ")).toBe("K3M9XZ");
        expect(normalizeJoinCode("k3m 9xz")).toBe("K3M9XZ");
        expect(normalizeJoinCode("K3M–9XZ")).toBe("K3M9XZ");
    });

    it("folds the visually ambiguous glyphs the alphabet excludes", () => {
        // O/o → 0, I/i/L/l → 1. These are what a human hears/reads wrong.
        expect(normalizeJoinCode("OIL234")).toBe("011234");
        expect(normalizeJoinCode("oil234")).toBe("011234");
    });

    it("rejects the wrong length", () => {
        expect(normalizeJoinCode("K3M9X")).toBeNull();
        expect(normalizeJoinCode("K3M9XZ7")).toBeNull();
        expect(normalizeJoinCode("")).toBeNull();
    });

    it("rejects a character outside the alphabet — including U", () => {
        // U is deliberately absent from Crockford Base32 and is NOT folded:
        // an unknown glyph must fail closed, never resolve to a neighbour.
        expect(normalizeJoinCode("K3M9XU")).toBeNull();
        expect(normalizeJoinCode("K3M9X!")).toBeNull();
        expect(normalizeJoinCode("K3M9Xé")).toBeNull();
    });

    it("rejects a value that is only separators", () => {
        expect(normalizeJoinCode("------")).toBeNull();
    });

    it("round-trips every generated code", () => {
        for (let i = 0; i < 100; i++) {
            const code = generateJoinCode(Math.random);
            expect(normalizeJoinCode(code)).toBe(code);
            expect(normalizeJoinCode(formatJoinCode(code))).toBe(code);
        }
    });
});

describe("join codes — display formatting", () => {
    it("groups the code for reading aloud", () => {
        expect(formatJoinCode("K3M9XZ")).toBe("K3M-9XZ");
    });

    it("normalizes before grouping so any input shape displays canonically", () => {
        expect(formatJoinCode("k3m9xz")).toBe("K3M-9XZ");
    });

    it("returns an unparseable value unchanged rather than inventing a shape", () => {
        expect(formatJoinCode("nope")).toBe("nope");
    });
});
