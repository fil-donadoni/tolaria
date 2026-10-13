/**
 * Blade-scenario registry lookup (issue #1432, PRD #1423).
 *
 * `findBladeScenario` is the pure lookup the read-only browser loader's
 * `debugLoadBladeScenario` mutation (`convex/debugBlade.ts`) uses to resolve a
 * client-supplied `label` against the code-side registry SERVER-SIDE — the
 * client never supplies a `spec` directly, only picks a label.
 */

import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS, findBladeScenario } from "../registry";
import { AUDIT_THEMES, auditEntryProblems } from "../auditThemes";
import type { AuditTheme } from "../auditThemes";

describe("findBladeScenario (issue #1432)", () => {
    it("resolves every registered label to its own entry", () => {
        for (const scenario of BLADE_SCENARIOS) {
            expect(findBladeScenario(scenario.label)).toBe(scenario);
        }
    });

    it("returns undefined for an unknown label", () => {
        expect(findBladeScenario("no such scenario")).toBeUndefined();
    });

    it("returns undefined for an empty label", () => {
        expect(findBladeScenario("")).toBeUndefined();
    });
});

describe("audit entries are honest about themselves (ADR 0149, issue #4923)", () => {
    it("every registry entry carrying `audit` passes the guard", () => {
        for (const scenario of BLADE_SCENARIOS) {
            expect(auditEntryProblems(scenario)).toEqual([]);
        }
    });

    const base = { label: "probe", tier: "stretch" as const };
    const theme = Object.keys(AUDIT_THEMES)[0] as AuditTheme;

    it("reds on a theme outside the closed list", () => {
        const audit = { theme: "not a theme" as AuditTheme };
        const problems = auditEntryProblems({ ...base, tier: "must", audit });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("not in AUDIT_THEMES");
    });

    it("reds on an audit stretch entry with no beyondBudget.cause", () => {
        const problems = auditEntryProblems({ ...base, audit: { theme } });
        expect(problems.some((p) => p.includes("beyondBudget.cause"))).toBe(
            true
        );
    });

    it("reds on an audit stretch entry whose note names no issue", () => {
        const problems = auditEntryProblems({
            ...base,
            audit: { theme },
            beyondBudget: { cause: "valuation", note: "blind term" },
        });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("issue #N");
    });

    it("accepts a classified audit stretch entry naming its issue", () => {
        expect(
            auditEntryProblems({
                ...base,
                audit: { theme },
                beyondBudget: {
                    cause: "valuation",
                    note: "blind term, issue #4923",
                },
            })
        ).toEqual([]);
    });

    it("owes a must audit entry neither cause nor issue", () => {
        expect(
            auditEntryProblems({ ...base, tier: "must", audit: { theme } })
        ).toEqual([]);
    });

    it("ignores entries without `audit`", () => {
        expect(auditEntryProblems(base)).toEqual([]);
    });

    it("describes every theme", () => {
        for (const d of Object.values(AUDIT_THEMES))
            expect(d.length).toBeGreaterThan(0);
    });
});
