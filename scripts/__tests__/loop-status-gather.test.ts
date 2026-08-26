import { describe, it, expect } from "vitest";
import {
    fetchRecentMergedPrs,
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
            openIssuesRunner: () => "[]",
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
            openIssuesRunner: () => "[]",
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
            openIssuesRunner: () => "[]",
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
            openIssuesRunner: () => "[]",
        });
        expect(result.claimsError).toBeNull();
        expect(result.queueDepthError).toBeNull();
        expect(result.claims).not.toBeNull();
        expect(result.claims?.some((c) => c.issue === 7)).toBe(true);
        expect(result.queueDepth?.total).toBe(1);
    });

    it("reports recentMerges UNAVAILABLE — never an empty array — when the merged-PR read throws (#2631)", () => {
        const result = gatherLoopStatus({
            noPriority: true,
            claimsRunner: () => "[]",
            queueRunner: () => "[]",
            mergedPrRunner: () => {
                throw new Error(
                    "GraphQL: API rate limit already exceeded for user ID 117459688"
                );
            },
            openIssuesRunner: () => "[]",
        });
        expect(result.recentMerges).toBeNull();
        expect(result.recentMergesError).toContain("rate limit");
        // The 2519-round-3 bug, re-expressed for this new read: this must
        // NOT be the shape a swallowed failure would have produced.
        expect(result.recentMerges).not.toEqual([]);
        // Truncation is a property of a SUCCESSFUL page — a failed read
        // reports `false`, never a stray `true` fabricated from nothing.
        expect(result.recentMergesTruncated).toBe(false);
        // The failure is isolated to ITS OWN section — claims/queueDepth
        // stay healthy.
        expect(result.claimsError).toBeNull();
        expect(result.queueDepthError).toBeNull();
    });

    it("populates recentMerges with real data on a healthy read (#2631)", () => {
        const result = gatherLoopStatus({
            noPriority: true,
            claimsRunner: () => "[]",
            queueRunner: () => "[]",
            mergedPrRunner: () =>
                JSON.stringify([
                    {
                        number: 2837,
                        title: "feat: Now view",
                        mergedAt: new Date().toISOString(),
                    },
                ]),
            openIssuesRunner: () => "[]",
        });
        expect(result.recentMergesError).toBeNull();
        expect(result.recentMerges).toEqual([
            {
                number: 2837,
                title: "feat: Now view",
                mergedAt: expect.any(String),
            },
        ]);
    });

    it("timelinePasses is always an array (a local FS read, never UNAVAILABLE) even when nothing else is knowable (#2631)", () => {
        const result = gatherLoopStatus({
            noPriority: true,
            claimsRunner: () => {
                throw new Error("boom");
            },
            queueRunner: () => {
                throw new Error("boom");
            },
            openIssuesRunner: () => "[]",
        });
        expect(Array.isArray(result.timelinePasses)).toBe(true);
    });
});

describe("loop-status — fetchRecentMergedPrs (#2631)", () => {
    it("filters out a merge older than the window, even when gh returns it", () => {
        const oldIso = new Date(Date.now() - 48 * 3600_000).toISOString();
        const freshIso = new Date(Date.now() - 1 * 3600_000).toISOString();
        const result = fetchRecentMergedPrs(24, () =>
            JSON.stringify([
                { number: 1, title: "old", mergedAt: oldIso },
                { number: 2, title: "fresh", mergedAt: freshIso },
            ])
        );
        expect(result.prs.map((p) => p.number)).toEqual([2]);
        expect(result.truncated).toBe(false);
    });

    it("tolerates a null mergedAt (state=merged should always carry one, but never throws if it doesn't)", () => {
        const result = fetchRecentMergedPrs(24, () =>
            JSON.stringify([{ number: 1, title: "x", mergedAt: null }])
        );
        expect(result.prs).toEqual([]);
    });

    it("returns an empty array on an empty gh response", () => {
        expect(fetchRecentMergedPrs(24, () => "").prs).toEqual([]);
    });

    it("raises the fetch limit well above a real measured 40-41-merge day, and reports truncation rather than silently dropping data (#2842 review finding)", () => {
        // A #2842 review flagged the original --limit 50 as "one busy day
        // from silently dropping data" against this repo's own measured
        // 40-41-merge day. This asserts BOTH halves of the fix: the ceiling
        // itself has real headroom over that measurement, AND — since no
        // ceiling is future-proof — a page that DOES get exhausted is
        // reported as `truncated`, not presented as a complete read.
        let capturedArgs: string[] = [];
        const runner = (args: string[]) => {
            capturedArgs = args;
            const limitIdx = args.indexOf("--limit") + 1;
            const limit = Number(args[limitIdx]);
            // Return exactly `limit` merges, all inside the window — the
            // shape of a day busy enough to exhaust whatever page size was
            // requested.
            return JSON.stringify(
                Array.from({ length: limit }, (_, i) => {
                    const mergedAt = new Date(
                        Date.now() - i * 1000
                    ).toISOString();
                    // updatedAt >= mergedAt always (merging is itself an
                    // update) — even the OLDEST row here is still inside the
                    // window, so a real `gh` page in this exact shape could
                    // genuinely be hiding an older in-window merge.
                    return {
                        number: i,
                        title: `pr ${i}`,
                        mergedAt,
                        updatedAt: mergedAt,
                    };
                })
            );
        };
        const result = fetchRecentMergedPrs(24, runner);
        const requestedLimit = Number(
            capturedArgs[capturedArgs.indexOf("--limit") + 1]
        );
        expect(requestedLimit).toBeGreaterThanOrEqual(200);
        expect(requestedLimit).toBeGreaterThan(41 * 4); // real-day headroom
        expect(result.prs).toHaveLength(requestedLimit);
        expect(result.truncated).toBe(true);
    });

    it("does NOT report truncation on an ordinary day well under the limit", () => {
        const result = fetchRecentMergedPrs(24, () =>
            JSON.stringify([
                { number: 1, title: "a", mergedAt: new Date().toISOString() },
            ])
        );
        expect(result.truncated).toBe(false);
    });

    it("does NOT report truncation on a FULL page whose oldest row is already outside the window — the exact live shape measured on this repo (#2842 fixup)", () => {
        // Reproduced against this repo's own live `gh pr list --state merged
        // --search sort:updated-desc --limit 200`: the page fills up on
        // routine label/comment activity touching PRs merged WEEKS ago
        // (updatedAt far outside any 24h window), while every PR actually
        // merged in the last 24h sits at the very top of that same page —
        // fully captured, nothing missing. `raw.length === limit` alone
        // flagged this as truncated; it is not.
        const inWindowMergedAt = new Date(Date.now() - 3600_000).toISOString();
        const longAgoUpdatedAt = new Date(
            Date.now() - 30 * 24 * 3600_000
        ).toISOString();
        const runner = (args: string[]) => {
            const limit = Number(args[args.indexOf("--limit") + 1]);
            const rows = [
                {
                    number: 1,
                    title: "actually recent",
                    mergedAt: inWindowMergedAt,
                    updatedAt: inWindowMergedAt,
                },
                // Pad out to `limit` with old, merged-long-ago rows whose
                // updatedAt is recent-ish but still outside the window,
                // ending on one clearly outside it.
                ...Array.from({ length: limit - 1 }, (_, i) => ({
                    number: 100 + i,
                    title: `old pr ${i}`,
                    mergedAt: longAgoUpdatedAt,
                    updatedAt: longAgoUpdatedAt,
                })),
            ];
            return JSON.stringify(rows);
        };
        const result = fetchRecentMergedPrs(24, runner);
        expect(result.prs.map((p) => p.number)).toEqual([1]);
        expect(result.truncated).toBe(false);
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
        verdict: {
            state: "IDLE",
            sentence: "s",
            remedy: "r",
            findings: [],
        },
        driver: EMPTY_DRIVER,
        claims: [],
        claimsError: null,
        queueDepth: { P0: 0, P1: 0, P2: 0, unprioritized: 0, total: 0 },
        queueDepthError: null,
        receiptsSummary: EMPTY_RECEIPTS_SUMMARY,
        batch: null,
        batchStartedAt: null,
        priorityWarning: null,
        receiptErrors: [],
        timelinePasses: [],
        recentMerges: [],
        recentMergesError: null,
        recentMergesTruncated: false,
        dependentsError: null,
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

/**
 * #2624 — the verdict is derived ONCE, inside `buildLoopStatus`, and reaches
 * the payload both surfaces read. The failed-read case is the one that must
 * not regress: `gatherLoopStatus` substitutes empty values for a failed
 * section so it can still build the rest, and a verdict derived from that
 * substitution would report the loop as healthy at the exact moment the
 * screen knows nothing.
 */
describe("loop-status — gatherLoopStatus carries the shared verdict (#2624)", () => {
    it("ships the verdict in the payload the CLI and the dashboard both read", () => {
        const result = gatherLoopStatus({
            noPriority: true,
            claimsRunner: () => "[]",
            queueRunner: () => "[]",
            openIssuesRunner: () => "[]",
        });
        expect(result.verdict).toBeDefined();
        expect(typeof result.verdict.sentence).toBe("string");
        expect(result.verdict.sentence.length).toBeGreaterThan(0);
        expect(result.verdict.remedy.length).toBeGreaterThan(0);
    });

    it("reports NEEDS ATTENTION when a read failed — not a verdict derived from the substituted empties", () => {
        const result = gatherLoopStatus({
            noPriority: true,
            claimsRunner: () => {
                throw new Error("GraphQL: API rate limit already exceeded");
            },
            queueRunner: () => "[]",
            openIssuesRunner: () => "[]",
        });
        expect(result.verdict.state).toBe("NEEDS ATTENTION");
        expect(result.verdict.findings.map((f) => f.code)).toContain(
            "failed-reads"
        );
    });

    it("prints the verdict band FIRST in the CLI text", () => {
        const text = renderGatheredLoopStatusText(
            gathered({
                verdict: {
                    state: "STALLED",
                    sentence: "The loop is armed but no driver is running.",
                    remedy: "`bun run loop:afk` starts a detached driver",
                    findings: [
                        { code: "claims-held", detail: "5 issue(s) held" },
                    ],
                },
            })
        );
        expect(text.startsWith("LOOP: STALLED\n")).toBe(true);
        expect(text).toContain("no driver is running");
        expect(text).toContain("claims-held: 5 issue(s) held");
    });
});
