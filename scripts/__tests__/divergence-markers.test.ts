import { describe, it, expect } from "vitest";
import {
    scanText,
    isNegatedConfession,
    isAiEffectsShadowContext,
    blankNegatedConfessions,
} from "../lib/divergence-markers";

/**
 * `scripts/lib/divergence-markers.ts` (issue #2560) — the scanner extracted
 * out of Guard B's test so both Guard B (presence) and the marker-LIVENESS
 * sweep (`scripts/check-marker-liveness.ts`, resolves openness via `gh`)
 * share one parser. The marker/disposition regexes and paragraph scoping are
 * unchanged from Guard B (still exercised by
 * `convex/cards/__tests__/divergenceMarkers.test.ts`, which now imports this
 * module); what is new here is `issueNumbers` — WHICH `#NNN` a marker's own
 * paragraph names as ITS tracking ref, which only the liveness sweep needs.
 */
describe("scanText — issueNumbers extraction (issue #2560)", () => {
    it("extracts every explicit tracked-by: #NNN, deduped and ascending", () => {
        const text = [
            "// DEFERRED: needs work (tracked-by: #200, and also tracked-by: #100).",
            "export const foo = 1;",
        ].join("\n");
        const hits = scanText("fake/file.ts", text);
        expect(hits).toHaveLength(1);
        expect(hits[0].file).toBe("fake/file.ts");
        expect(hits[0].tracked).toBe(true);
        expect(hits[0].issueNumbers).toEqual([100, 200]);
    });

    it("ignores a bare #NNN with no tracked-by: prefix — Guard B accepts it as PRESENCE, liveness does not resolve it (too overloaded: completion citations, provenance, sibling refs)", () => {
        // Measured case: atq/colorless.ts — "tracked-by: #2064; supersedes
        // the closed #277". #2064 is the live ref; #277 is deliberately
        // documented history, not this marker's own disposition.
        const text =
            "// DIVERGENCE (tracked-by: #2064; supersedes the closed #277): the effect\n" +
            "export const foo = 1;";
        expect(scanText("f.ts", text)[0].issueNumbers).toEqual([2064]);

        // Measured case: ice/white.ts — "Sacred Boon — ACTIVE (#734)" cites
        // the (closed) issue that shipped the gap, not an open tracker.
        const noTrackedBy =
            "// TODO: this thing is not built yet, see #4242 and #100\n" +
            "export const foo = 1;";
        expect(scanText("f.ts", noTrackedBy)[0].issueNumbers).toEqual([]);
    });

    it("an out-of-scope disposition with no #NNN yields an empty issueNumbers array", () => {
        const text =
            "// TODO: out of scope — ante mechanics are never built\n" +
            "export const x = 1;";
        const hits = scanText("f.ts", text);
        expect(hits[0].tracked).toBe(true);
        expect(hits[0].issueNumbers).toEqual([]);
    });

    it("issueNumbers is scoped to the marker's own paragraph, not a ref in a different paragraph", () => {
        // Same paragraph-break fixture shape as Guard B's own regression
        // tests (divergenceMarkers.test.ts) — a blank `//` line separates
        // the card-intro provenance ref from the divergence note below it.
        const text = [
            "// Foo — draws a card. Migrated in #833 (ADR 0004).",
            "//",
            "// DEFERRED: second clause not built.",
            "export const foo = 1;",
        ].join("\n");
        const hits = scanText("f.ts", text);
        expect(hits).toHaveLength(1);
        expect(hits[0].tracked).toBe(false);
        // #833 lives in the paragraph ABOVE the blank-`//` break — must not
        // leak into this marker's issueNumbers.
        expect(hits[0].issueNumbers).toEqual([]);
    });
});

// Direct unit coverage for the two false-positive suppressors added in issue
// #1900's widening — until now both were exercised only INDIRECTLY, via the
// catalogue sweep in `convex/cards/__tests__/divergenceMarkers.test.ts`
// (which just asserts the whole-repo offender list is empty and would not
// pin down WHY a given site is or isn't suppressed). Issue #1900 fixup round
// 3, finding 1.
describe("isNegatedConfession (issue #1900 fixup round 3, finding 1)", () => {
    it("suppresses a line whose ONLY confession word is the negated one", () => {
        // neo/red.ts's real shape: the negation ('not') sits on the line
        // above, its object ('approximation') on the marker's own line.
        const lines = [
            "// cards. CR 121.2 makes this not an",
            "// approximation of the clause, it IS the clause.",
        ];
        expect(isNegatedConfession(lines, 1)).toBe(true);
    });

    it("regression: does NOT suppress the whole hit when an INDEPENDENT confession word survives the blanking (the round-2 bug the reviewer broke)", () => {
        // Round 2's `isNegatedConfession` dropped the entire hit whenever
        // ANY `not|no … approximat*/divergence` window matched anywhere on
        // the joined text — so this line, an unambiguous 'Deferred'
        // confession that merely happens to also contain an unrelated 'no
        // Op models this divergence' phrase, silently vanished from Guard B.
        const confession =
            "// Deferred: no Op models this divergence yet, so the clause is dropped.";
        expect(isNegatedConfession([confession], 0)).toBe(false);

        // Control — the same shape with no independent confession word: the
        // suppression should NOT fire (nothing to negate), same as before.
        const noNegation = "// Deferred: the clause is dropped.";
        expect(isNegatedConfession([noNegation], 0)).toBe(false);

        // Same shape with a SIMPLIFICATION confession instead of Deferred,
        // and the negation window landing on 'divergence' instead of
        // 'approximat*' — both vocabulary branches must survive blanking.
        const simplification =
            "// SIMPLIFICATION: no engine seam, so the divergence stands, tracked-by: #1.";
        expect(isNegatedConfession([simplification], 0)).toBe(false);
    });

    it("blankNegatedConfessions removes only the negated span, not the whole line", () => {
        const blanked = blankNegatedConfessions(
            "",
            "// Deferred: no Op models this divergence yet, so the clause is dropped."
        );
        expect(blanked).toContain("Deferred:");
        expect(blanked).not.toMatch(/divergence/i);
    });

    it("does not suppress a genuine, unrelated confession with no nearby negation", () => {
        const lines = [
            "// DEFERRED: this thing is not built yet, no ref here.",
        ];
        // "not built" / "no ref" are nowhere near 'approximat*'/'divergence'
        // — MARKER still fires and nothing here is a disclaimer.
        expect(isNegatedConfession(lines, 0)).toBe(false);
    });
});

describe("isAiEffectsShadowContext (issue #1900 fixup round 3, finding 1)", () => {
    it("suppresses a confession word inside an aiEffects shadow-script paragraph", () => {
        // big/green.ts's real shape: the `aiEffects (PRD #1423, ...)` anchor
        // sits several comment lines above the word 'Approximates'.
        const lines = [
            "// aiEffects (PRD #1423, issue #1431/#2364) — bare resolve() closure,",
            "// so the bot's value model has nothing to walk without a shadow",
            "// script.",
            "// Approximates",
            "// the real effect closely enough for valuation.",
        ];
        expect(isAiEffectsShadowContext(lines, 3)).toBe(true);
    });

    it("does not suppress a confession word with no aiEffects anchor nearby", () => {
        const lines = ["// SIMPLIFICATION: approximates the printed clause."];
        expect(isAiEffectsShadowContext(lines, 0)).toBe(false);
    });
});
