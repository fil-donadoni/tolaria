import { describe, it, expect } from "vitest";
import {
    allSessionLatencies,
    estimateGenerationSeconds,
    formatReport,
    isGateSpan,
    isIssueClosing,
    isNextIssue,
    quantile,
    sessionLatency,
    summarise,
    unionSeconds,
    GEN_FIXED_S,
    GEN_TOK_PER_S,
    MODEL_CEILING_S,
    type LatencySpan,
    type LatencyTurn,
} from "../lib/telemetry-latency";

/**
 * `scripts/lib/telemetry-latency.ts` (issue #3079) — the wall/tool/model/idle
 * split behind `bun run telemetry:latency`.
 *
 * Everything here is pure over plain rows: the CLI owns `bun:sqlite`, which is
 * not importable under the `node` vitest project this file runs in.
 */

/** A main-thread turn whose fields all default to something inert. */
function turn(p: Partial<LatencyTurn> & { ts: number }): LatencyTurn {
    return { session: "s", outTok: 0, ctx: p.ts, ...p };
}

/** A Bash span whose fields all default to something inert. */
function span(p: Partial<LatencySpan> & { ts: number }): LatencySpan {
    return { session: "s", durS: 0, tool: "Bash", cmd: "ls", ...p };
}

describe("unionSeconds", () => {
    it("counts overlapping spans once", () => {
        expect(
            unionSeconds([
                { start: 0, end: 60 },
                { start: 30, end: 90 },
            ])
        ).toBe(90);
    });

    it("keeps disjoint spans separate and ignores empty ones", () => {
        expect(
            unionSeconds([
                { start: 0, end: 10 },
                { start: 20, end: 30 },
                { start: 40, end: 40 },
            ])
        ).toBe(20);
    });

    it("swallows a span fully contained in another", () => {
        expect(
            unionSeconds([
                { start: 0, end: 100 },
                { start: 10, end: 20 },
            ])
        ).toBe(100);
    });
});

describe("estimateGenerationSeconds", () => {
    it("is the fixed overhead plus the decode time", () => {
        expect(estimateGenerationSeconds(0)).toBe(GEN_FIXED_S);
        expect(estimateGenerationSeconds(500)).toBe(
            GEN_FIXED_S + 500 / GEN_TOK_PER_S
        );
    });
});

describe("isGateSpan", () => {
    it("classifies check:lane and land as gates — they were bucketed as plain bun until issue #3079", () => {
        expect(isGateSpan(span({ ts: 0, cmd: "bun run check:lane" }))).toBe(
            true
        );
        expect(isGateSpan(span({ ts: 0, cmd: "bun run land 3079" }))).toBe(
            true
        );
        expect(
            isGateSpan(
                span({
                    ts: 0,
                    cmd: "cd ../tolaria-issue-1 && bun run check:ui",
                })
            )
        ).toBe(true);
    });

    it("still classifies the gates that were already recognised", () => {
        expect(isGateSpan(span({ ts: 0, cmd: "bun run check:all" }))).toBe(
            true
        );
        expect(
            isGateSpan(
                span({ ts: 0, cmd: "bunx vitest run scripts/x.test.ts" })
            )
        ).toBe(true);
    });

    it("does not classify ordinary shell work as a gate", () => {
        expect(isGateSpan(span({ ts: 0, cmd: "git status" }))).toBe(false);
        expect(isGateSpan(span({ ts: 0, cmd: "gh issue view 3079" }))).toBe(
            false
        );
        expect(isGateSpan(span({ ts: 0, cmd: "bun run dev" }))).toBe(false);
    });
});

describe("sessionLatency", () => {
    it("splits a session into tool, model and idle", () => {
        // t=0 first message; a 100s tool call; the next message 110s in, so the
        // 10s after the tool returned is generation. Then a 500s gap with no
        // span at all — the model yielded and a human took their time.
        const turns = [
            turn({ ts: 0 }),
            turn({ ts: 110, outTok: 100 }),
            turn({ ts: 610, outTok: 100 }),
        ];
        const spans = [span({ ts: 0, durS: 100 })];

        const row = sessionLatency("s", turns, spans)!;
        expect(row.wallS).toBe(610);
        expect(row.toolS).toBe(100);
        // 10s after the tool + the estimate for the last message (3 + 100/50).
        expect(row.modelS).toBe(10 + 5);
        expect(row.machineS).toBe(115);
        expect(row.idleS).toBe(610 - 100 - 15);
    });

    it("counts parallel tool calls once", () => {
        const turns = [turn({ ts: 0 }), turn({ ts: 100 })];
        const spans = [
            span({ ts: 10, durS: 50 }),
            span({ ts: 20, durS: 50 }),
            span({ ts: 30, durS: 50 }),
        ];
        // Union is [10, 80] = 70s, not the 150s a naive sum would report.
        expect(sessionLatency("s", turns, spans)!.toolS).toBe(70);
    });

    it("clips a hung span to the session's own wall clock", () => {
        const turns = [turn({ ts: 0 }), turn({ ts: 100 })];
        const spans = [span({ ts: 10, durS: 50_000 })];
        const row = sessionLatency("s", turns, spans)!;
        expect(row.toolS).toBe(90);
        // The 10s before the span started belongs to nothing that was recorded.
        expect(row.idleS).toBe(10);
    });

    it("gives a post-tool gap to the model whole, up to the ceiling", () => {
        const short = sessionLatency(
            "s",
            [turn({ ts: 0 }), turn({ ts: 100, outTok: 10 })],
            [span({ ts: 0, durS: 40 })]
        )!;
        // 60s of post-tool gap, well under the ceiling and far above the 3.2s
        // the estimator would allow: all of it is generation.
        expect(short.modelS).toBe(60);
        expect(short.idleS).toBe(0);

        const long = sessionLatency(
            "s",
            [turn({ ts: 0 }), turn({ ts: 1000, outTok: 10 })],
            [span({ ts: 0, durS: 40 })]
        )!;
        // 960s post-tool is not one generation — the session was interrupted,
        // so only the estimate counts and the rest is idle.
        expect(long.modelS).toBeCloseTo(estimateGenerationSeconds(10), 5);
        expect(long.idleS).toBeGreaterThan(900);
    });

    it("puts the ceiling where MODEL_CEILING_S says", () => {
        const at = sessionLatency(
            "s",
            [turn({ ts: 0 }), turn({ ts: MODEL_CEILING_S, outTok: 0 })],
            [span({ ts: 0, durS: 0 })]
        )!;
        expect(at.modelS).toBe(MODEL_CEILING_S);

        const past = sessionLatency(
            "s",
            [turn({ ts: 0 }), turn({ ts: MODEL_CEILING_S + 1, outTok: 0 })],
            [span({ ts: 0, durS: 0 })]
        )!;
        expect(past.modelS).toBe(GEN_FIXED_S);
    });

    it("estimates generation inside a gap that has no tool call", () => {
        const row = sessionLatency(
            "s",
            [turn({ ts: 0 }), turn({ ts: 3600, outTok: 1000 })],
            []
        )!;
        expect(row.modelS).toBe(GEN_FIXED_S + 1000 / GEN_TOK_PER_S);
        expect(row.toolS).toBe(0);
        expect(row.idleS).toBe(3600 - row.modelS);
    });

    it("collapses the rows of one API response", () => {
        const rows = [
            turn({ ts: 0, ctx: 100, outTok: 50 }),
            // Same response, second content block: identical usage payload AND
            // identical timestamp.
            turn({ ts: 0, ctx: 100, outTok: 50 }),
            turn({ ts: 600, ctx: 900, outTok: 50 }),
        ];
        expect(sessionLatency("s", rows, [])!.turns).toBe(2);
    });

    it("keeps two distinct turns that merely share (ctx, outTok)", () => {
        // A prompt that did not grow between two real turns. Keying the dedupe
        // on (ctx, outTok) alone collapsed these, and with them the six-minute
        // gap between them — over the 2026-08-28 window every match on that
        // looser key was a false positive of exactly this shape.
        const rows = [
            turn({ ts: 0, ctx: 100, outTok: 50 }),
            turn({ ts: 351, ctx: 100, outTok: 50 }),
        ];
        const row = sessionLatency("s", rows, [])!;
        expect(row.turns).toBe(2);
        expect(row.wallS).toBe(351);
        // The gap is real and it is a human's: only the estimate is machine.
        expect(row.modelS).toBe(GEN_FIXED_S + 1);
        expect(row.idleS).toBe(351 - (GEN_FIXED_S + 1));
    });

    it("reports the gate share of tool time separately", () => {
        const row = sessionLatency(
            "s",
            [turn({ ts: 0 }), turn({ ts: 1000 })],
            [
                span({ ts: 0, durS: 300, cmd: "bun run check:lane" }),
                span({ ts: 400, durS: 100, cmd: "git status" }),
            ]
        )!;
        expect(row.toolS).toBe(400);
        expect(row.gateS).toBe(300);
    });

    it("sees a span that started before the interval it is still running in", () => {
        // The span starts in the first interval and returns during the second.
        // Its end, not the estimator, is where the second gap's generation
        // begins — otherwise 100s of machine time is filed as human idle.
        const turns = [
            turn({ ts: 0 }),
            turn({ ts: 50 }),
            turn({ ts: 210, outTok: 0 }),
        ];
        const spans = [span({ ts: 10, durS: 190 })];
        const row = sessionLatency("s", turns, spans)!;
        expect(row.toolS).toBe(190);
        // 200 -> 210 is the generation of the last message, taken whole.
        expect(row.modelS).toBe(10);
        expect(row.idleS).toBe(10);
    });

    it("ignores rows belonging to another session", () => {
        const row = sessionLatency(
            "s",
            [
                turn({ ts: 0 }),
                turn({ ts: 100 }),
                turn({ session: "other", ts: 99_999 }),
            ],
            [span({ session: "other", ts: 10, durS: 90 })]
        )!;
        expect(row.wallS).toBe(100);
        expect(row.toolS).toBe(0);
    });

    it("returns null for a session with no turns", () => {
        expect(sessionLatency("s", [], [])).toBeNull();
    });

    it("never reports negative idle", () => {
        const row = sessionLatency(
            "s",
            [turn({ ts: 0 }), turn({ ts: 10 })],
            [span({ ts: 0, durS: 10 }), span({ ts: 0, durS: 10 })]
        )!;
        expect(row.idleS).toBe(0);
    });
});

describe("allSessionLatencies", () => {
    const turns = [
        turn({ session: "a", ts: 0 }),
        turn({ session: "a", ts: 600 }),
        turn({ session: "b", ts: 0 }),
        turn({ session: "b", ts: 60 }),
        // A single-turn session has no wall clock to speak of.
        turn({ session: "c", ts: 0 }),
    ];

    it("drops single-turn sessions and sorts by wall clock", () => {
        const rows = allSessionLatencies(turns, [], []);
        expect(rows.map((r) => r.session)).toEqual(["a", "b"]);
    });

    it("carries the PR count and the opening command through", () => {
        const rows = allSessionLatencies(
            turns,
            [],
            [
                { session: "a", cmd: "/next-issue 3079", prs: [3100] },
                { session: "b", cmd: "/triage 42", prs: [] },
            ]
        );
        const a = rows.find((r) => r.session === "a")!;
        const b = rows.find((r) => r.session === "b")!;
        expect(a.prs).toBe(1);
        expect(isIssueClosing(a)).toBe(true);
        expect(isNextIssue(a)).toBe(true);
        expect(isIssueClosing(b)).toBe(false);
        expect(isNextIssue(b)).toBe(false);
    });
});

describe("quantile", () => {
    it("is nearest-rank, so every value it returns was observed", () => {
        const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        expect(quantile(values, 0.5)).toBe(5);
        expect(quantile(values, 0.9)).toBe(9);
        expect(quantile(values, 1)).toBe(10);
        expect(quantile([], 0.5)).toBe(0);
    });
});

describe("summarise / formatReport", () => {
    const rows = allSessionLatencies(
        [
            turn({ session: "a", ts: 0 }),
            turn({ session: "a", ts: 600 }),
            turn({ session: "b", ts: 0 }),
            turn({ session: "b", ts: 1200 }),
        ],
        [span({ session: "a", ts: 0, durS: 120, cmd: "bun run check:lane" })],
        []
    );

    it("summarises each component independently", () => {
        const c = summarise("cohort", rows);
        expect(c.sessions).toBe(2);
        expect(c.wall.median).toBe(600);
        expect(c.wall.p90).toBe(1200);
        expect(c.wall.mean).toBe(900);
        expect(c.tool.median).toBe(0);
        expect(c.gate.p90).toBe(120);
    });

    it("renders a receipt naming every component", () => {
        const out = formatReport(
            "2026-08-28",
            "2026-09-05",
            [summarise("cohort", rows)],
            12
        );
        expect(out).toContain("latency per issue — 2026-08-28 → 2026-09-05");
        expect(out).toContain("cohort — 2 sessions");
        for (const label of [
            "wall",
            "tool",
            "of which gate/test/build",
            "model",
            "machine (tool + model)",
            "idle",
        ]) {
            expect(out).toContain(label);
        }
        expect(out).toContain("10.0m");
    });
});
