import { describe, it, expect } from "vitest";
import { classifyClaim, type ClaimFacts } from "../loop-doctor";

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
