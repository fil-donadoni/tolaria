import { describe, expect, it } from "vitest";
import {
    STALL_HOURS,
    refreshPrState,
    stallFailure,
    supersede,
    type OpenRefreshPr,
} from "../lib/refresh-pr-stall";

/**
 * Issue #7927 — a derived-data refresh PR that stalls is superseded, never
 * waited on: PR #7810 (red on 2026-11-01) silenced two daily runs after it.
 */
describe("a stalled refresh PR is superseded, an in-flight one waited on (issue #7927)", () => {
    const PREFIX = "chore/bot-costs-refresh-";
    const NOW = new Date("2026-11-03T04:30:00Z");
    const hoursAgo = (h: number) =>
        new Date(NOW.getTime() - h * 3_600_000).toISOString();
    const pr = (
        number: number,
        ageH: number,
        headRefName = `${PREFIX}x`
    ): OpenRefreshPr => ({ number, headRefName, createdAt: hoursAgo(ageH) });

    it("no open refresh PR is none, whatever else is open", () => {
        expect(
            refreshPrState([pr(1, 100, "feat/issue-1")], PREFIX, NOW)
        ).toEqual({ kind: "none" });
    });

    it("a refresh PR younger than the threshold is in flight", () => {
        const young = pr(2, STALL_HOURS - 1);
        expect(refreshPrState([young], PREFIX, NOW)).toEqual({
            kind: "in-flight",
            pr: young,
        });
    });

    it("PR #7810's shape — open since the day before yesterday — is stalled", () => {
        const p7810 = {
            number: 7810,
            headRefName: `${PREFIX}2026-11-01`,
            createdAt: "2026-11-01T12:07:05Z",
        };
        expect(refreshPrState([p7810], PREFIX, NOW)).toEqual({
            kind: "stalled",
            prs: [p7810],
        });
    });

    it("the threshold itself is stalled", () => {
        expect(refreshPrState([pr(3, STALL_HOURS)], PREFIX, NOW).kind).toBe(
            "stalled"
        );
    });

    it("one in-flight PR beside a stalled one waits: nothing is closed under a live run", () => {
        expect(
            refreshPrState([pr(4, 50), pr(5, 1)], PREFIX, NOW)
        ).toMatchObject({ kind: "in-flight", pr: { number: 5 } });
    });

    it("an unparseable createdAt is in flight, never closed on a guess", () => {
        const odd = { number: 6, headRefName: `${PREFIX}x`, createdAt: "?" };
        expect(refreshPrState([odd], PREFIX, NOW).kind).toBe("in-flight");
    });

    it("a run that superseded fails naming the closed PR; one that did not, passes", () => {
        expect(stallFailure([])).toBeNull();
        expect(stallFailure([pr(7810, 40)])).toMatch(/PR #7810/);
    });
});

/**
 * Issue #7987 — `gh pr close --delete-branch` resolves the LOCAL current
 * branch; in the job's detached-HEAD worktree it exited 1 after closing
 * PR #7810, so the run aborted before opening the fresh PR and the remote
 * branch survived (dispatch run 41709692404, 2026-11-03).
 */
describe("superseding closes the PR, then deletes its remote ref without reading the checkout (issue #7987)", () => {
    const p7810: OpenRefreshPr = {
        number: 7810,
        headRefName: "chore/bot-costs-refresh-2026-11-01",
        createdAt: "2026-11-01T12:07:05Z",
    };
    const recorder = (fail?: (args: string[]) => Error | undefined) => {
        const calls: string[][] = [];
        const run = (args: string[]) => {
            calls.push(args);
            const err = fail?.(args);
            if (err) throw err;
            return "";
        };
        return { calls, run };
    };

    it("closes without --delete-branch, then DELETEs refs/heads/<headRefName>", () => {
        const { calls, run } = recorder();
        supersede(p7810, "bot:costs:refresh", run);
        expect(calls).toHaveLength(2);
        expect(calls[0].slice(0, 3)).toEqual(["pr", "close", "7810"]);
        expect(calls[0]).not.toContain("--delete-branch");
        expect(calls[1]).toEqual([
            "api",
            "-X",
            "DELETE",
            "repos/{owner}/{repo}/git/refs/heads/chore/bot-costs-refresh-2026-11-01",
        ]);
    });

    it("a ref already gone is the goal reached, not a failure", () => {
        const gone = Object.assign(new Error("gh api failed"), {
            stderr: "gh: Reference does not exist (HTTP 422)",
        });
        const { run } = recorder((a) => (a[0] === "api" ? gone : undefined));
        expect(() => supersede(p7810, "bot:costs:refresh", run)).not.toThrow();
    });

    it("any other ref-delete failure is thrown", () => {
        const denied = Object.assign(new Error("gh api failed"), {
            stderr: "gh: Resource not accessible by integration (HTTP 403)",
        });
        const { run } = recorder((a) => (a[0] === "api" ? denied : undefined));
        expect(() => supersede(p7810, "bot:costs:refresh", run)).toThrow();
    });
});
