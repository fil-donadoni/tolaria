// Retiring a reverted PR's seeded preset scenario (issue #7702).
//
// The failure these guard: PR #7612 seeded a scenario naming Prey Upon,
// PR #7623 (the RED ladder's revert) removed the card, and the row stayed —
// loading it threw `Card not found by name: Prey Upon`. The retire step can
// only delete what it can NAME, so the parse of "which PRs does this landing
// revert" is the load-bearing decision.

import { describe, expect, it } from "vitest";
import { revertPrBody } from "../lib/health-ladder";
import {
    formatRetireOutcome,
    retireScenarioArgv,
    revertedPrsOf,
} from "../lib/scenario-retire";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SUBJECTS: Record<string, string> = {
    [SHA_A]: "feat(engine): Prey Upon fights (issue #7221) (#7612)",
    [SHA_B]: "fix: direct commit with no PR",
};
const subjectOf = (sha: string) => SUBJECTS[sha] ?? null;

describe("revertedPrsOf — the PRs a landing reverts (issue #7702)", () => {
    it("reads the RED ladder's own revert body — the list the ladder records", () => {
        // Built by the ladder's own writer, so a change to `revertPrBody`'s
        // shape that the retire can no longer read reds here.
        const body = revertPrBody({
            issue: 7622,
            red: "c".repeat(40),
            culprits: [{ sha: SHA_A.slice(0, 12), pr: 7612, full: SHA_A }],
            culpritIssues: [7221],
        });
        expect(revertedPrsOf(body, subjectOf)).toEqual([7612]);
    });

    it("maps every restores-line sha to its PR by squash subject", () => {
        const body = [
            `check:ui: revert of ${SHA_A} restores its parent on every DOM path`,
            `check:ui: revert of ${SHA_B} restores its parent on every DOM path`,
        ].join("\n");
        // SHA_B is a direct commit: it seeded nothing and names no PR.
        expect(revertedPrsOf(body, subjectOf)).toEqual([7612]);
    });

    it("reads a hand revert from GitHub's revert button", () => {
        expect(
            revertedPrsOf("Reverts filippo/tolaria#7612\n\nbroke X", subjectOf)
        ).toEqual([7612]);
    });

    it("reads a hand-written `Reverts PR #N` / `Reverts #N` line", () => {
        expect(revertedPrsOf("Reverts PR #7612.", subjectOf)).toEqual([7612]);
        expect(revertedPrsOf("Reverts #7612 and #7613", subjectOf)).toEqual([
            7612, 7613,
        ]);
    });

    it("never reads an `issue #N` on the Reverts line as a PR", () => {
        expect(
            revertedPrsOf(
                "Reverts PR #7612 (issue #7446; ADR 0158 § 3)",
                subjectOf
            )
        ).toEqual([7612]);
    });

    it("names nothing for a PR that reverts nothing — the step is a no-op", () => {
        expect(
            revertedPrsOf(
                "Fixes the thing.\n\nCloses #7702\n\nfollow-up to #7612",
                subjectOf
            )
        ).toEqual([]);
    });

    it("an unreadable commit contributes nothing rather than throwing", () => {
        expect(
            revertedPrsOf(
                `check:ui: revert of ${"d".repeat(40)} restores its parent on every DOM path`,
                subjectOf
            )
        ).toEqual([]);
    });
});

describe("retireScenarioArgv (issue #7702)", () => {
    it("calls the retire mutation with the label, pushing only when asked", () => {
        const first = retireScenarioArgv("x y", true);
        expect(first).toContain("debugScenarios:retireScenariosByLabel");
        expect(first[first.length - 1]).toBe(JSON.stringify({ label: "x y" }));
        expect(first).toContain("--push");
        expect(retireScenarioArgv("x y", false)).not.toContain("--push");
    });
});

describe("formatRetireOutcome (issue #7702)", () => {
    it("reports a row already gone as a no-op, not a failure", () => {
        expect(formatRetireOutcome(7612, "L", { retired: 0, kept: 0 })).toEqual(
            ['retire-scenario: PR #7612 "L" — no seeded row (already gone)']
        );
    });

    it("warns, by name, about an admin-authored row it kept", () => {
        const lines = formatRetireOutcome(7612, "L", { retired: 1, kept: 1 });
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain("WARNING");
        expect(lines[1]).toContain('scenario:rm "L"');
    });
});
