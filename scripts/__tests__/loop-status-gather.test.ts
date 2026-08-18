import { describe, it, expect } from "vitest";
import {
    gatherLoopStatus,
    renderGatheredLoopStatusText,
    type GatheredLoopStatus,
} from "../loop-status";

/**
 * #2519 round 3, finding 5 — `gatherLoopStatus` itself, exercised through
 * its real composition logic via the `claimsRunner`/`queueRunner` test
 * seams (`GatherLoopStatusOptions`), never a live `gh` call. `noPriority:
 * true` keeps the board read out of the picture too (its own, pre-existing
 * `priorityWarning` degrade path — untouched here).
 *
 * The bug this guards: a rate-limited `gh` call used to render as an empty,
 * healthy result — `claims: []` / `queueDepth: {total: 0}` — indistinguishable
 * from "nothing claimed, queue drained" (the loop's own documented stop
 * condition). These tests assert the FAILED shape is `null` + an error
 * string, structurally impossible to confuse with zero, and that a healthy
 * section is untouched by a sibling's failure.
 */

function claimedIssuesJson(): string {
    return JSON.stringify([
        { number: 7, title: "x", updatedAt: "2026-08-18T00:00:00Z" },
    ]);
}

describe("loop-status — gatherLoopStatus (fail-closed sections)", () => {
    it("reports claims UNAVAILABLE — never an empty array — when the claimed-issue read throws", () => {
        const result = gatherLoopStatus({
            noPriority: true,
            claimsRunner: () => {
                throw new Error(
                    "GraphQL: API rate limit already exceeded for user ID 117459688"
                );
            },
            queueRunner: () => "[]",
        });
        expect(result.claims).toBeNull();
        expect(result.claimsError).toContain("rate limit");
        // The historical bug, spelled out: this must NOT be the shape a
        // swallowed failure would have produced.
        expect(result.claims).not.toEqual([]);
    });

    it("reports queueDepth UNAVAILABLE — never a zeroed QueueDepth — when the ready-queue read throws", () => {
        const result = gatherLoopStatus({
            noPriority: true,
            claimsRunner: () => "[]",
            queueRunner: () => {
                throw new Error("GraphQL: API rate limit already exceeded");
            },
        });
        expect(result.queueDepth).toBeNull();
        expect(result.queueDepthError).toContain("rate limit");
        expect(result.queueDepth).not.toEqual({
            P0: 0,
            P1: 0,
            P2: 0,
            unprioritized: 0,
            total: 0,
        });
    });

    it("one section failing leaves the OTHER, healthy section reporting its real values", () => {
        const result = gatherLoopStatus({
            noPriority: true,
            claimsRunner: () => {
                throw new Error("boom");
            },
            queueRunner: (args) =>
                args[1] === "list"
                    ? JSON.stringify([
                          { number: 100, labels: [] },
                          { number: 101, labels: [{ name: "in-progress" }] },
                      ])
                    : "[]",
        });
        // Claims: unavailable.
        expect(result.claims).toBeNull();
        expect(result.claimsError).toContain("boom");
        // Queue depth: healthy, real data — #101 filtered out (already
        // claimed), #100 counted. A shared failure-handling bug would have
        // nulled this out too; it must not.
        expect(result.queueDepth).not.toBeNull();
        expect(result.queueDepth?.total).toBe(1);
        expect(result.queueDepthError).toBeNull();
    });

    it("both sections healthy round-trip real data through unchanged", () => {
        const result = gatherLoopStatus({
            noPriority: true,
            claimsRunner: (cmd, args) =>
                cmd === "gh" && args[1] === "list" && args.includes("--search")
                    ? claimedIssuesJson()
                    : "[]",
            queueRunner: () => JSON.stringify([{ number: 200, labels: [] }]),
        });
        expect(result.claimsError).toBeNull();
        expect(result.queueDepthError).toBeNull();
        expect(result.claims).not.toBeNull();
        expect(result.claims?.some((c) => c.issue === 7)).toBe(true);
        expect(result.queueDepth?.total).toBe(1);
    });
});

const EMPTY_DRIVER = {
    armed: false,
    pid: null,
    pidAlive: false,
    stopFilePresent: false,
    recentPasses: [],
};
const EMPTY_RECEIPTS_SUMMARY = { total: 0, counts: [], interesting: [] };

function gathered(
    overrides: Partial<GatheredLoopStatus> = {}
): GatheredLoopStatus {
    return {
        driver: EMPTY_DRIVER,
        claims: [],
        claimsError: null,
        queueDepth: { P0: 0, P1: 0, P2: 0, unprioritized: 0, total: 0 },
        queueDepthError: null,
        receiptsSummary: EMPTY_RECEIPTS_SUMMARY,
        batch: null,
        priorityWarning: null,
        receiptErrors: [],
        ...overrides,
    };
}

describe("loop-status — renderGatheredLoopStatusText", () => {
    it("prints UNAVAILABLE for claims, never 'Claimed issues (0)' / 'total: 0', on a failed read", () => {
        const text = renderGatheredLoopStatusText(
            gathered({
                claims: null,
                claimsError: "claimed issues: rate limit exceeded",
                queueDepth: null,
                queueDepthError: "ready-for-agent queue: rate limit exceeded",
            })
        );
        expect(text).toContain("Claimed issues: UNAVAILABLE");
        expect(text).toContain("Queue depth (ready-for-agent, unclaimed)");
        expect(text).toContain("rate limit exceeded");
        // This is the assertion that would have caught the shipped bug —
        // exactly the two strings the old, fail-open code printed instead.
        expect(text).not.toContain("Claimed issues (0)");
        expect(text).not.toContain("total: 0");
    });

    it("still renders real values for a healthy section next to an unavailable one", () => {
        const text = renderGatheredLoopStatusText(
            gathered({
                claims: null,
                claimsError: "claimed issues: boom",
                queueDepth: { P0: 1, P1: 0, P2: 0, unprioritized: 0, total: 1 },
                queueDepthError: null,
            })
        );
        expect(text).toContain("Claimed issues: UNAVAILABLE");
        expect(text).toContain("total: 1");
    });
});
