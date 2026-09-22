import { describe, it, expect } from "vitest";
import {
    distinctParents,
    orphanCloseComment,
    orphanedIssues,
    parentIsAbandoned,
    type ParentState,
    type SweepIssue,
} from "../lib/orphans";
import { truncationWarning } from "../issues-orphans";

/**
 * Orphaned sub-issues — the sweep's classifier (issue #4105).
 *
 * Every assertion here is about a DECISION the sweep can act on with
 * `--close`, so the safe direction is asserted as hard as the unsafe one: an
 * unreadable parent, an open parent and a `COMPLETED` parent must all leave
 * their children alone, and each of those is a way a naive predicate
 * (`parent.state === "CLOSED"`) would close somebody's live work.
 */

function sweepIssue(
    number: number,
    parent: { number: number; state?: string } | null = null
): SweepIssue {
    return { number, title: `issue ${number}`, parent };
}

const ABANDONED: ParentState = {
    state: "CLOSED",
    stateReason: "NOT_PLANNED",
};
const DISCHARGED: ParentState = { state: "CLOSED", stateReason: "COMPLETED" };
const LIVE: ParentState = { state: "OPEN", stateReason: null };

describe("parentIsAbandoned — the one definition of `abandoned`", () => {
    it("is true only for CLOSED / NOT_PLANNED", () => {
        expect(parentIsAbandoned(ABANDONED)).toBe(true);
    });

    it("is false for a DISCHARGED umbrella", () => {
        // A `COMPLETED` umbrella that closed with a child still open is a
        // bookkeeping slip. Treating it as abandonment would have the sweep
        // close live work over a mis-picked close reason — the one failure
        // worse than the one this module exists to fix.
        expect(parentIsAbandoned(DISCHARGED)).toBe(false);
    });

    it("is false for a closed parent GitHub attributed to nothing", () => {
        expect(parentIsAbandoned({ state: "CLOSED", stateReason: null })).toBe(
            false
        );
    });

    it("is false for an OPEN parent and for no parent at all", () => {
        expect(parentIsAbandoned(LIVE)).toBe(false);
        expect(
            parentIsAbandoned({ state: "OPEN", stateReason: "REOPENED" })
        ).toBe(false);
        expect(parentIsAbandoned(null)).toBe(false);
    });
});

describe("orphanedIssues — the sweep's classification", () => {
    it("names the open children of an abandoned parent", () => {
        const orphans = orphanedIssues(
            [
                sweepIssue(200, { number: 100, state: "CLOSED" }),
                sweepIssue(201, { number: 100, state: "CLOSED" }),
            ],
            () => ABANDONED
        );
        expect(orphans).toEqual([
            { number: 200, title: "issue 200", parent: 100 },
            { number: 201, title: "issue 201", parent: 100 },
        ]);
    });

    it("leaves a standalone issue alone", () => {
        expect(orphanedIssues([sweepIssue(200)], () => ABANDONED)).toEqual([]);
    });

    it("leaves the children of a live or discharged parent alone", () => {
        const issues = [sweepIssue(200, { number: 100, state: "CLOSED" })];
        expect(orphanedIssues(issues, () => LIVE)).toEqual([]);
        expect(orphanedIssues(issues, () => DISCHARGED)).toEqual([]);
    });

    it("leaves a child alone when the parent could not be read", () => {
        // `undefined` is "I don't know", and the sweep can CLOSE things. A
        // failed read that defaulted to abandoned would turn a GitHub outage
        // into a queue-wide purge.
        expect(
            orphanedIssues(
                [sweepIssue(200, { number: 100, state: "CLOSED" })],
                () => undefined
            )
        ).toEqual([]);
    });
});

describe("distinctParents — the sweep's read set", () => {
    it("collapses a whole epic's children to ONE parent read", () => {
        const parents = distinctParents([
            sweepIssue(200, { number: 100, state: "CLOSED" }),
            sweepIssue(201, { number: 100, state: "CLOSED" }),
            sweepIssue(202, { number: 100, state: "CLOSED" }),
            sweepIssue(203, { number: 101, state: "OPEN" }),
            sweepIssue(204),
        ]);
        expect(parents).toEqual([100, 101]);
    });
});

describe("issues:orphans — truncation", () => {
    it("warns when the listing comes back exactly at its ceiling", () => {
        // A listing that is exactly full is indistinguishable from a truncated
        // one, and a sweep that silently examined the first 100 of 400 open
        // issues would report "no orphans" and be believed.
        expect(truncationWarning(2000, 2000)).toContain("2000");
        expect(truncationWarning(2000, 2000)).toContain("--limit 4000");
    });

    it("says nothing when the listing came back short", () => {
        expect(truncationWarning(341, 2000)).toBe(null);
    });
});

describe("orphanCloseComment", () => {
    it("cites the parent and names the way back", () => {
        const comment = orphanCloseComment({
            number: 200,
            title: "issue 200",
            parent: 100,
        });
        expect(comment).toContain("#100");
        expect(comment).toContain("not planned");
        // A close with no way back is how a live slice dies silently.
        expect(comment).toContain("reopen");
    });
});
