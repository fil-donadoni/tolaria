// The `draft:audit:` PR receipt (issue #8895): which diffs owe it, and the
// three refusals (no receipt, mismatched digest, broken Floor).
import { describe, expect, it } from "vitest";
import {
    draftAuditRefusal,
    DRAFT_AUDIT_RECEIPT_SCOPES,
    owesDraftAuditReceipt,
    parseReceiptLines,
} from "../lib/draft-audit-receipt";
import { runPrCheck } from "../pr-checks";
import { PR_CHECK_JOB_NAMES } from "../lib/pr-check-twin";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const line = (scope: string, floors = "PASS", sha = HEX_A, seeds = "1..8") =>
    `draft:audit: ${scope} seeds ${seeds} floors: ${floors} sha256:${sha}`;
const bodyFor = (floors = "PASS", sha = HEX_A) =>
    DRAFT_AUDIT_RECEIPT_SCOPES.map((s) => line(s, floors, sha)).join("\n");
const derive =
    (sha: string, floors = "PASS") =>
    (scope: string) =>
        line(scope, floors, sha);

describe("owesDraftAuditReceipt — path predicate", () => {
    it.each([
        "convex/limited/botDrafter.ts",
        "convex/limited/autoBuild.ts",
        "convex/limited/cardProfilesCore.ts",
        "convex/limited/archetypeCatalogue.ts",
        "convex/limited/capabilityRegistry.ts",
        "src/lib/limited/draftLabEngine.ts",
        "data/card-profiles/archetypes/vintage-cube.json",
        "data/card-profiles/capabilities.json",
        "data/archetype-catalogue.json",
        "scripts/lib/draft-audit.ts",
    ])("owes for %s", (p) => {
        expect(owesDraftAuditReceipt([p])).toBe(true);
    });

    it.each([
        "convex/gre/effects/interpreter.ts",
        "src/components/lobby/card-profile-archetype-picker.tsx",
        "convex/limited/swiss.ts",
        "convex/limited/__tests__/cardProfiles.bot.test.ts",
        "scripts/__tests__/draft-audit.bot.test.ts",
        "docs/agents/quality-gates.md",
    ])("owes nothing for %s", (p) => {
        expect(owesDraftAuditReceipt([p])).toBe(false);
    });

    it("owes when any one path of a mixed diff does", () => {
        expect(
            owesDraftAuditReceipt(["docs/x.md", "convex/limited/botDrafter.ts"])
        ).toBe(true);
        expect(owesDraftAuditReceipt([])).toBe(false);
    });
});

describe("parseReceiptLines", () => {
    it("reads a line, tolerating a list bullet and backticks", () => {
        const { lines, malformed } = parseReceiptLines(
            `- \`${line("lea")}\`\n`
        );
        expect(malformed).toEqual([]);
        expect(lines).toEqual([
            { scope: "lea", from: 1, to: 8, floors: "PASS", sha256: HEX_A },
        ]);
    });

    it("reports a marker line that does not parse", () => {
        expect(
            parseReceiptLines("draft:audit: lea PASS").malformed
        ).toHaveLength(1);
    });
});

describe("draftAuditRefusal — proof of each refusal", () => {
    it("owes nothing outside the predicate, receipt or not", () => {
        expect(draftAuditRefusal(false, "", derive(HEX_A))).toBeNull();
    });

    it("accepts a matching green receipt for every scope", () => {
        expect(draftAuditRefusal(true, bodyFor(), derive(HEX_A))).toBeNull();
    });

    it("refuses an owing PR with no receipt", () => {
        expect(draftAuditRefusal(true, "nothing here", derive(HEX_A))).toMatch(
            /no `draft:audit: [\w-]+` receipt/
        );
    });

    it("refuses a receipt missing one scope", () => {
        const only = line(DRAFT_AUDIT_RECEIPT_SCOPES[0]);
        expect(draftAuditRefusal(true, only, derive(HEX_A))).toMatch(
            /no `draft:audit:/
        );
    });

    it("refuses a mismatched digest", () => {
        expect(draftAuditRefusal(true, bodyFor(), derive(HEX_B))).toMatch(
            /does not match this tree/
        );
    });

    it("refuses a receipt whose Floors verdict is not green", () => {
        expect(
            draftAuditRefusal(true, bodyFor("FAIL"), derive(HEX_A, "FAIL"))
        ).toMatch(/receipt says floors: FAIL/);
    });

    it("refuses a green-claiming receipt the tree re-derives as FAIL", () => {
        expect(
            draftAuditRefusal(true, bodyFor("PASS"), derive(HEX_A, "FAIL"))
        ).toMatch(/does not match this tree/);
    });

    it("refuses a partial seed range", () => {
        const body = DRAFT_AUDIT_RECEIPT_SCOPES.map((s) =>
            line(s, "PASS", HEX_A, "1..3")
        ).join("\n");
        expect(draftAuditRefusal(true, body, derive(HEX_A))).toMatch(
            /seeds 1\.\.3/
        );
    });
});

describe("wiring", () => {
    it("pr:checks runs draft-audit and the check job is a required name", () => {
        expect(PR_CHECK_JOB_NAMES).toContain("draft-audit");
        // A throwaway cwd with no origin/<base> degrades to "owes nothing".
        expect(
            runPrCheck("draft-audit", { cwd: "/nonexistent", prBody: "" })
                .refusal
        ).toBeNull();
    });
});
