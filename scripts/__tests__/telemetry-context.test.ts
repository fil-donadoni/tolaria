import { describe, it, expect } from "vitest";
import {
    attributeGrowth,
    backHalfShare,
    bucketOfSpan,
    decileIndex,
    dedupeTurns,
    formatReport,
    summariseDeciles,
    type Span,
    type Turn,
} from "../lib/telemetry-context";

/**
 * `scripts/lib/telemetry-context.ts` (issue #3078) — the per-decile cost curve
 * and the per-bucket context-growth attribution behind
 * `bun run telemetry:context`.
 *
 * Everything here is pure over plain rows: the CLI owns `bun:sqlite`, which is
 * not importable under the `node` vitest project this file runs in.
 */

/** A turn whose fields all default to something inert. */
function turn(p: Partial<Turn> & { ctx: number }): Turn {
    return { session: "s", ts: 0, cost: 0, outTok: 0, ...p };
}

function bash(ts: number, cmdBucket: string, session = "s"): Span {
    return { session, ts, tool: "Bash", cmdBucket };
}

describe("decileIndex", () => {
    it("puts the last turn of a session in decile 9, never a tenth bucket", () => {
        // The off-by-one that `Math.floor(i / (n / 10))` produces: with n = 10,
        // i = 9 lands in bucket 9 either way, but n = 7, i = 6 gives 8.57 -> 8
        // there and must stay <= 9 here for every n.
        for (const n of [1, 3, 7, 10, 11, 97, 1000]) {
            expect(decileIndex(n - 1, n)).toBe(
                n === 1 ? 0 : Math.min(9, Math.floor(((n - 1) * 10) / n))
            );
            expect(decileIndex(n - 1, n)).toBeLessThanOrEqual(9);
        }
    });

    it("puts the first turn in decile 0 and spreads a 10-turn session one per decile", () => {
        expect(decileIndex(0, 10)).toBe(0);
        expect([...Array(10).keys()].map((i) => decileIndex(i, 10))).toEqual([
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
        ]);
    });
});

describe("dedupeTurns", () => {
    it("collapses the rows one API response wrote per content block", () => {
        // Verified shape: one response, a `text` row and a `tool_use` row, each
        // carrying the same usage payload.
        const rows = [
            turn({ ctx: 100, outTok: 42, cost: 1 }),
            turn({ ctx: 100, outTok: 42, cost: 1 }),
            turn({ ctx: 300, outTok: 7, cost: 2 }),
        ];
        expect(dedupeTurns(rows).map((t) => t.ctx)).toEqual([100, 300]);
    });

    it("keeps two responses that happen to share an output size", () => {
        // Only (ctx, outTok) together identify a response. The second response's
        // prompt contains the first one's output, so ctx always differs.
        const rows = [
            turn({ ctx: 100, outTok: 42 }),
            turn({ ctx: 142, outTok: 42 }),
        ];
        expect(dedupeTurns(rows)).toHaveLength(2);
    });
});

describe("summariseDeciles", () => {
    it("reports mean cost and mean context per decile", () => {
        const turns = [...Array(10).keys()].map((i) =>
            turn({ ts: i, ctx: (i + 1) * 1000, cost: (i + 1) / 100 })
        );
        const rows = summariseDeciles(turns);
        expect(rows).toHaveLength(10);
        expect(rows[0]).toMatchObject({
            turns: 1,
            meanCost: 0.01,
            meanCtx: 1000,
        });
        expect(rows[9]).toMatchObject({
            turns: 1,
            meanCost: 0.1,
            meanCtx: 10000,
        });
    });

    it("drops sessions shorter than minTurns rather than reporting empty deciles", () => {
        const short = [...Array(4).keys()].map((i) =>
            turn({ session: "short", ts: i, ctx: i + 1, cost: 99 })
        );
        const long = [...Array(10).keys()].map((i) =>
            turn({ session: "long", ts: i, ctx: i + 1, cost: 1 })
        );
        const rows = summariseDeciles([...short, ...long], 10);
        expect(rows.reduce((n, r) => n + r.turns, 0)).toBe(10);
        // The $99 turns would blow up decile 0 if the short session leaked in.
        expect(rows[0].meanCost).toBe(1);
    });

    it("orders a session by context when its timestamps collide", () => {
        // Whole-second stamps mean several turns routinely share one; context
        // only grows, so it is the tie-break that recovers the real order.
        const turns = [
            turn({ ts: 5, ctx: 900, cost: 9 }),
            turn({ ts: 5, ctx: 100, cost: 1 }),
            ...[...Array(8).keys()].map((i) =>
                turn({ ts: 6 + i, ctx: 1000 + i, cost: 5 })
            ),
        ];
        const rows = summariseDeciles(turns);
        expect(rows[0].meanCost).toBe(1);
        expect(rows[1].meanCost).toBe(9);
    });

    it("counts one API response once when asked to dedupe", () => {
        const turns = [...Array(10).keys()].flatMap((i) => [
            turn({ ts: i, ctx: (i + 1) * 100, outTok: 3, cost: 1 }),
            turn({ ts: i, ctx: (i + 1) * 100, outTok: 3, cost: 1 }),
        ]);
        expect(
            summariseDeciles(turns, 10).reduce((n, r) => n + r.turns, 0)
        ).toBe(20);
        expect(
            summariseDeciles(turns, 10, true).reduce((n, r) => n + r.turns, 0)
        ).toBe(10);
    });
});

describe("bucketOfSpan", () => {
    it("uses the command bucket for Bash and the tool name otherwise", () => {
        expect(bucketOfSpan(bash(1, "gh"))).toBe("gh");
        expect(
            bucketOfSpan({ session: "s", ts: 1, tool: "Bash", cmdBucket: null })
        ).toBe("other");
        expect(
            bucketOfSpan({
                session: "s",
                ts: 1,
                tool: "Agent",
                cmdBucket: null,
            })
        ).toBe("agent");
    });
});

describe("attributeGrowth", () => {
    it("attributes the context delta minus the turn's own output to the call between them", () => {
        // ctx 1000 -> 5000 with 400 output tokens of its own = 3600 from the call.
        const turns = [
            turn({ ts: 10, ctx: 1000, outTok: 400 }),
            turn({ ts: 20, ctx: 5000 }),
        ];
        const { buckets } = attributeGrowth(turns, [bash(11, "gh")]);
        expect(buckets).toEqual([
            {
                bucket: "gh",
                calls: 1,
                tokAdded: 3600,
                soloCalls: 1,
                tokPerCall: 3600,
                p90: 3600,
            },
        ]);
    });

    it("splits a shared interval evenly and reports tok/call over solo calls only", () => {
        const turns = [
            turn({ ts: 10, ctx: 0 }),
            turn({ ts: 20, ctx: 900 }), // 3 parallel calls
            turn({ ts: 30, ctx: 1000 }), // 1 solo gh call
        ];
        const spans = [
            bash(11, "gh"),
            bash(11, "fs"),
            bash(12, "fs"),
            bash(21, "gh"),
        ];
        const { buckets } = attributeGrowth(turns, spans);
        const gh = buckets.find((b) => b.bucket === "gh")!;
        const fs = buckets.find((b) => b.bucket === "fs")!;
        expect(fs.tokAdded).toBe(600); // two thirds of 900
        expect(gh.tokAdded).toBe(400); // one third of 900, plus the solo 100
        // 2 gh calls seen, but only the solo one is a measurement.
        expect(gh).toMatchObject({ calls: 2, soloCalls: 1, tokPerCall: 100 });
        expect(fs).toMatchObject({
            calls: 2,
            soloCalls: 0,
            tokPerCall: null,
            p90: null,
        });
    });

    it("reports growth with no recorded span as untracked instead of guessing", () => {
        // Read/Edit/Grep leave no span, so an interval with none is a real hole
        // and must not be folded into whichever bucket ran nearby.
        const turns = [
            turn({ ts: 10, ctx: 0 }),
            turn({ ts: 20, ctx: 5000 }),
            turn({ ts: 30, ctx: 5100 }),
        ];
        const report = attributeGrowth(turns, [bash(21, "fs")]);
        expect(report.untrackedTok).toBe(5000);
        expect(report.untrackedIntervals).toBe(1);
        expect(report.buckets).toEqual([
            {
                bucket: "fs",
                calls: 1,
                tokAdded: 100,
                soloCalls: 1,
                tokPerCall: 100,
                p90: 100,
            },
        ]);
    });

    it("drops a compacted interval rather than crediting it as zero growth", () => {
        // Clamping a negative delta to 0 would hand the call a free interval and
        // drag its mean down; the interval is not evidence, so it is discarded.
        const turns = [
            turn({ ts: 10, ctx: 9000 }),
            turn({ ts: 20, ctx: 2000 }),
            turn({ ts: 30, ctx: 2400 }),
        ];
        const report = attributeGrowth(turns, [bash(11, "fs"), bash(21, "fs")]);
        expect(report.droppedIntervals).toBe(1);
        expect(report.buckets[0]).toMatchObject({
            calls: 1,
            tokAdded: 400,
            tokPerCall: 400,
        });
    });

    it("collapses the duplicate rows of one response before differencing", () => {
        // Without this the second row of a pair differences to -outTok and the
        // interval is thrown away as a compaction — 40% of them, measured.
        const turns = [
            turn({ ts: 10, ctx: 1000, outTok: 50 }),
            turn({ ts: 10, ctx: 1000, outTok: 50 }),
            turn({ ts: 20, ctx: 3050 }),
        ];
        const report = attributeGrowth(turns, [bash(11, "gh")]);
        expect(report.droppedIntervals).toBe(0);
        expect(report.buckets[0]).toMatchObject({
            bucket: "gh",
            tokAdded: 2000,
        });
    });

    it("keeps each session's spans to that session", () => {
        const turns = [
            turn({ session: "a", ts: 10, ctx: 0 }),
            turn({ session: "a", ts: 20, ctx: 100 }),
            turn({ session: "b", ts: 10, ctx: 0 }),
            turn({ session: "b", ts: 20, ctx: 500 }),
        ];
        const spans = [bash(11, "gh", "a"), bash(11, "fs", "b")];
        const { buckets } = attributeGrowth(turns, spans);
        expect(buckets.find((b) => b.bucket === "gh")!.tokAdded).toBe(100);
        expect(buckets.find((b) => b.bucket === "fs")!.tokAdded).toBe(500);
    });

    it("takes p90 as a real observation, not an interpolation", () => {
        const turns = [
            turn({ ts: 0, ctx: 0 }),
            ...[...Array(10).keys()].map((i) =>
                turn({ ts: (i + 1) * 10, ctx: (i + 1) * 100 })
            ),
        ];
        const spans = [...Array(10).keys()].map((i) => bash(i * 10 + 1, "fs"));
        const { buckets } = attributeGrowth(turns, spans);
        expect(buckets[0].p90).toBe(100);
        expect(buckets[0].soloCalls).toBe(10);
    });
});

describe("backHalfShare", () => {
    it("weights each decile by its turn count, not by its mean", () => {
        const rows = [
            ...[...Array(5).keys()].map((decile) => ({
                decile,
                turns: 10,
                meanCost: 1,
                meanCtx: 0,
            })),
            ...[...Array(5).keys()].map((decile) => ({
                decile: decile + 5,
                turns: 30,
                meanCost: 1,
                meanCtx: 0,
            })),
        ];
        // 150 of 200 dollars are in the back half — a mean-of-means would say 50%.
        expect(backHalfShare(rows)).toBeCloseTo(0.75, 6);
    });
});

describe("formatReport", () => {
    it("renders both views and names the untracked remainder", () => {
        const turns = [...Array(10).keys()].map((i) =>
            turn({ ts: i, ctx: (i + 1) * 1000, cost: (i + 1) / 100 })
        );
        const text = formatReport(
            "2026-08-28",
            "2026-09-05",
            3,
            summariseDeciles(turns),
            attributeGrowth(turns, [bash(0, "gh")])
        );
        expect(text).toContain("2026-08-28 → 2026-09-05 (3 sessions)");
        expect(text).toContain("last/first turn cost: 10.00x");
        expect(text).toContain("untracked (Read/Edit/Grep/user text)");
    });
});
