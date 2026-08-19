import { describe, it, expect } from "vitest";
import { scanText } from "../lib/divergence-markers";

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
