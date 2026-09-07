import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    CLAIM_STAGES,
    LOOP_VERDICT_STATES,
    REMEDY,
    TIMELINE_WINDOW_HOURS,
} from "../lib/loop-status";
import { ACTIVITY_WINDOW_HOURS as SERVER_ACTIVITY_HOURS } from "../lib/live-activity";
import { DEFAULT_MIN_AGE_HOURS } from "../loop-doctor";
import {
    batchLight,
    claimsLight,
    driverLight,
    nowLights,
    nowSubtitleText,
    queueLight,
    SECTION_IDS,
} from "../../dashboard/lib/nowLights";
import {
    WINDOW_HOURS,
    claimItems,
    mergeItems,
    passItems,
    passOutcome,
} from "../../dashboard/lib/nowTimeline";
import {
    ACTIVITY_WINDOW_HOURS,
    activityRows,
    mergesByHour,
    niceCeiling,
} from "../../dashboard/lib/nowActivity";
import {
    MIN_AGE_HOURS,
    STAGE_SENTENCE,
    STAGE_TERM,
} from "../../dashboard/lib/nowClaims";
import {
    VERDICT_TERM,
    VERDICT_TONE,
    splitRemedy,
} from "../../dashboard/lib/verdict";
import { receiptStats } from "../../dashboard/lib/nowReceipts";
import { lookupTerm } from "../../dashboard/glossary";
import type { NowPayload } from "../../dashboard/lib/nowPayload";

/**
 * The PORTED Now view's pure half (PRD #3148 S2).
 *
 * This file is the twin of `loop-status-dashboard.test.ts` and
 * `now-timeline.test.ts`, which guard the vanilla modules S4 deletes. It runs
 * in the `node` project on purpose: everything below is a total function of
 * its arguments, with no DOM anywhere, and it is the ONLY place that can cross
 * the boundary — a browser program cannot pull a Node-typed `.ts` module into
 * its own type-check, so every constant the dashboard mirrors is checked
 * against its server-side original from THIS side.
 */

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);

const payload = (over: Partial<NowPayload> = {}): NowPayload => ({
    verdict: null,
    driver: {
        armed: true,
        pid: 1,
        pidAlive: true,
        stopFilePresent: false,
        recentPasses: [],
    },
    claims: [],
    claimsError: null,
    queueDepth: { P0: 0, P1: 0, P2: 0, unprioritized: 0, total: 0 },
    queueDepthError: null,
    receiptsSummary: { total: 0, counts: [], interesting: [] },
    batch: null,
    batchStartedAt: null,
    priorityWarning: null,
    receiptErrors: [],
    timelinePasses: [],
    recentMerges: [],
    recentMergesError: null,
    recentMergesTruncated: false,
    dependentsError: null,
    ...over,
});

describe("mirrored constants — the ported modules restate three server numbers", () => {
    it("the timeline window equals the gather layer's own", () => {
        // A browser program cannot import `scripts/lib/loop-status.ts` (it is
        // Node-typed and the dashboard has no `@types/node`), so `WINDOW_HOURS`
        // is a SEPARATE literal and this is the only thing stopping the two
        // from drifting apart — the same shape the vanilla module used.
        expect(WINDOW_HOURS).toBe(TIMELINE_WINDOW_HOURS);
    });

    it("the claims table's amber threshold equals the classifier's own", () => {
        expect(MIN_AGE_HOURS).toBe(DEFAULT_MIN_AGE_HOURS);
    });

    it("the activity chart's window equals the server's", () => {
        expect(ACTIVITY_WINDOW_HOURS).toBe(SERVER_ACTIVITY_HOURS);
    });
});

describe("the verdict band renders every state the engine can emit", () => {
    it("names a tone for every LOOP_VERDICT_STATE — the map is a Record over the union, so a new state is a compile error too", () => {
        for (const state of LOOP_VERDICT_STATES) {
            expect(
                Object.prototype.hasOwnProperty.call(VERDICT_TONE, state),
                `no tone for ${state}`
            ).toBe(true);
        }
    });

    it("names a glossary entry for every state, and every one of them resolves", () => {
        for (const state of LOOP_VERDICT_STATES) {
            const term = VERDICT_TERM[state];
            expect(term, `no term for ${state}`).toBeTruthy();
            expect(
                lookupTerm(term),
                `${term} resolves to nothing`
            ).toBeTruthy();
        }
    });

    it("splits every REMEDY the engine can word into prose and copyable literals — never a sentence on the clipboard", () => {
        for (const remedy of Object.values(REMEDY) as string[]) {
            const parts = splitRemedy(remedy);
            // Odd indices are the backticked spans, and each one is what a
            // copy affordance would carry.
            const literals = parts.filter((_, i) => i % 2 === 1);
            for (const literal of literals) {
                expect(literal).not.toContain("`");
                expect(literal.trim()).toBe(literal);
                expect(literal.length).toBeGreaterThan(0);
            }
            // Reassembling has to give the original back, or the band is
            // silently dropping words out of the remedy.
            expect(
                parts.map((p, i) => (i % 2 === 0 ? p : `\`${p}\``)).join("")
            ).toBe(remedy);
        }
    });
});

describe("the four lights — a subsystem fact, never a second health verdict", () => {
    it("no light's word is a LOOP_VERDICT_STATE — a light reading STALLED would be a verdict wearing a subsystem's clothes", () => {
        const states = new Set<string>(LOOP_VERDICT_STATES);
        const shapes: NowPayload[] = [
            payload(),
            payload({
                driver: {
                    armed: false,
                    pid: null,
                    pidAlive: false,
                    stopFilePresent: false,
                    recentPasses: [],
                },
            }),
            payload({
                driver: {
                    armed: true,
                    pid: 7,
                    pidAlive: false,
                    stopFilePresent: false,
                    recentPasses: [],
                },
            }),
            payload({
                driver: {
                    armed: true,
                    pid: 7,
                    pidAlive: true,
                    stopFilePresent: true,
                    recentPasses: [],
                },
            }),
            payload({ claims: null, claimsError: "gh failed" }),
            payload({ queueDepth: null, queueDepthError: "gh failed" }),
            payload({ receiptErrors: [{}], batch: "abcdef01" }),
        ];
        for (const shape of shapes) {
            for (const light of nowLights(shape)) {
                expect(states.has(light.word), light.word).toBe(false);
            }
        }
    });

    it("every light points at a section id the view renders", () => {
        const ids = new Set(Object.values(SECTION_IDS));
        for (const light of nowLights(payload())) {
            expect(ids.has(light.target as never), light.target).toBe(true);
        }
        // …and no id in the map is unreachable from a light.
        expect(new Set(nowLights(payload()).map((l) => l.target)).size).toBe(
            ids.size
        );
    });

    it("a FAILED read is `unknown` and UNAVAILABLE — never `0`, never `good`", () => {
        const claims = claimsLight(
            payload({ claims: null, claimsError: "rate limit" })
        );
        expect(claims.tone).toBe("unknown");
        expect(claims.word).toBe("UNAVAILABLE");
        expect(claims.number).toBe("—");
        expect(claims.prose).toContain('not the same as "no claimed issues"');

        const queue = queueLight(
            payload({ queueDepth: null, queueDepthError: "rate limit" })
        );
        expect(queue.tone).toBe("unknown");
        expect(queue.number).toBe("—");
        expect(queue.prose).toContain('not the same as "queue empty"');
    });

    it("a SUCCESSFUL read that found nothing is `good` and EMPTY — the other half of the same distinction", () => {
        const queue = queueLight(payload());
        expect(queue.tone).toBe("good");
        expect(queue.word).toBe("EMPTY");
        expect(queue.number).toBe(0);
    });

    it("no pid file is a WARN, a dead pid file is a BAD — one is an idle loop, the other a fault", () => {
        expect(
            driverLight(
                payload({
                    driver: {
                        armed: false,
                        pid: null,
                        pidAlive: false,
                        stopFilePresent: false,
                        recentPasses: [],
                    },
                })
            )
        ).toMatchObject({ tone: "warn", word: "NO DRIVER" });
        expect(
            driverLight(
                payload({
                    driver: {
                        armed: true,
                        pid: 9,
                        pidAlive: false,
                        stopFilePresent: false,
                        recentPasses: [],
                    },
                })
            )
        ).toMatchObject({ tone: "bad", word: "DEAD" });
    });

    it("unreadable receipt files make the batch count PARTIAL, not short-but-confident", () => {
        const light = batchLight(
            payload({ batch: "abcdef0123", receiptErrors: [{}, {}] })
        );
        expect(light.tone).toBe("unknown");
        expect(light.word).toBe("PARTIAL");
        expect(light.prose).toContain("may be short of the truth");
    });

    it("the subtitle keeps the RAW driver facts the band interprets", () => {
        expect(
            nowSubtitleText(
                payload({
                    driver: {
                        armed: true,
                        pid: null,
                        pidAlive: false,
                        stopFilePresent: false,
                        recentPasses: [],
                    },
                })
            )
        ).toBe("armed · no driver pid · no stop-file");
    });
});

describe("pass outcomes — every reason code `loop-drain.sh` can write", () => {
    it("maps the six producer values, and defaults an unknown one to the LOUD bucket", () => {
        expect(passOutcome("-")).toBe("landed");
        expect(passOutcome("no-progress")).toBe("ran-nothing");
        for (const reason of [
            "claims-held",
            "rate-limit",
            "claude-error",
            "claude-retry",
        ]) {
            expect(passOutcome(reason)).toBe("died");
        }
        // Fail loud, not fail quiet: a future code the map has not caught up
        // with must not read as a healthy pass.
        expect(passOutcome("some-future-code")).toBe("died");
    });
});

describe("timeline placement — two items must never occupy one pixel", () => {
    it("blocks never overlap, even when a pass is shorter than the axis can show", () => {
        const items = passItems(
            payload({
                timelinePasses: [
                    {
                        epoch: Math.floor((NOW - HOUR) / 1000),
                        pass: 1,
                        claudeExit: 0,
                        pct: "1",
                        queueBefore: 1,
                        queueAfter: 1,
                        reason: "claims-held",
                    },
                    {
                        // 30 seconds later — far below what 24 hours can show.
                        epoch: Math.floor((NOW - HOUR + 30_000) / 1000),
                        pass: 2,
                        claudeExit: 0,
                        pct: "1",
                        queueBefore: 1,
                        queueAfter: 1,
                        reason: "claims-held",
                    },
                ],
            }),
            NOW
        );
        expect(items[1].left).toBeGreaterThanOrEqual(
            items[0].left + items[0].width
        );
    });

    it("pins taken seconds apart are pushed apart, and a pin far from any collision keeps its own position", () => {
        const items = claimItems(
            payload({
                claims: [
                    // 20 hours ago, nowhere near the cluster below.
                    {
                        issue: 1,
                        title: "old",
                        stage: "claimed",
                        verdict: { state: "orphan", reason: "" },
                        priority: null,
                        ageHours: 20,
                        dependents: null,
                    },
                    {
                        issue: 2,
                        title: "a",
                        stage: "claimed",
                        verdict: { state: "live", reason: "" },
                        priority: null,
                        ageHours: 0.001,
                        dependents: null,
                    },
                    {
                        issue: 3,
                        title: "b",
                        stage: "claimed",
                        verdict: { state: "live", reason: "" },
                        priority: null,
                        ageHours: 0.002,
                        dependents: null,
                    },
                ],
            }),
            NOW
        );
        const byIssue = new Map(items.map((i) => [i.issue, i]));
        // The lone old pin keeps its raw position — an overflow ANYWHERE used
        // to re-space every item by rank, rewriting a 20-hour-old claim to 0%.
        expect(byIssue.get(1)!.left).toBeCloseTo(
            100 - (20 / WINDOW_HOURS) * 100,
            4
        );
        expect(
            Math.abs(byIssue.get(2)!.left - byIssue.get(3)!.left)
        ).toBeGreaterThanOrEqual(1.2 - 1e-9);
        // Nothing is pushed off the track.
        for (const item of items) {
            expect(item.left).toBeGreaterThanOrEqual(0);
            expect(item.left).toBeLessThanOrEqual(100);
        }
    });

    it("a claim older than the window clamps to the left edge rather than vanishing", () => {
        const [item] = claimItems(
            payload({
                claims: [
                    {
                        issue: 1,
                        title: "ancient",
                        stage: "claimed",
                        verdict: { state: "orphan", reason: "" },
                        priority: null,
                        ageHours: 400,
                        dependents: null,
                    },
                ],
            }),
            NOW
        );
        expect(item.left).toBe(0);
        expect(item.tailWidth).toBe(100);
    });

    it("merge ticks are spaced, and a failed read draws none rather than a fabricated empty axis", () => {
        const busy = mergeItems(
            payload({
                recentMerges: Array.from({ length: 6 }, (_, i) => ({
                    number: i,
                    title: "t",
                    mergedAt: new Date(NOW - i * 1000).toISOString(),
                })),
            }),
            NOW
        );
        const sorted = [...busy].sort((a, b) => a.left - b.left);
        for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i].left - sorted[i - 1].left).toBeGreaterThanOrEqual(
                2 - 1e-9
            );
        }
        expect(
            mergeItems(
                payload({ recentMerges: null, recentMergesError: "gh failed" }),
                NOW
            )
        ).toEqual([]);
    });
});

describe("activity rows — a quiet hour is a zero, a missing bucket is still an hour", () => {
    it("always draws a full window, even against a short bucket list", () => {
        const rows = activityRows(payload(), NOW);
        expect(rows).toHaveLength(ACTIVITY_WINDOW_HOURS);
        expect(rows.every((r) => r.outTok === 0)).toBe(true);
        // Ascending, one fixed hour apart — never the local wall-clock hour,
        // which is unevenly spaced on a DST day.
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i].hourStart - rows[i - 1].hourStart).toBe(HOUR);
        }
    });

    it("buckets merges on the server's own fixed hour steps", () => {
        const merges = mergesByHour([
            { number: 1, title: "a", mergedAt: new Date(NOW).toISOString() },
            {
                number: 2,
                title: "b",
                mergedAt: new Date(NOW + 60_000).toISOString(),
            },
            { number: 3, title: "c", mergedAt: "not a date" },
        ]);
        expect(merges.get(Math.floor(NOW / HOUR) * HOUR)).toBe(2);
        expect([...merges.values()].reduce((a, b) => a + b, 0)).toBe(2);
    });

    it("gives an all-zero window a ceiling of 1 rather than dividing by zero", () => {
        expect(niceCeiling(0)).toBe(1);
        expect(niceCeiling(-5)).toBe(1);
        expect(niceCeiling(54_321)).toBe(100_000);
    });
});

describe("claim stages and receipt roles read as words", () => {
    it("every CLAIM_STAGE the server can send has a sentence and a resolving glossary term", () => {
        for (const stage of CLAIM_STAGES) {
            expect(
                STAGE_SENTENCE[stage],
                `no sentence for ${stage}`
            ).toBeTruthy();
            const term = STAGE_TERM[stage];
            expect(
                lookupTerm(term),
                `${term} resolves to nothing`
            ).toBeTruthy();
        }
    });

    it("spells the receipt guard's own marker role out — 'missing missing: 389' is the wording this replaced", () => {
        const stats = receiptStats({
            total: 390,
            counts: [
                { role: "missing", outcome: "missing", count: 389 },
                { role: "implement", outcome: "done", count: 1 },
            ],
            interesting: [],
        });
        const missing = stats.find((s) => s.term === "receipts.missing")!;
        expect(missing.label).toBe("missing session markers");
        expect(missing.value).toBe("389");
        // `implement` sorts ahead of `missing`, whatever order the counts
        // arrived in.
        expect(stats.map((s) => s.term)).toEqual([
            "receipts.total",
            "role.implement",
            "receipts.missing",
            "receipts.attention",
        ]);
        // Nothing needing attention is stated as GOOD, not as an absence.
        expect(stats.at(-1)).toMatchObject({ value: "0", tone: "good" });
    });
});

/**
 * A design TOKEN that no `@theme` entry registers is invisible, not wrong.
 *
 * `--chart-2` existed in `dashboard/index.css` from S1 and `var(--chart-2)`
 * resolved fine — but `bg-chart-2` is only a class Tailwind emits if a
 * `--color-chart-2` entry exists, so the Now timeline's merge ticks rendered
 * with NO background at all while the activity chart drawn from the same value
 * looked correct. Nothing in a DOM test can catch that (happy-dom loads no
 * stylesheet and has no layout); it took a real browser. This is the guard
 * that generalises the class rather than the instance.
 */
describe("dashboard tokens — a role token is registered as a utility, or it is invisible", () => {
    const css = readFileSync(
        join(import.meta.dirname, "..", "..", "dashboard", "index.css"),
        "utf8"
    );

    const declared = (prefix: string): string[] => [
        ...new Set(
            [
                ...css.matchAll(
                    new RegExp(`^\\s*--(${prefix}-[a-z0-9]+):`, "gm")
                ),
            ].map((m) => m[1])
        ),
    ];

    it.each(["chart", "state"])(
        "every --%s-* role has a --color-* entry, so `bg-<role>` is a class that exists",
        (prefix) => {
            const roles = declared(prefix);
            // A floor, so an emptied stylesheet cannot make this vacuous.
            expect(roles.length).toBeGreaterThanOrEqual(5);
            const unregistered = roles.filter(
                (role) => !css.includes(`--color-${role}:`)
            );
            expect(unregistered).toEqual([]);
        }
    );
});
