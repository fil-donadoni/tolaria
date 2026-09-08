// The seeding CLIs must print what the mutation threw (issue #3174).
//
// Every fixture below is stderr CAPTURED from a real `convex run` refusal —
// verbatim, framing lines included. The test is offline by construction: the
// bug was that the framing outranked the message, and framing is a string
// problem, not a deployment one.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexRunErrorMessage } from "../lib/convex-run-error";

/** Captured while seeding Oath Ponza (issue #3168), the failure that filed
 *  issue #3174. `decks:seedPresetDirect` throws the `slug mismatch` text. */
const SLUG_MISMATCH = [
    '✖ Failed to run function "decks:seedPresetDirect":',
    "",
    "Error: [Request ID: 52e10260d66b5213] Server Error",
    'Uncaught Error: slug mismatch: canonical list says "nope", the name "Untitled preset" derives "untitled-preset"',
    "    at handler (../convex/decks.ts:519:16)",
    "",
].join("\n");

/** The case `seed-scenario-run.ts`'s own doc comment promises the operator —
 *  `seedScenarioDirect` puts the offending names in the message
 *  (`convex/debugScenarios.ts:72`). */
const UNKNOWN_CARDS = [
    '✖ Failed to run function "debugScenarios:seedScenarioDirect":',
    "",
    "Error: [Request ID: 9f31c0a8b7d24e15] Server Error",
    "Uncaught Error: Unknown card name(s): Blacker Lotus, Sol Rong",
    "    at handler (../convex/debugScenarios.ts:72:19)",
    "",
].join("\n");

/** The Format refusal a preset seed hits when the list is not legal. */
const NOT_LEGAL = [
    '✖ Failed to run function "decks:seedPresetDirect":',
    "Error: [Request ID: aa11bb22cc33dd44] Server Error",
    "Uncaught Error: deck is not legal in premodern: Mana Drain is banned",
    "    at handler (../convex/decks.ts:531:16)",
].join("\n");

describe("convexRunErrorMessage — the thrown message, not the framing", () => {
    it("returns the slug mismatch, not the banner and not Server Error", () => {
        const message = convexRunErrorMessage(SLUG_MISMATCH);
        expect(message).toBe(
            'slug mismatch: canonical list says "nope", the name "Untitled preset" derives "untitled-preset"'
        );
        expect(message).not.toContain("Failed to run function");
        expect(message).not.toContain("Server Error");
        expect(message).not.toContain("Request ID");
    });

    it("returns the unresolved card names seed:scenario promises", () => {
        expect(convexRunErrorMessage(UNKNOWN_CARDS)).toBe(
            "Unknown card name(s): Blacker Lotus, Sol Rong"
        );
    });

    it("returns the Format refusal", () => {
        expect(convexRunErrorMessage(NOT_LEGAL)).toBe(
            "deck is not legal in premodern: Mana Drain is banned"
        );
    });

    it("caps the message so a giant throw cannot flood the terminal", () => {
        const long = `Uncaught Error: Unknown card name(s): ${"x".repeat(500)}`;
        expect(convexRunErrorMessage(long)).toHaveLength(300);
        expect(convexRunErrorMessage(long, 40)).toHaveLength(40);
    });

    it("falls back to the last contentful line when nothing threw", () => {
        expect(convexRunErrorMessage("npx: command not found\n")).toBe(
            "npx: command not found"
        );
    });

    it("never returns an empty string", () => {
        expect(convexRunErrorMessage("")).toBe("unknown failure");
        expect(convexRunErrorMessage("\n  \n")).toBe("unknown failure");
    });

    it("degrades to the transport line only when nothing was thrown", () => {
        // No inner throw to prefer. `Server Error` is genuinely all the
        // deployment said — but the request id, which identifies nothing to
        // the operator, still goes.
        expect(
            convexRunErrorMessage(
                '✖ Failed to run function "decks:seedPresetDirect":\nError: [Request ID: abc] Server Error'
            )
        ).toBe("Server Error");
    });
});

describe("one implementation, both callers", () => {
    const read = (rel: string) =>
        readFileSync(join(import.meta.dirname, "..", rel), "utf8");

    it.each([["lib/seed-scenario-run.ts"], ["seed-preset-deck.ts"]])(
        "%s reads the message through the shared helper",
        (rel) => {
            const source = read(rel);
            expect(source).toContain("convexRunErrorMessage");
            // A second copy is what produced the worse of the two pickers.
            expect(source).not.toMatch(/function\s+\w*[Uu]sefulLine/);
            expect(source).not.toMatch(/lines\.find\(/);
        }
    );
});
