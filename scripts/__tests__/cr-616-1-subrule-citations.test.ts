import { describe, it, expect } from "vitest";
import {
    formatSubruleHit,
    scanSubruleMiscitations,
} from "../cr-616-1-subrule-citations.ts";
import { readSources } from "../check-cr-citations.ts";

/**
 * CR 616.1c / 616.1d mis-citation guard (issue #3014, ADR 0098).
 *
 * Printed CR 616.1c is copy-as-it-enters and CR 616.1d is enters-with-back-
 * face-up — priority tiers of the replacement-ordering procedure. The
 * once-per-event rule is CR 614.5 and the affected player's free choice of
 * order is CR 616.1e. Ten sites cited the two letters for those claims
 * (corrected in issue #3013); both ids resolve, so the existence scan never saw
 * them.
 *
 * This test runs the same scan `bun run cr:lint` → `check:guards` runs, so a
 * reintroduced mis-citation cannot land either way.
 */
describe("no CR 616.1c/616.1d citation states the once-per-event or ordering rule (issue #3014)", () => {
    it("scans clean against the tracked tree", () => {
        const hits = scanSubruleMiscitations(readSources());
        const report = hits.map(formatSubruleHit).join("\n");
        expect(
            report,
            "CR 616.1c (copy-as-it-enters) / 616.1d (back-face-up) is cited for a " +
                "claim it does not make. Print `bun run cr 614.5` and " +
                `\`bun run cr 616.1\`, and cite the rule that says it:\n${report}`
        ).toBe("");
    });
});

const scanLine = (text: string, file = "convex/gre/fixture.ts") =>
    scanSubruleMiscitations([{ file, text }]);

describe("the scanner itself flags a bad citation and passes the shapes it must not touch", () => {
    it("flags CR 616.1d cited for the once-per-event rule, naming CR 614.5", () => {
        const hits = scanLine("// CR 616.1d — applies once per event.");
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({
            file: "convex/gre/fixture.ts",
            line: 1,
        });
        expect(formatSubruleHit(hits[0])).toContain("CR 614.5");
    });

    it("flags CR 616.1c cited for the affected player choosing the order, naming CR 616.1e", () => {
        const hits = scanLine(
            "// CR 616.1c — the affected player orders them."
        );
        expect(hits).toHaveLength(1);
        expect(formatSubruleHit(hits[0])).toContain("CR 616.1e");
    });

    it("flags the swapped letter too — both ids are checked for both claims", () => {
        expect(
            scanLine(
                "// CR 616.1c: a replacement applies at most once per event."
            )
        ).toHaveLength(1);
        expect(
            scanLine("// replacement order (CR 616.1d) is APNAP.")
        ).toHaveLength(1);
    });

    it("flags a bare id inside a slash-list on a CR line", () => {
        expect(
            scanLine(
                "// CR 614.5 / 616.1d — a replacement applies once per event."
            )
        ).toHaveLength(1);
    });

    it("flags the claim-bearing lines issue #3013 corrected (ade72cfc1)", () => {
        const corrected = [
            " *    re-trigger the replacement (CR 616.1d — a replacement applies once per",
            "// CR 616.1d: a given replacement applies at most once per event. The loop",
            " *  already redirected (CR 616.1d — a redirected event isn't re-intercepted). */",
            "        // CR 616.1c — the affected (drawing) player orders them; own first.",
            "// replacement order (CR 616.1c) is currently deterministic — APNAP, then",
            " *  `event`, in the order the AFFECTED player (the drawing player, CR 616.1c)",
        ];
        for (const line of corrected) {
            expect(scanLine(line), line).toHaveLength(1);
        }
    });

    // Each legitimate fixture ALSO carries a claim word ("once", "order"), so
    // it passes only because the line names the subrule's real subject — a
    // claim-free fixture would pass with the exemption deleted.
    it("passes a genuine CR 616.1d citation about a card entering with its back face up", () => {
        expect(
            scanLine(
                "// CR 616.1d — once a replacement would make the card enter with its back face up, it must be chosen first."
            )
        ).toHaveLength(0);
    });

    it("passes a genuine CR 616.1c citation about entering as a copy", () => {
        expect(
            scanLine(
                "// CR 616.1c — the copy-as-it-enters replacement comes first in the order."
            )
        ).toHaveLength(0);
    });

    it("passes the corrected citations", () => {
        expect(
            scanLine("// CR 614.5 — a replacement applies once per event.")
        ).toHaveLength(0);
        expect(
            scanLine("// CR 616.1e — the affected player chooses the order.")
        ).toHaveLength(0);
    });

    it("passes the ids when the line is not a CR citation at all", () => {
        expect(
            scanLine("const step = '616.1d'; // runs once per event")
        ).toHaveLength(0);
    });

    it("respects the inline cr-cite-ok suppression", () => {
        expect(
            scanLine(
                "// CR 616.1d — applies once per event. cr-cite-ok (illustrative counter-example)"
            )
        ).toHaveLength(0);
    });
});
