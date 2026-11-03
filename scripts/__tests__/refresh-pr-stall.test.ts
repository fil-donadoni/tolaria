import { describe, expect, it } from "vitest";
import {
    STALL_HOURS,
    refreshPrState,
    stallFailure,
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
