import { describe, expect, it } from "vitest";
import {
    PR_CHECK_NAMES,
    repairProofCheck,
    runPrCheck,
    type PrCheckContext,
} from "../pr-checks";
import type { Lineage } from "../lib/health-verdict-store";

// The PR checks ported from `land` (issue #5639). Each check is the pure
// function `land` already tests; what is pinned here is the wiring — the
// dispatch and the repair proof, whose store and test runner are injected.

const RED_SHA = "a".repeat(40);
const THIS_FILE = "scripts/__tests__/pr-checks.test.ts";

function redLineage(tests: string[] = [THIS_FILE]): Lineage {
    return {
        kind: "red",
        verdict: { sha: RED_SHA, status: "red", tests },
    } as Lineage;
}

function ctx(over: Partial<PrCheckContext>): PrCheckContext {
    return {
        cwd: process.cwd(),
        prBody: "Closes #900",
        lineage: () => redLineage(),
        repairIssues: () => [900],
        runTests: () => 0,
        ...over,
    };
}

describe("every land refusal has a PR check", () => {
    it("names the five", () => {
        expect([...PR_CHECK_NAMES]).toEqual([
            "ui-receipt",
            "scenario",
            "retired-rows",
            "robustness-baseline",
            "repair-proof",
        ]);
    });
});

describe("robustness-baseline", () => {
    const baseline = [{ label: "Some entry", issue: 4917 }] as never;
    it("refuses a PR closing a row's owner, passes one that does not", () => {
        expect(
            runPrCheck(
                "robustness-baseline",
                ctx({ prBody: "Closes #4917", baseline })
            ).refusal
        ).toContain("Some entry");
        expect(
            runPrCheck(
                "robustness-baseline",
                ctx({ prBody: "Closes #1", baseline })
            ).refusal
        ).toBeNull();
    });
});

describe("repair-proof (issue #5462)", () => {
    it("is red when the RED verdict's failing tests still fail", () => {
        const r = repairProofCheck(ctx({ runTests: () => 1 }));
        expect(r.refusal).toContain("still fail");
        expect(r.refusal).toContain(THIS_FILE);
    });

    it("is green when they pass, and runs exactly the verdict's tests", () => {
        let ran: readonly string[] = [];
        const r = repairProofCheck(
            ctx({
                runTests: (t) => {
                    ran = t;
                    return 0;
                },
            })
        );
        expect(r.refusal).toBeNull();
        expect(ran).toEqual([THIS_FILE]);
    });

    it("owes nothing to a PR that is not a declared repair", () => {
        let ran = false;
        const r = repairProofCheck(
            ctx({
                prBody: "Closes #1",
                runTests: () => ((ran = true), 1),
            })
        );
        expect(r.refusal).toBeNull();
        expect(ran).toBe(false);
    });

    it("owes nothing when no RED stands", () => {
        const r = repairProofCheck(
            ctx({
                lineage: () => ({ kind: "green", verdict: null }),
                runTests: () => 1,
            })
        );
        expect(r.refusal).toBeNull();
    });

    it("skips a test the repair moved, and says it is unproved", () => {
        const r = repairProofCheck(
            ctx({
                lineage: () => redLineage(["scripts/__tests__/gone.test.ts"]),
                runTests: () => 1,
            })
        );
        expect(r.refusal).toBeNull();
        expect(r.note).toContain("unproved");
    });

    it("passes WITH a note when the verdict store cannot be read", () => {
        const r = repairProofCheck(
            ctx({
                lineage: () => ({
                    kind: "none",
                    verdict: null,
                    error: "no token",
                }),
                runTests: () => 1,
            })
        );
        expect(r.refusal).toBeNull();
        expect(r.note).toContain("not provable here");
    });
});
