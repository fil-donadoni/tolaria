import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { P0_LABEL_RULES, matchesP0Rule } from "../lib/p0-label-rules";
import { planWorkflowBand } from "../issue-workflow-band";

// The `issue-band` workflow's `if:` and the script read ONE rule table
// (issue #9013, ADR 0143 Amendment X): the `if:` is YAML and cannot import, so
// this guard parses it back into label sets and compares.
function workflowRules(): string[][] {
    const wf = parse(
        readFileSync(".github/workflows/issue-band.yml", "utf8")
    ) as { jobs: { band: { if: string } } };
    return wf.jobs.band.if
        .replace(/^\$\{\{|\}\}\s*$/g, "")
        .split("||")
        .map((alt) => [...alt.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort());
}

describe("P0 label rule table (issue #9013)", () => {
    it("the workflow `if:` carries exactly the table's rules", () => {
        const fromTable = P0_LABEL_RULES.map((r) => [...r.labels].sort());
        expect(workflowRules()).toEqual(fromTable);
    });

    it("a user-report issue is a rule of its own", () => {
        expect(matchesP0Rule(["user-report", "needs-triage"])).toBe(true);
        expect(matchesP0Rule(["needs-triage"])).toBe(false);
    });
});

describe("planWorkflowBand: user-report rule (issue #9013)", () => {
    const labels = ["user-report", "needs-triage"];

    it("open user-report below P0 → write", () => {
        for (const priority of [null, "P1", "P3"] as const)
            expect(
                planWorkflowBand({ state: "OPEN", labels, priority })
            ).toEqual({ kind: "write" });
    });

    it("already P0 → none; closed → none", () => {
        expect(
            planWorkflowBand({ state: "OPEN", labels, priority: "P0" })
        ).toEqual({ kind: "none", reason: "already P0" });
        expect(
            planWorkflowBand({ state: "CLOSED", labels, priority: null })
        ).toEqual({ kind: "none", reason: "closed" });
    });
});
