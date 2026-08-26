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
// @ts-expect-error — same, and pure/data-only (#2629 module header).
import { lookupTerm } from "../dashboard/glossary.js";

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

describe("now-timeline — the four glossary keys this view added actually resolve (#2842 review finding)", () => {
    // Pointed upstream, at `passOutcome` itself — the real producer — rather
    // than at a hand-copied literal list, the same shape as
    // `dashboard-glossary.test.ts`'s own completeness suite (walk the
    // vocabulary a producer can actually emit, not the glossary's own keys).
    it.each(["-", "no-progress", "claims-held", "rate-limit"])(
        "passOutcome(%s)'s glossary term resolves to a real label",
        (reason) => {
            const term = `pass.${passOutcome(reason)}`;
            const entry = lookupTerm(term);
            expect(entry).toBeDefined();
            expect(entry.label.length).toBeGreaterThan(0);
        }
    );

    it("the merge tick's data-term ('pr.merged') resolves to a real label", () => {
        const entry = lookupTerm("pr.merged");
        expect(entry).toBeDefined();
        expect(entry.label.length).toBeGreaterThan(0);
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

    it("never lets a MIN_ITEM_PCT-widened block overlap the next one (browser-measured: two back-to-back 'died' passes rendered one covering the other)", () => {
        // Three passes one second apart — every raw width is far below the
        // visibility floor, so all three would widen to MIN_ITEM_PCT without
        // the fix, and the first two would then overlap the following one.
        const oneSecondApart = [
            { ...passes[0], pass: 1, epoch: (WS + HOUR_MS) / 1000 },
            { ...passes[0], pass: 2, epoch: (WS + HOUR_MS) / 1000 + 1 },
            { ...passes[0], pass: 3, epoch: (WS + HOUR_MS) / 1000 + 2 },
        ];
        const items = passItems({ timelinePasses: oneSecondApart }, NOW);
        for (let i = 1; i < items.length; i++) {
            expect(
                items[i - 1].left + items[i - 1].width,
                `pass ${items[i - 1].pass}'s right edge vs pass ${items[i].pass}'s left`
            ).toBeLessThanOrEqual(items[i].left + 1e-9);
        }
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

    it("de-collides two claims taken moments apart — browser-measured: identical positions rendered as one 14px circle fully covering the other, unclickable", () => {
        const secondsApart = [
            {
                issue: 1,
                title: "a",
                ageHours: 2,
                verdict: { state: "live", reason: "" },
            },
            {
                issue: 2,
                title: "b",
                // 14 seconds younger — the exact gap measured live.
                ageHours: 2 - 14 / 3600,
                verdict: { state: "live", reason: "" },
            },
        ];
        const items = claimItems({ claims: secondsApart }, NOW);
        expect(Math.abs(items[1].left - items[0].left)).toBeGreaterThan(1);
        // Never moved EARLIER than its own raw timestamp — only ever later.
        const rawLeft2 = 100 - ((2 - 14 / 3600) / TIMELINE_WINDOW_HOURS) * 100;
        expect(items[1].left).toBeGreaterThanOrEqual(rawLeft2 - 1e-6);
    });

    it("a lone OLD claim's position survives a same-poll collision among unrelated fresh claims — de-collision must never rewrite a claim it did not need to touch (#2842 review regression)", () => {
        // The exact shape a #2842 review reproduced through the real
        // `deconflict`: one claim taken 20 HOURS ago, plus four claims
        // taken within the last ~7 SECONDS of each other — the kind of
        // near-simultaneous batch this loop's own claimItems call routinely
        // produces. The old rank-by-position fallback discarded EVERY raw
        // position the instant ANY item overflowed 100%, so the 20h claim
        // rendered at 0% (as fresh as everything else) and the four
        // seconds-old claims fanned out to 20/40/60/80% — as if each had
        // been held for many additional hours. Neither statement is true.
        const ages = [20, 7 / 3600, 5 / 3600, 4 / 3600, 2 / 3600];
        const claims = ages.map((ageHours, i) => ({
            issue: 3000 + i,
            title: `claim ${i}`,
            ageHours,
            verdict: { state: "live", reason: "" },
        }));
        const items = claimItems({ claims }, NOW);
        const oldClaim = items.find((it) => it.issue === 3000)!;
        const rawOld = 100 - (20 / TIMELINE_WINDOW_HOURS) * 100; // 16.6667

        // The 20h claim was nowhere near the collision (the other four are
        // all within a few seconds of "now") — de-collision must leave it
        // at its own raw position, not fold it into the same rank-spaced
        // comb as the unrelated cluster.
        expect(oldClaim.left).toBeCloseTo(rawOld, 2);

        // The four fresh claims must still end up strictly increasing, in
        // bounds, and clustered near "now" — not fanned out across the
        // window as though each were hours old.
        const fresh = items
            .filter((it) => it.issue !== 3000)
            .map((it) => it.left)
            .sort((a, b) => a - b);
        // Mirrors now-timeline.js's own (unexported) MIN_PIN_GAP_PCT — kept
        // as a literal here rather than widening the module's export
        // surface for one test constant.
        const MIN_PIN_GAP_PCT = 1.2;
        for (let i = 1; i < fresh.length; i++) {
            expect(fresh[i]).toBeGreaterThanOrEqual(
                fresh[i - 1] + MIN_PIN_GAP_PCT - 1e-9
            );
        }
        for (const l of fresh) {
            expect(l).toBeLessThanOrEqual(100);
            // Genuinely close to "now" — nothing fanned out toward the
            // middle of the window the way the discarded-positions bug did.
            expect(l).toBeGreaterThan(90);
        }
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

    it("de-collides two merges landed minutes apart — a busy merge-train lands several PRs close together", () => {
        const merges = [
            {
                number: 1,
                title: "a",
                mergedAt: new Date(WS + 12 * HOUR_MS).toISOString(),
            },
            {
                number: 2,
                title: "b",
                mergedAt: new Date(WS + 12 * HOUR_MS + 30_000).toISOString(),
            },
        ];
        const items = mergeItems({ recentMerges: merges }, NOW);
        expect(items[1].left - items[0].left).toBeGreaterThanOrEqual(
            1.6 - 1e-9
        );
    });

    it("never cascades an item PAST the right edge — a busy-enough merge-train must not render off the visible track", () => {
        // 60 merges, all within the same second: at a fixed gap this would
        // cascade the tail past 100% without the adaptive shrink.
        const sameInstant = new Date(WS + 12 * HOUR_MS).toISOString();
        const merges = Array.from({ length: 60 }, (_, i) => ({
            number: i,
            title: `pr ${i}`,
            mergedAt: sameInstant,
        }));
        const items = mergeItems({ recentMerges: merges }, NOW);
        for (const item of items) {
            expect(item.left).toBeLessThanOrEqual(100);
            expect(item.left).toBeGreaterThanOrEqual(0);
        }
    });

    it("never collapses two items onto the identical position, even when only a TAIL cluster overflows the edge (real-data regression: several spread-out merges plus one dense cluster near 'now')", () => {
        // Mirrors the live shape that broke a shared-ceiling clamp: most
        // merges spread naturally across the window, then several land
        // within seconds of each other right at the end.
        const spread = Array.from({ length: 30 }, (_, i) => ({
            number: i,
            title: `pr ${i}`,
            // Spread across the first 20 of the 24 window hours.
            mergedAt: new Date(WS + i * 40 * 60_000).toISOString(),
        }));
        const denseTail = Array.from({ length: 10 }, (_, i) => ({
            number: 1000 + i,
            title: `pr ${1000 + i}`,
            // The last ten seconds of the window.
            mergedAt: new Date(NOW - i * 1000).toISOString(),
        }));
        const items = mergeItems(
            { recentMerges: [...spread, ...denseTail] },
            NOW
        );
        const lefts = items.map((it) => it.left).sort((a, b) => a - b);
        const rounded = lefts.map((l) => Math.round(l * 1e6));
        expect(new Set(rounded).size).toBe(rounded.length);
        for (const l of lefts) {
            expect(l).toBeGreaterThanOrEqual(0);
            expect(l).toBeLessThanOrEqual(100);
        }
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

    it("surfaces a truncated (but successful) merge page as an incomplete note, distinct from UNAVAILABLE (#2842 review finding)", () => {
        const html = timelineSectionHtml(
            {
                timelinePasses: [],
                claims: [],
                recentMerges: [
                    {
                        number: 1,
                        title: "a",
                        mergedAt: new Date(WS + HOUR_MS).toISOString(),
                    },
                ],
                recentMergesError: null,
                recentMergesTruncated: true,
            },
            NOW
        );
        expect(html).toContain("merge ticks may be incomplete");
        // Never rendered as a failed read — the page succeeded, it just
        // hit its own size limit.
        expect(html).not.toContain("UNAVAILABLE");
    });

    it("does NOT render a truncation note on an ordinary, un-truncated page", () => {
        const html = timelineSectionHtml(
            {
                timelinePasses: [],
                claims: [],
                recentMerges: [],
                recentMergesError: null,
                recentMergesTruncated: false,
            },
            NOW
        );
        expect(html).not.toContain("merge ticks may be incomplete");
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
