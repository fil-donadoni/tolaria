import { describe, it, expect } from "vitest";
import {
    classifyClaim,
    buildClaimFacts,
    type ClaimFacts,
    type ClaimedIssue,
} from "../loop-doctor";

/**
 * `loop:doctor` releases claims. The sessions share one GitHub account, so a
 * wrong release unclaims somebody's live work with no signal that it happened —
 * every "live" and "suspect" path is asserted individually, not just the happy
 * orphan case.
 */

const base: ClaimFacts = {
    issue: 2445,
    title: "x",
    hasBranch: false,
    hasOpenPr: false,
    ageHours: 48,
};

describe("loop-doctor — classifyClaim", () => {
    it("calls an old claim with no branch and no PR an orphan", () => {
        const v = classifyClaim(base);
        expect(v.state).toBe("orphan");
        expect(v.reason).toMatch(/no branch, no PR/);
    });

    it("never releases a claim with an open PR", () => {
        expect(classifyClaim({ ...base, hasOpenPr: true }).state).toBe("live");
    });

    it("never releases a claim whose branch was pushed", () => {
        expect(classifyClaim({ ...base, hasBranch: true }).state).toBe("live");
    });

    it("holds a FRESH claim as suspect — that is what a healthy pass looks like before its first push", () => {
        // The window between "batch claimed" and "branch pushed" is minutes
        // long and has no branch and no PR: identical to an orphan on every
        // observable. Releasing it would unclaim a running batch.
        const v = classifyClaim({ ...base, ageHours: 0.5 });
        expect(v.state).toBe("suspect");
        expect(v.reason).toMatch(/healthy pass/);
    });

    it("takes the age threshold as a parameter, and the boundary is inclusive-above", () => {
        expect(classifyClaim({ ...base, ageHours: 2 }).state).toBe("orphan");
        expect(classifyClaim({ ...base, ageHours: 1.99 }).state).toBe(
            "suspect"
        );
        expect(classifyClaim({ ...base, ageHours: 5 }, 6).state).toBe(
            "suspect"
        );
    });

    it("lets a PR override even a very fresh claim", () => {
        expect(
            classifyClaim({ ...base, ageHours: 0.1, hasOpenPr: true }).state
        ).toBe("live");
    });
});

/**
 * `buildClaimFacts` (#2519) is the extraction `loop:status` reuses — it used
 * to be inlined inside loop-doctor's `import.meta.main` block, unreachable
 * from anywhere else. Testing it here pins the exact matching rules
 * (branch-suffix boundary, `refs/heads/` stripping, PR-branch-set lookup) so
 * a future edit to loop-doctor's CLI does not silently drift from what
 * loop-status.ts assumes it does.
 */
describe("loop-doctor — buildClaimFacts", () => {
    const issue: ClaimedIssue = {
        number: 2519,
        title: "loop:status",
        updatedAt: "2026-08-17T00:00:00Z",
    };

    it("matches a local branch by its issue-N suffix, ignoring an unrelated issue number", () => {
        const facts = buildClaimFacts(
            issue,
            new Set(),
            ["feat/issue-2519", "feat/issue-25190"],
            new Date("2026-08-18T00:00:00Z").getTime()
        );
        expect(facts.hasBranch).toBe(true);
    });

    it("does NOT match a branch whose suffix merely CONTAINS the issue number", () => {
        // "issue-25190" must not satisfy "issue-2519" — a prefix match here
        // would silently mark #2519 live because of an unrelated issue.
        const facts = buildClaimFacts(
            issue,
            new Set(),
            ["feat/issue-25190"],
            Date.now()
        );
        expect(facts.hasBranch).toBe(false);
    });

    it("strips the refs/heads/ prefix a remote scan can carry", () => {
        const facts = buildClaimFacts(
            issue,
            new Set(),
            ["refs/heads/fix/issue-2519"],
            Date.now()
        );
        expect(facts.hasBranch).toBe(true);
    });

    it("matches an open PR by its head branch's issue-N suffix", () => {
        const facts = buildClaimFacts(
            issue,
            new Set(["feat/issue-2519"]),
            [],
            Date.now()
        );
        expect(facts.hasOpenPr).toBe(true);
    });

    it("computes ageHours from now minus updatedAt", () => {
        const now = new Date("2026-08-18T06:00:00Z").getTime();
        const facts = buildClaimFacts(issue, new Set(), [], now);
        expect(facts.ageHours).toBeCloseTo(30, 5);
    });
});
