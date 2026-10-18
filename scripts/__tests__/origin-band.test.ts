import { describe, expect, it } from "vitest";
import { originBandOfIssue } from "../lib/origin-band";

/**
 * `originBandOfIssue` — the effective band `issue:inherit-band` copies
 * (ADR 0143 Amendment IV). Once also `gaps:sync --band`'s input, retired by
 * issue #5871; these tests moved here from `housekeeping.test.ts` with it.
 */
describe("originBandOfIssue — the band of one issue, by queue:plan's own rule", () => {
    const board = { 4099: "P0", 4200: "P2", 4300: "P3" } as const;
    const deps = (
        parents: Record<number, number | null>,
        parentState: "OPEN" | "CLOSED" = "OPEN"
    ) => ({
        readParent: (n: number) => {
            const parent = parents[n];
            return parent == null
                ? null
                : { number: parent, state: parentState };
        },
        readBoard: () => ({ ...board }),
    });

    it("own priority, else the parent's — the parent governs in both directions (issue #4371), a CLOSED parent not at all (issue #4105)", () => {
        expect(originBandOfIssue(4200, deps({ 4200: null })).band).toBe("P2");
        expect(originBandOfIssue(4128, deps({ 4128: 4099 })).band).toBe("P0");
        expect(originBandOfIssue(4200, deps({ 4200: 4099 })).band).toBe("P0");
        expect(originBandOfIssue(4099, deps({ 4099: 4300 })).band).toBe("P3");
        expect(
            originBandOfIssue(4200, deps({ 4200: 4099 }, "CLOSED")).band
        ).toBe("P2");
    });

    it("never throws — an unprioritised issue and an unreadable board or parent are a null band plus a reason", () => {
        const ok = { readParent: () => null, readBoard: () => ({}) };
        const unranked = originBandOfIssue(1, ok);
        expect(unranked.band).toBeNull();
        expect(unranked.reason).toMatch(/carry no board Priority/);
        const boardDown = originBandOfIssue(1, {
            readParent: () => null,
            readBoard: () => {
                throw new Error("rate limited");
            },
        });
        expect(boardDown.band).toBeNull();
        expect(boardDown.reason).toMatch(/board Priority \(rate limited\)/);
        const parentDown = originBandOfIssue(1, {
            readParent: () => {
                throw new Error("gh exploded");
            },
            readBoard: () => ({}),
        });
        expect(parentDown.band).toBeNull();
        expect(parentDown.reason).toMatch(/parent of issue #1 \(gh exploded\)/);
    });
});
