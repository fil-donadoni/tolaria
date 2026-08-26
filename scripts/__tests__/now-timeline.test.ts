import { describe, it, expect } from "vitest";
import { TIMELINE_WINDOW_HOURS } from "../lib/loop-status";
// @ts-expect-error — a browser ES module with no type declarations; plain JS
// on purpose (no build step on the dashboard, #2625) and pure, so the `node`
// vitest project can import and CALL it.
import {
    WINDOW_HOURS,
    passOutcome,
    passItems,
    claimItems,
    mergeItems,
    timelineHtml,
    timelineSectionHtml,
    TIMELINE_SECTION_ID,
} from "../dashboard/now-timeline.js";

/**
 * The Now timeline (#2631) — passes as blocks, claims as pins with an
 * open-ended tail, merges as ticks, on one shared 24-hour axis.
 *
 * A fixed `nowMs` anchors every positioning assertion; the window this
 * suite reasons about is 2026-08-19T08:00:00Z (`WS`, 24h ago) through
 * 2026-08-20T08:00:00Z (`NOW`).
 */

const WS = Date.parse("2026-08-19T08:00:00Z");
const NOW = Date.parse("2026-08-20T08:00:00Z");
const HOUR_MS = 3600_000;

describe("now-timeline — window constant parity", () => {
    it("the dashboard's restated window matches the gather layer's own constant", () => {
        // Dashboard `.js` files are plain, unbundled browser ES modules and
        // cannot import a `.ts` source at runtime (#2625) — `WINDOW_HOURS`
        // is a SEPARATE literal from `TIMELINE_WINDOW_HOURS`, and this is
        // the guard that keeps the two from drifting apart.
        expect(WINDOW_HOURS).toBe(TIMELINE_WINDOW_HOURS);
    });
});

describe("now-timeline — passOutcome (#2631 AC: died / ran-nothing / landed, no fourth bucket)", () => {
    it("'-' is the only landing", () => {
        expect(passOutcome("-")).toBe("landed");
    });
    it("'no-progress' is the only ran-and-landed-nothing", () => {
        expect(passOutcome("no-progress")).toBe("ran-nothing");
    });
    it.each(["claims-held", "rate-limit", "claude-error", "claude-retry"])(
        "%s is died — the pass's own claude invocation did not finish on its own terms",
        (reason) => {
            expect(passOutcome(reason)).toBe("died");
        }
    );
    it("an unrecognised future reason code defaults to died — the loud bucket, not a calm one", () => {
        expect(passOutcome("a-code-nobody-wrote-yet")).toBe("died");
    });
});

describe("now-timeline — passItems (block positioning)", () => {
    // p1: 09:00 "-" (landed)      → ends at p2's start
    // p2: 12:00 "claims-held" (died) → ends at p3's start
    // p3: 04:00 next day "no-progress" (ran-nothing) → LAST pass, ends at
    //     min(now, epoch + fallback), never stretched to "now"
    const passes = [
        {
            pass: 1,
            claudeExit: 0,
            pct: "10",
            queueBefore: 5,
            queueAfter: 5,
            reason: "-",
            epoch: (WS + HOUR_MS) / 1000,
        },
        {
            pass: 2,
            claudeExit: 0,
            pct: "20",
            queueBefore: 5,
            queueAfter: 4,
            reason: "claims-held",
            epoch: (WS + 4 * HOUR_MS) / 1000,
        },
        {
            pass: 3,
            claudeExit: 0,
            pct: "30",
            queueBefore: 4,
            queueAfter: 4,
            reason: "no-progress",
            epoch: (WS + 20 * HOUR_MS) / 1000,
        },
    ];

    it("derives each block's end from the NEXT pass's start, never a logged one", () => {
        const items = passItems({ timelinePasses: passes }, NOW);
        expect(items).toHaveLength(3);
        expect(items[0].outcome).toBe("landed");
        expect(items[0].tone).toBe("good");
        expect(items[0].left).toBeCloseTo(4.1667, 2);
        expect(items[0].width).toBeCloseTo(12.5, 2); // 09:00 → 12:00 = 3h

        expect(items[1].outcome).toBe("died");
        expect(items[1].tone).toBe("bad");
        expect(items[1].left).toBeCloseTo(16.6667, 2);
        expect(items[1].width).toBeCloseTo(66.6667, 2); // 12:00 → next day 04:00
    });

    it("the LAST pass in the window borrows a bounded fallback width — never a stretch to now", () => {
        const items = passItems({ timelinePasses: passes }, NOW);
        const last = items[2];
        expect(last.outcome).toBe("ran-nothing");
        expect(last.tone).toBe("warn");
        // now (08:00) is 4h past the last pass's start (04:00) — if this
        // block were wrongly stretched to "now" its width would be ~16.7%,
        // not the ~0.69% the 600s fallback produces.
        expect(last.width).toBeLessThan(1);
        expect(last.width).toBeGreaterThan(0);
    });

    it("clamps a near-instant gap to the minimum visible width rather than rendering it invisible", () => {
        const items = passItems(
            {
                timelinePasses: [
                    { ...passes[0], epoch: (WS + HOUR_MS) / 1000 },
                    {
                        ...passes[0],
                        pass: 2,
                        epoch: (WS + HOUR_MS) / 1000 + 1,
                    },
                ],
            },
            NOW
        );
        expect(items[0].width).toBeCloseTo(0.6, 5);
    });

    it("defaults to an empty array when the field is absent", () => {
        expect(passItems({}, NOW)).toEqual([]);
    });
});

describe("now-timeline — claimItems (pins with an always-open tail)", () => {
    const claims = [
        {
            issue: 100,
            title: "orphaned issue",
            ageHours: 2,
            verdict: {
                state: "orphan",
                reason: "no worktree, no branch, no PR",
            },
        },
        {
            issue: 101,
            title: "suspect issue",
            ageHours: 5,
            verdict: { state: "suspect", reason: "old but has a branch" },
        },
        {
            issue: 102,
            title: "live issue",
            ageHours: 1,
            verdict: { state: "live", reason: "" },
        },
        {
            issue: 103,
            title: "older than the window",
            ageHours: 30,
            verdict: { state: "live", reason: "" },
        },
    ];

    it("positions a pin at now minus its ageHours proxy, with tone/mark mirroring the claims table", () => {
        const items = claimItems({ claims }, NOW);
        expect(items[0].term).toBe("claim.orphan");
        expect(items[0].tone).toBe("bad");
        expect(items[0].mark).toBe("×");
        expect(items[0].left).toBeCloseTo(91.6667, 2); // 22h into the 24h window

        expect(items[1].term).toBe("claim.suspect");
        expect(items[1].tone).toBe("warn");
        expect(items[1].mark).toBe("?");

        expect(items[2].term).toBe("claim.live");
        expect(items[2].tone).toBe("good");
        expect(items[2].mark).toBe("·");
    });

    it("EVERY pin's tail reaches the right edge — a claim in this snapshot is, by construction, never released", () => {
        const items = claimItems({ claims }, NOW);
        for (const item of items) {
            expect(item.left + item.tailWidth).toBeCloseTo(100, 1);
        }
    });

    it("clamps a claim older than the window to the left edge rather than dropping it", () => {
        const items = claimItems({ claims }, NOW);
        expect(items[3].left).toBe(0);
    });

    it("renders no pins when the read failed (null) — the caller adds the UNAVAILABLE note", () => {
        expect(claimItems({ claims: null }, NOW)).toEqual([]);
    });
});

describe("now-timeline — mergeItems (ticks)", () => {
    it("positions a tick at its mergedAt timestamp", () => {
        const items = mergeItems(
            {
                recentMerges: [
                    {
                        number: 2837,
                        title: "feat: Now view",
                        mergedAt: new Date(WS + 12 * HOUR_MS).toISOString(),
                    },
                ],
            },
            NOW
        );
        expect(items).toHaveLength(1);
        expect(items[0].left).toBeCloseTo(50, 5);
    });

    it("renders no ticks when the read failed (null)", () => {
        expect(mergeItems({ recentMerges: null }, NOW)).toEqual([]);
    });
});

describe("now-timeline — timelineSectionHtml (composition + empty state)", () => {
    it("renders a SENTENCE, not a blank box, when nothing is known to have happened", () => {
        const html = timelineSectionHtml(
            { timelinePasses: [], claims: [], recentMerges: [] },
            NOW
        );
        expect(html).toContain(
            `Nothing ran, was claimed or merged in the last ${WINDOW_HOURS} hours.`
        );
        expect(html).toContain(`id="${TIMELINE_SECTION_ID}"`);
    });

    it("does NOT render the empty sentence when claims are UNAVAILABLE, even with nothing else to show", () => {
        // "I could not tell" must never collapse into "nothing happened" —
        // the exact confusion the rest of this page (#2519 round 3 finding
        // 5) already exists to prevent, extended to this view.
        const html = timelineSectionHtml(
            {
                timelinePasses: [],
                claims: null,
                claimsError: "GraphQL: rate limit exceeded",
                recentMerges: [],
            },
            NOW
        );
        expect(html).not.toContain("Nothing ran, was claimed or merged");
        expect(html).toContain("rate limit exceeded");
        expect(html).toContain("ls-unavailable");
    });

    it("surfaces a failed merge read as UNAVAILABLE prose, never a silent empty ticks track", () => {
        const html = timelineSectionHtml(
            {
                timelinePasses: [],
                claims: [],
                recentMerges: null,
                recentMergesError: "gh pr list failed: rate limit exceeded",
            },
            NOW
        );
        expect(html).toContain("gh pr list failed");
        expect(html).toContain("merge ticks may be incomplete");
    });

    it("escapes claim/pass/merge text — every field here is data from gh, not markup", () => {
        const html = timelineHtml(
            {
                timelinePasses: [
                    {
                        pass: 1,
                        claudeExit: 0,
                        pct: "1",
                        queueBefore: 1,
                        queueAfter: 1,
                        reason: "-",
                        epoch: WS / 1000,
                    },
                ],
                claims: [
                    {
                        issue: 1,
                        title: "<img src=x onerror=alert(1)>",
                        ageHours: 1,
                        verdict: { state: "live", reason: "" },
                    },
                ],
                recentMerges: [
                    {
                        number: 1,
                        title: "<script>alert(1)</script>",
                        mergedAt: new Date(WS).toISOString(),
                    },
                ],
            },
            NOW
        );
        expect(html).not.toContain("<img src=x onerror=alert(1)>");
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;img");
        expect(html).toContain("&lt;script&gt;");
    });

    it("every interactive item declares data-term from the SAME glossary the verdict band reads — no new prose invented per instance", () => {
        const html = timelineHtml(
            {
                timelinePasses: [
                    {
                        pass: 1,
                        claudeExit: 137,
                        pct: "n/a",
                        queueBefore: 5,
                        queueAfter: 3,
                        reason: "claims-held",
                        epoch: (WS + HOUR_MS) / 1000,
                    },
                ],
                claims: [
                    {
                        issue: 2582,
                        title: "an orphaned claim",
                        ageHours: 12,
                        verdict: { state: "orphan", reason: "nothing to show" },
                    },
                ],
                recentMerges: [
                    {
                        number: 2837,
                        title: "a merged PR",
                        mergedAt: new Date(WS + 2 * HOUR_MS).toISOString(),
                    },
                ],
            },
            NOW
        );
        expect(html).toContain('data-term="pass.died"');
        expect(html).toContain('data-term="claim.orphan"');
        expect(html).toContain('data-term="pr.merged"');
    });
});
