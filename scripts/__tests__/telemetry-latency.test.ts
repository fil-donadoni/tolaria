import { describe, it, expect } from "vitest";
import {
    allSessionLatencies,
    blockingFindingRate,
    estimateGenerationSeconds,
    formatReport,
    hourlyThroughput,
    isGateSpan,
    isGitCommitCommand,
    isIssueClosing,
    isNextIssue,
    isTargetedVitestCommand,
    laneHistogram,
    parseHealthLogRed,
    parseLaneLine,
    quantile,
    redOnRedBaseline,
    sessionLatency,
    summarise,
    throughputByConcurrency,
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

// ─────────────────────────────────────────────────────────────────────────
// The four ADR 0136 KPI rows (issue #3777).
// ─────────────────────────────────────────────────────────────────────────

describe("hourlyThroughput / throughputByConcurrency", () => {
    it("buckets active sessions and merges into local hours", () => {
        const buckets = hourlyThroughput(
            [
                turn({ session: "a", ts: 0 }),
                turn({ session: "b", ts: 100 }),
                turn({ session: "a", ts: 3700 }), // next hour
            ],
            [{ number: 1, mergedAtS: 200 }]
        );
        expect(buckets).toEqual([
            { hourStartS: 0, activeSessions: 2, prsLanded: 1 },
            { hourStartS: 3600, activeSessions: 1, prsLanded: 0 },
        ]);
    });

    it("groups PR throughput by concurrency level, dropping session-less hours", () => {
        const rows = throughputByConcurrency([
            { hourStartS: 0, activeSessions: 1, prsLanded: 1 },
            { hourStartS: 3600, activeSessions: 1, prsLanded: 0 },
            { hourStartS: 7200, activeSessions: 3, prsLanded: 3 },
            { hourStartS: 10800, activeSessions: 0, prsLanded: 5 }, // dropped
        ]);
        expect(rows).toEqual([
            { activeSessions: 1, hours: 2, prsPerHour: 0.5 },
            { activeSessions: 3, hours: 1, prsPerHour: 3 },
        ]);
    });

    it("PROOF OF FAILURE: hour boundaries must floor, not round", () => {
        // A plausible-but-wrong alternate: round to the nearest hour instead of
        // flooring. 1900s is 31.6 minutes into its hour — nowhere near the next
        // one — but naive rounding still walks it into hour 1.
        const wrongHourStart = (ts: number) => Math.round(ts / 3600) * 3600;
        expect(wrongHourStart(1900)).toBe(3600); // the bug: hour 1, not hour 0
        // The real function keeps it in the hour it actually falls in:
        const real = hourlyThroughput([turn({ session: "a", ts: 1900 })], []);
        expect(real).toEqual([
            { hourStartS: 0, activeSessions: 1, prsLanded: 0 },
        ]);
    });
});

describe("blockingFindingRate", () => {
    const reviews = [
        { session: "a", model: "opus", startS: 0, endS: 100 },
        { session: "b", model: "opus", startS: 0, endS: 100 },
        { session: "c", model: "sonnet", startS: 0, endS: 100 },
    ];

    it("counts a review as blocking when a later commit lands in the same session", () => {
        const rows = blockingFindingRate(
            reviews,
            [
                { session: "a", ts: 160 }, // 1 minute after review end — blocking
                { session: "c", ts: 50 }, // BEFORE review end — not blocking
            ],
            []
        );
        const opus = rows.find((r) => r.model === "opus")!;
        expect(opus.reviews).toBe(2);
        expect(opus.blocking).toBe(1);
        expect(opus.rate).toBeCloseTo(0.5);
        expect(opus.minutesAfter.median).toBeCloseTo(1);

        const sonnet = rows.find((r) => r.model === "sonnet")!;
        expect(sonnet.reviews).toBe(1);
        expect(sonnet.blocking).toBe(0);
        expect(sonnet.rate).toBe(0);
    });

    it("ignores a commit after the session's own PR merged", () => {
        const rows = blockingFindingRate(
            [reviews[0]],
            [{ session: "a", ts: 500 }],
            [{ session: "a", mergedAtS: 200 }] // merged before the commit
        );
        expect(rows[0].blocking).toBe(0);
    });

    it("PROOF OF FAILURE: a commit from another session must not count", () => {
        // A plausible-but-wrong alternate: drop session-scoping and ask "did ANY
        // commit land after this review's end", the mistake a refactor that
        // forgot the join key would make.
        const brokenBlocking = (
            reviewList: typeof reviews,
            allCommits: { session: string; ts: number }[]
        ) => reviewList.map((r) => allCommits.some((c) => c.ts > r.endS));
        const broken = brokenBlocking(reviews, [{ session: "z", ts: 999 }]);
        expect(broken.every(Boolean)).toBe(true); // the bug: every review "blocks"
        // The real function scopes the commit to the review's OWN session, and
        // the only commit here belongs to a session with no review at all:
        const rows = blockingFindingRate(
            reviews,
            [{ session: "z", ts: 999 }],
            []
        );
        expect(rows.every((r) => r.blocking === 0)).toBe(true);
    });
});

describe("redOnRedBaseline", () => {
    it("rates red targeted-vitest runs against a base health later reddened", () => {
        const result = redOnRedBaseline(
            [
                { session: "a", ts: 10, red: true },
                { session: "b", ts: 20, red: true },
                { session: "c", ts: 30, red: false }, // green — excluded from the denominator
            ],
            [
                { session: "a", base: "deadbeef0000cafefeed" },
                { session: "b", base: "0000000000000000000" },
            ],
            [{ sha12: "deadbeef0000", red: true }]
        );
        expect(result).toEqual({ redRuns: 2, onRedBaseline: 1, rate: 0.5 });
    });

    it("PROOF OF FAILURE: a green health verdict must not count as red", () => {
        const brokenResult = redOnRedBaseline(
            [{ session: "a", ts: 10, red: true }],
            [{ session: "a", base: "deadbeef0000cafe" }],
            [{ sha12: "deadbeef0000", red: false }] // GREEN, not red
        );
        expect(brokenResult.onRedBaseline).toBe(0);
        expect(brokenResult.rate).toBe(0);
    });
});

describe("laneHistogram", () => {
    it("counts runs and green runs per classified lane", () => {
        const rows = laneHistogram([
            { lane: "engine", green: true },
            { lane: "engine", green: false },
            { lane: "skin", green: true },
            { lane: null, green: true }, // excluded — no lane classification
        ]);
        expect(rows).toEqual([
            { lane: "engine", runs: 2, green: 1 },
            { lane: "skin", runs: 1, green: 1 },
        ]);
    });

    it("PROOF OF FAILURE: a null lane must not become a '(none)' bucket", () => {
        const rows = laneHistogram([{ lane: null, green: true }]);
        expect(rows).toEqual([]); // broken version would emit a bucket here
    });
});

describe("parseLaneLine", () => {
    it("extracts the lane from check-lane.ts's own line", () => {
        const log =
            "some other output\n" +
            "lane:  engine   (HEAD abc123, 3 files — 3 under convex/, 0 prose)\n" +
            "more output\n";
        expect(parseLaneLine(log)).toBe("engine");
    });

    it("does not match land.ts's own 'lane: ran' / 'lane: skipped' lines", () => {
        expect(parseLaneLine("lane: ran\n")).toBeNull();
        expect(
            parseLaneLine("lane: skipped (gated abc123 against def456)\n")
        ).toBeNull();
    });

    it("PROOF OF FAILURE: a loose single-space pattern would match land.ts's line too", () => {
        const loose = /^lane:\s+(\S+)/m;
        const m = "lane: ran\n".match(loose);
        expect(m?.[1]).toBe("ran"); // the bug this test guards against
        expect(parseLaneLine("lane: ran\n")).toBeNull(); // the real parser does not
    });
});

describe("isGitCommitCommand / isTargetedVitestCommand", () => {
    it("recognises a real invocation, at the start or after a shell separator", () => {
        expect(isGitCommitCommand("git commit -m 'fix'")).toBe(true);
        expect(isGitCommitCommand("cd worktree && git commit -am wip")).toBe(
            true
        );
        expect(
            isTargetedVitestCommand("bunx vitest run scripts/x.test.ts")
        ).toBe(true);
        expect(
            isTargetedVitestCommand("cd wt && vitest run scripts/x.test.ts")
        ).toBe(true);
    });

    it("PROOF OF FAILURE: a grep for the words must not count as the command", () => {
        // The exact false positive `blockingFindingRate` would otherwise inflate
        // on: reviewing THIS module involves grepping for its own literal text.
        const grep = 'grep -rn "git commit" scripts/';
        expect(isGitCommitCommand(grep)).toBe(false);
        // A naive substring test is what would get this wrong:
        expect(grep.includes("git commit")).toBe(true); // the bug this guards against

        const grepVitest = 'grep -rn "vitest run" scripts/';
        expect(isTargetedVitestCommand(grepVitest)).toBe(false);
        expect(grepVitest.includes("vitest run")).toBe(true);
    });
});

describe("parseHealthLogRed", () => {
    it("is red when any step exited non-zero", () => {
        const log =
            "\n===== bun run check:all (exit 0) =====\nok\n" +
            "\n===== bun run test:app (exit 1) =====\nFAIL\n";
        expect(parseHealthLogRed(log)).toBe(true);
    });

    it("is green when every step exited zero", () => {
        const log =
            "\n===== bun run check:all (exit 0) =====\nok\n" +
            "\n===== bun run test:app (exit 0) =====\nok\n";
        expect(parseHealthLogRed(log)).toBe(false);
    });

    it("is unknown (null) for a log with no exit-code line at all", () => {
        expect(
            parseHealthLogRed("still running, no step finished yet\n")
        ).toBeNull();
    });

    it("PROOF OF FAILURE: a killed step (exit null) must read as red, not be silently dropped", () => {
        // health-step.ts's own exit code is Node's child.on("close", (code) => …)
        // value, which is `null` — not a number — when the step was killed by a
        // signal or failed to spawn; the log then literally reads "(exit null)".
        const log = "\n===== bun run check:all (exit null) =====\nkilled\n";
        // A regex that only captures digits is the exact bug this guards
        // against: it finds no numeric exit at all and calls the run "unknown".
        const digitsOnly = (l: string) =>
            [...l.matchAll(/\(exit (\d+)\)/g)].map((m) => Number(m[1]));
        expect(digitsOnly(log)).toEqual([]); // the bug: the killed step vanishes
        expect(parseHealthLogRed(log)).toBe(true); // the real parser calls it red
    });

    it("PROOF OF FAILURE: a log ending on a later green step must not erase an earlier red", () => {
        // health-main.ts stops at the FIRST red in practice, so this shape is not
        // produced today — but the parser must not assume that ordering to stay
        // correct if a future retry step reruns after a partial failure.
        const log =
            "\n===== step-one (exit 1) =====\nFAIL\n" +
            "\n===== step-two (exit 0) =====\nok\n";
        expect(parseHealthLogRed(log)).toBe(true);
        // A parser that looked only at the LAST exit code would get this wrong:
        const lastOnly = (l: string) => {
            const exits = [...l.matchAll(/\(exit (\d+)\)/g)];
            return Number(exits[exits.length - 1][1]) !== 0;
        };
        expect(lastOnly(log)).toBe(false); // the bug this test guards against
    });
});
