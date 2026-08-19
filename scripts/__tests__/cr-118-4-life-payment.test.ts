import { describe, it, expect } from "vitest";
import {
    formatLifePaymentHit,
    scanLifePaymentMiscitations,
} from "../cr-118-4-life-payment.ts";
import { readSources } from "../check-cr-citations.ts";

/**
 * CR 118.4 life-payment mis-citation guard (issue #2559, ADR 0098).
 *
 * Printed CR 118.4 is "Some costs include an {X} or an X. See rule 107.3." —
 * it says nothing about life. The rule that governs a life-payment cost's
 * legality ("only if the payer's life total is >= the amount") and that
 * paying life IS losing life is CR 119.4. 93 of 100 `CR 118.4` sites in this
 * repo cited it for exactly that life claim; the other 7 cite it correctly
 * ALONGSIDE CR 119.4 for a genuine `{X}` cost (Toxic Deluge's "pay X life").
 *
 * This test runs the same scan `bun run cr:lint` → `check:guards` runs, so a
 * reintroduced mis-citation cannot land either way (the belt to that guard's
 * braces, exactly as `cr-keyword-citations.test.ts` does for the keyword scan).
 */
describe("no CR 118.4 citation is attached to a claim about paying life (issue #2559)", () => {
    it("scans clean against the tracked tree", () => {
        const hits = scanLifePaymentMiscitations(readSources());
        const report = hits.map(formatLifePaymentHit).join("\n");
        expect(
            report,
            'CR 118.4 ("some costs include an X") is cited for a life-payment ' +
                "claim — that's CR 119.4. Print `bun run cr 119.4` and fix the " +
                "citation; if the line also names an X cost, cite both " +
                `("CR 118.4 / 119.4"):\n${report}`
        ).toBe("");
    });
});

/**
 * Proof-of-failure fixtures: the scanner must flag the bad shape, pass the
 * dual-citation shape it exists to permit, and pass an unrelated CR 118.4
 * citation untouched (energy, mana — not a life claim on that line).
 */
describe("the scanner itself flags a bad citation and passes the shapes it must not touch", () => {
    it("flags a bare life-payment claim citing CR 118.4", () => {
        const hits = scanLifePaymentMiscitations([
            {
                file: "convex/gre/fixture.ts",
                text: '// CR 118.4 — a "pay N life" cost is illegal unless the payer has enough.',
            },
        ]);
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({
            file: "convex/gre/fixture.ts",
            line: 1,
        });
    });

    it("passes the dual citation for a genuine X-cost life payment (Toxic Deluge shape)", () => {
        const hits = scanLifePaymentMiscitations([
            {
                file: "convex/cards/fixture.ts",
                text: "// pay X life. All creatures get -X/-X (CR 118.4 / 119.4 pay-X-life).",
            },
        ]);
        expect(hits).toHaveLength(0);
    });

    it("passes CR 118.4 cited for something other than life on that line", () => {
        const hits = scanLifePaymentMiscitations([
            {
                file: "convex/cards/fixture.ts",
                text: "// spends `n` energy counters (CR 118.4 — an unpayable cost isn't paid).",
            },
        ]);
        expect(hits).toHaveLength(0);
    });

    it("passes a line with no CR 118.4 citation at all", () => {
        const hits = scanLifePaymentMiscitations([
            {
                file: "convex/gre/fixture.ts",
                text: "// CR 119.4 — a life-payment cost is illegal unless the player has enough.",
            },
        ]);
        expect(hits).toHaveLength(0);
    });

    it("respects the inline cr-cite-ok suppression", () => {
        const hits = scanLifePaymentMiscitations([
            {
                file: "convex/gre/fixture.ts",
                text: "// CR 118.4 — pay 2 life. cr-cite-ok (illustrative counter-example)",
            },
        ]);
        expect(hits).toHaveLength(0);
    });
});
