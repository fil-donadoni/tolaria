import { describe, expect, it } from "vitest";
import {
    claimItems,
    mergeItems,
    passItems,
    passOutcome,
    WINDOW_HOURS,
} from "../nowTimeline";
import { lookupTerm } from "../../glossary";
import type { ClaimRow, NowPayload } from "../nowPayload";

/**
 * The Now timeline's GEOMETRY (#2631/#2842), migrated with its subject in
 * PRD #3148 S4 from `scripts/__tests__/now-timeline.test.ts`.
 *
 * Passes as blocks, claims as pins with an open-ended tail, merges as ticks,
 * on one shared 24-hour axis. Every case below is the one that file made; what
 * changed is the import — `dashboard/lib/nowTimeline.ts` is typed, so the
 * `@ts-expect-error` on every import is gone — and where the window constant
 * is checked against the server's own (that half needs a Node-typed module and
 * stays in `scripts/__tests__/dashboard-now-port.test.ts`).
 *
 * Three of these encode a defect MEASURED IN A BROWSER and reproducible in no
 * other way: two back-to-back passes rendering one on top of the other, two
 * claims taken fourteen seconds apart rendering as one unclickable circle, and
 * a de-collision pass that rewrote the position of a claim it never needed to
 * touch. They are the reason this geometry is a pure function with a test at
 * all rather than something eyeballed on the page.
 *
 * A fixed `nowMs` anchors every positioning assertion; the window this suite
 * reasons about is 2026-08-19T08:00:00Z (`WS`, 24h ago) through
 * 2026-08-20T08:00:00Z (`NOW`).
 */

const WS = Date.parse("2026-08-19T08:00:00Z");
const NOW = Date.parse("2026-08-20T08:00:00Z");
const HOUR_MS = 3600_000;

/**
 * The three functions under test read a handful of fields off the payload and
 * nothing else, so a case names exactly the fields it is about. The cast is
 * the honest form of that: a full `NowPayload` here would be thirty fields of
 * noise, and which ones a case DOES set is the whole readability of the file.
 */
const payload = (over: Partial<NowPayload>): NowPayload =>
    over as unknown as NowPayload;

/** `claimItems` reads `issue`, `title`, `ageHours` and `verdict` and nothing
 *  else; the rest of a `ClaimRow` is noise here. */
const asClaims = (
    rows: {
        issue: number;
        title: string;
        ageHours: number;
        verdict: { state: string; reason: string };
    }[]
): ClaimRow[] => rows as unknown as ClaimRow[];

describe("nowTimeline — passOutcome (#2631 AC: died / ran-nothing / landed, no fourth bucket)", () => {
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

describe("nowTimeline — the glossary keys this view added actually resolve (#2842 review finding)", () => {
    // Pointed upstream, at `passOutcome` itself — the real producer — rather
    // than at a hand-copied literal list.
    it.each(["-", "no-progress", "claims-held", "rate-limit"])(
        "passOutcome(%s)'s glossary term resolves to a real label",
        (reason) => {
            const entry = lookupTerm(`pass.${passOutcome(reason)}`);
            expect(entry).toBeDefined();
            expect(entry!.label.length).toBeGreaterThan(0);
        }
    );

    it("the merge tick's term ('pr.merged') resolves to a real label", () => {
        const entry = lookupTerm("pr.merged");
        expect(entry).toBeDefined();
        expect(entry!.label.length).toBeGreaterThan(0);
    });
});

describe("nowTimeline — passItems (block positioning)", () => {
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
        const items = passItems(payload({ timelinePasses: passes }), NOW);
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
        const items = passItems(payload({ timelinePasses: passes }), NOW);
        const last = items[2];
        expect(last.outcome).toBe("ran-nothing");
        expect(last.tone).toBe("warn");
        // now (08:00) is 4h past the last pass's start (04:00) — if this block
        // were wrongly stretched to "now" its width would be ~16.7%, not the
        // ~0.69% the 600s fallback produces.
        expect(last.width).toBeLessThan(1);
        expect(last.width).toBeGreaterThan(0);
    });

    it("clamps a near-instant gap to the minimum visible width rather than rendering it invisible", () => {
        const items = passItems(
            payload({
                timelinePasses: [
                    { ...passes[0], epoch: (WS + HOUR_MS) / 1000 },
                    { ...passes[0], pass: 2, epoch: (WS + HOUR_MS) / 1000 + 1 },
                ],
            }),
            NOW
        );
        expect(items[0].width).toBeCloseTo(0.6, 5);
    });

    it("never lets a widened block overlap the next one (browser-measured: two back-to-back 'died' passes rendered one covering the other)", () => {
        // Three passes one second apart — every raw width is far below the
        // visibility floor, so all three would widen to the minimum without
        // the fix, and the first two would then overlap the following one.
        const oneSecondApart = [
            { ...passes[0], pass: 1, epoch: (WS + HOUR_MS) / 1000 },
            { ...passes[0], pass: 2, epoch: (WS + HOUR_MS) / 1000 + 1 },
            { ...passes[0], pass: 3, epoch: (WS + HOUR_MS) / 1000 + 2 },
        ];
        const items = passItems(
            payload({ timelinePasses: oneSecondApart }),
            NOW
        );
        for (let i = 1; i < items.length; i++) {
            expect(
                items[i - 1].left + items[i - 1].width,
                `pass ${items[i - 1].pass}'s right edge vs pass ${items[i].pass}'s left`
            ).toBeLessThanOrEqual(items[i].left + 1e-9);
        }
    });

    it("defaults to an empty array when the field is absent", () => {
        expect(passItems(payload({}), NOW)).toEqual([]);
    });
});

describe("nowTimeline — claimItems (pins with an always-open tail)", () => {
    const claims: ClaimRow[] = asClaims([
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
    ]);

    it("positions a pin at now minus its ageHours proxy, with tone/mark mirroring the claims table", () => {
        const items = claimItems(payload({ claims }), NOW);
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
        for (const item of claimItems(payload({ claims }), NOW)) {
            expect(item.left + item.tailWidth).toBeCloseTo(100, 1);
        }
    });

    it("clamps a claim older than the window to the left edge rather than dropping it", () => {
        expect(claimItems(payload({ claims }), NOW)[3].left).toBe(0);
    });

    it("renders no pins when the read failed (null) — the caller adds the UNAVAILABLE note", () => {
        expect(claimItems(payload({ claims: null }), NOW)).toEqual([]);
    });

    it("de-collides two claims taken moments apart — browser-measured: identical positions rendered as one 14px circle fully covering the other, unclickable", () => {
        const secondsApart = asClaims([
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
        ]);
        const items = claimItems(payload({ claims: secondsApart }), NOW);
        expect(Math.abs(items[1].left - items[0].left)).toBeGreaterThan(1);
        // Never moved EARLIER than its own raw timestamp — only ever later.
        const rawLeft2 = 100 - ((2 - 14 / 3600) / WINDOW_HOURS) * 100;
        expect(items[1].left).toBeGreaterThanOrEqual(rawLeft2 - 1e-6);
    });

    it("a lone OLD claim's position survives a same-poll collision among unrelated fresh claims — de-collision must never rewrite a claim it did not need to touch (#2842 review regression)", () => {
        // The exact shape a #2842 review reproduced: one claim taken 20 HOURS
        // ago, plus four taken within the last ~7 SECONDS of each other. The
        // old rank-by-position fallback discarded EVERY raw position the
        // instant ANY item overflowed 100%, so the 20h claim rendered at 0%
        // (as fresh as everything else) and the four seconds-old claims fanned
        // out to 20/40/60/80% — as if each had been held for many additional
        // hours. Neither statement is true.
        const ages = [20, 7 / 3600, 5 / 3600, 4 / 3600, 2 / 3600];
        const many = asClaims(
            ages.map((ageHours, i) => ({
                issue: 3000 + i,
                title: `claim ${i}`,
                ageHours,
                verdict: { state: "live" as const, reason: "" },
            }))
        );
        const items = claimItems(payload({ claims: many }), NOW);
        const oldClaim = items.find((it) => it.issue === 3000)!;
        const rawOld = 100 - (20 / WINDOW_HOURS) * 100; // 16.6667

        expect(oldClaim.left).toBeCloseTo(rawOld, 2);

        const fresh = items
            .filter((it) => it.issue !== 3000)
            .map((it) => it.left)
            .sort((a, b) => a - b);
        // Mirrors `nowTimeline.ts`'s own (unexported) MIN_PIN_GAP_PCT — kept
        // as a literal here rather than widening the module's export surface
        // for one test constant.
        const MIN_PIN_GAP_PCT = 1.2;
        for (let i = 1; i < fresh.length; i++) {
            expect(fresh[i]).toBeGreaterThanOrEqual(
                fresh[i - 1] + MIN_PIN_GAP_PCT - 1e-9
            );
        }
        for (const l of fresh) {
            expect(l).toBeLessThanOrEqual(100);
            // Genuinely close to "now" — nothing fanned out toward the middle
            // of the window the way the discarded-positions bug did.
            expect(l).toBeGreaterThan(90);
        }
    });
});

describe("nowTimeline — mergeItems (ticks)", () => {
    it("positions a tick at its mergedAt timestamp", () => {
        const items = mergeItems(
            payload({
                recentMerges: [
                    {
                        number: 2837,
                        title: "feat: Now view",
                        mergedAt: new Date(WS + 12 * HOUR_MS).toISOString(),
                    },
                ],
            }),
            NOW
        );
        expect(items).toHaveLength(1);
        expect(items[0].left).toBeCloseTo(50, 5);
    });

    it("renders no ticks when the read failed (null)", () => {
        expect(mergeItems(payload({ recentMerges: null }), NOW)).toEqual([]);
    });

    it("de-collides two merges landed minutes apart — a busy merge-train lands several PRs close together", () => {
        const items = mergeItems(
            payload({
                recentMerges: [
                    {
                        number: 1,
                        title: "a",
                        mergedAt: new Date(WS + 12 * HOUR_MS).toISOString(),
                    },
                    {
                        number: 2,
                        title: "b",
                        mergedAt: new Date(
                            WS + 12 * HOUR_MS + 30_000
                        ).toISOString(),
                    },
                ],
            }),
            NOW
        );
        expect(items[1].left - items[0].left).toBeGreaterThanOrEqual(
            1.6 - 1e-9
        );
    });

    it("never cascades an item PAST the right edge — a busy-enough merge-train must not render off the visible track", () => {
        // 60 merges, all within the same second: at a fixed gap this would
        // cascade the tail past 100% without the adaptive shrink.
        const sameInstant = new Date(WS + 12 * HOUR_MS).toISOString();
        const items = mergeItems(
            payload({
                recentMerges: Array.from({ length: 60 }, (_, i) => ({
                    number: i,
                    title: `pr ${i}`,
                    mergedAt: sameInstant,
                })),
            }),
            NOW
        );
        for (const item of items) {
            expect(item.left).toBeLessThanOrEqual(100);
            expect(item.left).toBeGreaterThanOrEqual(0);
        }
    });

    it("never collapses two items onto the identical position, even when only a TAIL cluster overflows the edge (real-data regression: several spread-out merges plus one dense cluster near 'now')", () => {
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
            payload({ recentMerges: [...spread, ...denseTail] }),
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
