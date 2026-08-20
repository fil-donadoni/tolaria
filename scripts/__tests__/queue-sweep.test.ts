import { describe, expect, it } from "vitest";

import { selectStaleClaims } from "../queue-sweep";
import { isStaleClaim, type QueueIssue } from "../lib/queue-plan";

const NOW = "2026-08-20T12:00:00Z";

function claim(
    number: number,
    hoursAgo: number,
    overrides: Partial<QueueIssue> = {}
): QueueIssue {
    return {
        number,
        title: `issue ${number}`,
        labels: [{ name: "in-progress" }, { name: "ready-for-agent" }],
        parent: null,
        assignees: [{ login: "Filippo" }],
        updatedAt: new Date(
            Date.parse(NOW) - hoursAgo * 3_600_000
        ).toISOString(),
        ...overrides,
    };
}

const ctx = (issuesWithOpenPr: number[] = []) => ({
    issuesWithOpenPr,
    now: NOW,
    staleClaimHours: 24,
});

describe("isStaleClaim — the shared rule", () => {
    it("is stale past the threshold with no open PR", () => {
        expect(isStaleClaim(claim(1, 25), ctx())).toBe(true);
    });

    it("is not stale inside the threshold", () => {
        expect(isStaleClaim(claim(1, 23), ctx())).toBe(false);
    });

    it("an open PR keeps a long-running claim alive", () => {
        // The liveness signal: a pass can legitimately hold a claim for days
        // while its PR waits at the merge-train.
        expect(isStaleClaim(claim(1, 200), ctx([1]))).toBe(false);
    });
});

describe("selectStaleClaims (#2622 follow-up)", () => {
    it("returns only the dead claims, with their idle hours", () => {
        const swept = selectStaleClaims(
            [claim(10, 36), claim(11, 2), claim(12, 30)],
            ctx()
        );
        expect(swept.map((c) => c.number)).toEqual([10, 12]);
        expect(swept[0].hoursIdle).toBe(36);
    });

    it("carries the assignee logins the release call must remove", () => {
        // Load-bearing, not cosmetic: `planBatch` defers an ASSIGNED issue on
        // its own branch, so a release that dropped only the `in-progress`
        // label would leave the issue exactly as unreselectable as before
        // while reporting it as released.
        const swept = selectStaleClaims(
            [
                claim(10, 36, {
                    assignees: [{ login: "alice" }, { login: "bob" }],
                }),
            ],
            ctx()
        );
        expect(swept[0].assignees).toEqual(["alice", "bob"]);
    });

    it("skips a stale-looking claim whose PR is still open", () => {
        expect(selectStaleClaims([claim(10, 100)], ctx([10]))).toEqual([]);
    });

    it("sweeps a claim that has LOST its ready-for-agent label", () => {
        // The second hole this script closes. The planner queries by
        // `ready-for-agent`, so a claim stripped of that label after it was
        // taken is invisible to it at any cadence — it can only ever be freed
        // by a sweep that queries `in-progress` instead.
        const orphan = claim(10, 36, {
            labels: [{ name: "in-progress" }],
        });
        expect(selectStaleClaims([orphan], ctx()).map((c) => c.number)).toEqual(
            [10]
        );
    });
});
