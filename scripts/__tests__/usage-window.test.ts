import { describe, it, expect } from "vitest";

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { sessionsOfRun } from "../lib/session-origin";
import {
    parseUsageLine,
    sumWindow,
    weightedTokens,
    pctOfBudget,
    classifyModel,
    DEFAULT_WEIGHTS,
    MOST_EXPENSIVE_WEIGHT_CLASS,
    type UsageRecord,
} from "../lib/usage-window";

/**
 * `scripts/lib/usage-window.ts` is the pure accounting core behind
 * `bun run usage:window` and, transitively, `scripts/loop-drain.sh`'s budget
 * guard (PRD: the AFK driver, ADR 0097). Every case here guards a real way an
 * unattended loop could either burn money silently or stop for no reason.
 */

const line = (obj: unknown): string => JSON.stringify(obj);

const usageLine = (over: {
    ts?: string;
    model?: string;
    usage?: Record<string, unknown>;
}) =>
    line({
        timestamp: over.ts ?? "2026-08-08T10:00:00.000Z",
        message: {
            model: over.model ?? "claude-sonnet-5-20260101",
            usage: {
                input_tokens: 2,
                output_tokens: 135,
                cache_creation_input_tokens: 643,
                cache_read_input_tokens: 115288,
                ...(over.usage ?? {}),
            },
        },
    });

describe("parseUsageLine — the iterations double-count trap", () => {
    it("reads ONLY the top-level usage fields, ignoring a matching iterations array", () => {
        // Pins the exact trap described in the task: `usage.iterations[]`
        // repeats the SAME numbers as the top-level fields under the same
        // key names. A parser that also walked `iterations` and summed it in
        // would silently double (or worse) every line's contribution.
        const raw = line({
            timestamp: "2026-08-08T10:00:00.000Z",
            message: {
                model: "claude-sonnet-5-20260101",
                usage: {
                    input_tokens: 2,
                    cache_creation_input_tokens: 643,
                    cache_read_input_tokens: 115288,
                    output_tokens: 135,
                    cache_creation: {
                        ephemeral_1h_input_tokens: 643,
                        ephemeral_5m_input_tokens: 0,
                    },
                    iterations: [
                        {
                            input_tokens: 2,
                            output_tokens: 135,
                            cache_read_input_tokens: 115288,
                            cache_creation_input_tokens: 643,
                            type: "message",
                        },
                    ],
                },
            },
        });

        const rec = parseUsageLine(raw);
        expect(rec).not.toBeNull();
        expect(rec).toEqual({
            tsMs: Date.parse("2026-08-08T10:00:00.000Z"),
            model: "claude-sonnet-5-20260101",
            input: 2,
            output: 135,
            cacheCreation: 643,
            cacheRead: 115288,
        });
    });

    it("proof-of-failure sibling: a parser that ALSO summed iterations would double every field", () => {
        // Not a real code path — a direct demonstration of the trap's shape,
        // so the fixture above reads as a deliberate regression guard rather
        // than an arbitrary assertion. If parseUsageLine ever regresses to
        // include iterations, this shows what "double" looks like.
        const rec = parseUsageLine(
            usageLine({
                usage: {
                    input_tokens: 10,
                    output_tokens: 10,
                    cache_creation_input_tokens: 10,
                    cache_read_input_tokens: 10,
                    iterations: [
                        {
                            input_tokens: 10,
                            output_tokens: 10,
                            cache_creation_input_tokens: 10,
                            cache_read_input_tokens: 10,
                        },
                    ],
                },
            })
        )!;
        // The real guard: if parseUsageLine ever regressed to also sum
        // `iterations`, this would read 20, not 10.
        expect(rec.input).toBe(10);
    });
});

describe("parseUsageLine — never throws, returns null for anything unusable", () => {
    it.each([
        ["empty string", ""],
        ["whitespace only", "   \n"],
        ["not JSON", "not json at all {{{"],
        ["a JSON array", "[1,2,3]"],
        ["null", "null"],
        ["a bare number", "42"],
        [
            "a user turn (no message.usage)",
            line({ type: "user", message: { role: "user", content: "hi" } }),
        ],
        ["a tool_result line", line({ type: "tool_result", content: [] })],
        ["a summary line", line({ type: "summary", summary: "..." })],
        [
            "message present but no usage",
            line({
                timestamp: "2026-08-08T10:00:00.000Z",
                message: { model: "claude-sonnet-5" },
            }),
        ],
        [
            "usage present but no model",
            line({
                timestamp: "2026-08-08T10:00:00.000Z",
                message: { usage: { input_tokens: 1 } },
            }),
        ],
        [
            "usage present but no timestamp",
            line({
                message: {
                    model: "claude-sonnet-5",
                    usage: { input_tokens: 1 },
                },
            }),
        ],
        ["timestamp is not parseable", usageLine({ ts: "not-a-date" })],
        [
            "message is a string, not an object",
            line({ timestamp: "2026-08-08T10:00:00.000Z", message: "oops" }),
        ],
        [
            "usage is a string, not an object",
            line({
                timestamp: "2026-08-08T10:00:00.000Z",
                message: { model: "x", usage: "oops" },
            }),
        ],
    ])("%s -> null, no throw", (_label, input) => {
        expect(() => parseUsageLine(input)).not.toThrow();
        expect(parseUsageLine(input)).toBeNull();
    });

    it("tolerates missing/non-numeric numeric fields by treating them as 0", () => {
        const rec = parseUsageLine(
            usageLine({
                usage: {
                    input_tokens: "not-a-number",
                    output_tokens: null,
                    cache_creation_input_tokens: undefined,
                    cache_read_input_tokens: {},
                },
            })
        );
        expect(rec).toEqual({
            tsMs: Date.parse("2026-08-08T10:00:00.000Z"),
            model: "claude-sonnet-5-20260101",
            input: 0,
            output: 0,
            cacheCreation: 0,
            cacheRead: 0,
        });
    });
});

describe("sumWindow — the window boundary", () => {
    const at = (tsMs: number, model = "claude-sonnet-5"): UsageRecord => ({
        tsMs,
        model,
        input: 1,
        output: 1,
        cacheCreation: 1,
        cacheRead: 1,
    });

    it("includes a record exactly AT sinceMs (closed left edge)", () => {
        const sinceMs = 1000;
        const { totals } = sumWindow([at(1000)], sinceMs);
        expect(totals.input).toBe(1);
    });

    it("excludes a record one millisecond before sinceMs", () => {
        const sinceMs = 1000;
        const { totals } = sumWindow([at(999)], sinceMs);
        expect(totals.input).toBe(0);
    });

    it("sums per-model AND totals across a mixed window", () => {
        const sinceMs = 1000;
        const { models, totals } = sumWindow(
            [
                at(1000, "claude-sonnet-5"),
                at(1500, "claude-sonnet-5"),
                at(2000, "claude-opus-4-5"),
                at(500, "claude-opus-4-5"), // outside window
            ],
            sinceMs
        );
        expect(models["claude-sonnet-5"]).toEqual({
            input: 2,
            output: 2,
            cacheCreation: 2,
            cacheRead: 2,
        });
        expect(models["claude-opus-4-5"]).toEqual({
            input: 1,
            output: 1,
            cacheCreation: 1,
            cacheRead: 1,
        });
        expect(totals).toEqual({
            input: 3,
            output: 3,
            cacheCreation: 3,
            cacheRead: 3,
        });
    });
});

describe("classifyModel / weightedTokens — unknown model fails expensive", () => {
    it("classifies recognised family names case-insensitively", () => {
        expect(classifyModel("claude-opus-4-5-20260101")).toBe("opus");
        expect(classifyModel("CLAUDE-SONNET-5-20260101")).toBe("sonnet");
        expect(classifyModel("claude-haiku-4-5")).toBe("haiku");
        expect(classifyModel("claude-fable-5-20260101")).toBe("fable");
        expect(classifyModel("CLAUDE-MYTHOS-5")).toBe("fable");
    });

    it("falls back an unrecognised model to the MOST expensive class", () => {
        expect(classifyModel("some-future-model-nobody-has-seen")).toBe(
            MOST_EXPENSIVE_WEIGHT_CLASS
        );
        // fable/mythos ($10/$50 per MTok) is the most expensive KNOWN class —
        // opus ($5/$25) is cheaper than that. An unknown model must fall back
        // to whichever row is genuinely priciest, not to opus by habit.
        expect(MOST_EXPENSIVE_WEIGHT_CLASS).toBe("fable");
    });

    it("weights an unknown model as if it were fable, never as a cheaper class (opus included)", () => {
        const unknownSum = {
            models: {
                "brand-new-model-xyz": {
                    input: 100,
                    output: 100,
                    cacheCreation: 100,
                    cacheRead: 100,
                },
            },
        };
        const knownFableSum = {
            models: {
                "claude-fable-5": {
                    input: 100,
                    output: 100,
                    cacheCreation: 100,
                    cacheRead: 100,
                },
            },
        };
        const knownOpusSum = {
            models: {
                "claude-opus-4-5": {
                    input: 100,
                    output: 100,
                    cacheCreation: 100,
                    cacheRead: 100,
                },
            },
        };
        const knownSonnetSum = {
            models: {
                "claude-sonnet-5": {
                    input: 100,
                    output: 100,
                    cacheCreation: 100,
                    cacheRead: 100,
                },
            },
        };
        const unknownWeighted = weightedTokens(unknownSum);
        expect(unknownWeighted).toBe(weightedTokens(knownFableSum));
        // The load-bearing part of this fix: an unknown model must weight
        // STRICTLY MORE than opus, not the same — opus is no longer the most
        // expensive known class, so an unknown model landing on the opus
        // weight (as it used to) would silently look cheaper than it should.
        expect(unknownWeighted).toBeGreaterThan(weightedTokens(knownOpusSum));
        // Proof it fails EXPENSIVE, not cheap: strictly more than the sonnet
        // weighting of the identical raw counts.
        expect(unknownWeighted).toBeGreaterThan(weightedTokens(knownSonnetSum));
    });

    it("DEFAULT_WEIGHTS anchors sonnet input at 1 and prices opus output above sonnet output", () => {
        expect(DEFAULT_WEIGHTS.sonnet.input).toBe(1);
        expect(DEFAULT_WEIGHTS.opus.output).toBeGreaterThan(
            DEFAULT_WEIGHTS.sonnet.output
        );
        // Cache reads are meant to be an order of magnitude cheaper than a
        // fresh input token, for every class.
        for (const cls of Object.values(DEFAULT_WEIGHTS)) {
            expect(cls.cacheRead).toBeLessThan(cls.input);
        }
    });

    it("fable is priced at $10/$50 per MTok, the genuinely most expensive class", () => {
        expect(DEFAULT_WEIGHTS.fable.input).toBeCloseTo(10 / 3, 1);
        expect(DEFAULT_WEIGHTS.fable.output).toBeCloseTo(50 / 3, 1);
        expect(DEFAULT_WEIGHTS.fable.input).toBeGreaterThan(
            DEFAULT_WEIGHTS.opus.input
        );
        expect(DEFAULT_WEIGHTS.fable.output).toBeGreaterThan(
            DEFAULT_WEIGHTS.opus.output
        );
    });

    it("cache write is ~1.25x input and cache read is ~0.1x input for every class", () => {
        // Sonnet/haiku are exact ÷3 rounding, so tight; opus/fable are
        // rounded to fewer significant figures in the table, so a looser
        // tolerance — the point is the RELATIONSHIP holds, not bit-exactness.
        for (const cls of Object.values(DEFAULT_WEIGHTS)) {
            expect(cls.cacheCreation).toBeCloseTo(cls.input * 1.25, 1);
            expect(cls.cacheRead).toBeCloseTo(cls.input * 0.1, 1);
        }
    });
});

describe("pctOfBudget — never divides by zero, never returns Infinity", () => {
    it("returns 0 for a zero budget", () => {
        expect(pctOfBudget(999, 0)).toBe(0);
    });

    it("returns 0 for a negative budget", () => {
        expect(pctOfBudget(999, -5)).toBe(0);
    });

    it("computes a normal percentage otherwise", () => {
        expect(pctOfBudget(50, 200)).toBe(25);
    });

    it("never returns Infinity or NaN for any budget <= 0", () => {
        for (const budget of [0, -1, -0]) {
            const pct = pctOfBudget(123, budget);
            expect(Number.isFinite(pct)).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────
// A RUN's spend, not a window over the machine (issue #3699)
//
// `--budget` is read by everyone who types it as "this run may spend N". What
// the guard actually read was a trailing five-hour window over every session
// on the box: it refused to start on the operator's own interactive spend (a
// 140M budget tripped at 132% with the driver having spent nothing), and it
// could never stop a run at a cumulative total, because a window forgets — one
// recorded run went 22.11% → 12.91% across seven passes, and across 23 runs
// not one ended with reason `budget`.
//
// The join is the file NAME: a Claude Code transcript lives at
// `<projects>/<slug>/<session-id>.jsonl`, and the session journal says which
// sessions a run started. These tests drive the real CLI over synthetic
// transcripts, because the bug was never in the summing — those functions were
// pure and tested and correct — but in WHICH lines reached them.
// ─────────────────────────────────────────────────────────────────────────

describe("sessionsOfRun — which sessions a run owns", () => {
    const row = (o: Record<string, unknown>) => JSON.stringify(o);

    it("takes the run's own AFK sessions and nothing else", () => {
        const journal = [
            row({ session: "a", origin: "afk", run: "R1" }),
            row({ session: "b", origin: "afk", run: "R2" }),
            row({ session: "c", origin: "interactive", run: "" }),
            row({ session: "d", origin: "afk" }), // pre-#3699 row, no run
        ].join("\n");
        expect([...sessionsOfRun(journal, "R1")]).toEqual(["a"]);
        expect([...sessionsOfRun(journal, "R2")]).toEqual(["b"]);
    });

    it("never answers for an empty run id — that would be every unattributed row", () => {
        const journal = row({ session: "d", origin: "afk", run: "" });
        expect(sessionsOfRun(journal, "").size).toBe(0);
    });

    it("refuses a row that names the run but was not recorded as a pass", () => {
        // A stray TOLARIA_LOOP_RUN_ID in an interactive shell must not be able
        // to spend the run's budget.
        const journal = row({ session: "x", origin: "interactive", run: "R1" });
        expect(sessionsOfRun(journal, "R1").size).toBe(0);
    });

    it("skips a malformed line instead of losing every row before it", () => {
        // The journal is appended to by a shell hook that can be killed
        // mid-write; a half-written last line must cost one row, not all.
        const journal = [
            row({ session: "a", origin: "afk", run: "R1" }),
            '{"session":"b","origin":"afk","run":"R1"',
        ].join("\n");
        expect([...sessionsOfRun(journal, "R1")]).toEqual(["a"]);
    });
});

describe("usage:window CLI — a run's own spend over synthetic transcripts", () => {
    const CLI = path.resolve(__dirname, "..", "usage-window.ts");

    interface Report {
        sinceMs: number;
        hours: number | null;
        runId: string | null;
        sessions: number | null;
        weighted: number;
        budget: number;
        pct: number;
        totals: { output: number };
    }

    /** A scratch `~/.claude/projects` plus a session journal. */
    const fixture = (): {
        dir: string;
        projects: string;
        journal: string;
        transcript: (session: string, tsIso: string, output: number) => void;
        record: (session: string, run: string, origin?: string) => void;
    } => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-window-"));
        const projects = path.join(dir, "projects", "slug");
        fs.mkdirSync(projects, { recursive: true });
        const journal = path.join(dir, "sessions.jsonl");
        return {
            dir,
            projects: path.join(dir, "projects"),
            journal,
            transcript: (session, tsIso, output) =>
                fs.writeFileSync(
                    path.join(projects, `${session}.jsonl`),
                    `${JSON.stringify({
                        timestamp: tsIso,
                        message: {
                            model: "claude-sonnet-5-20260101",
                            usage: {
                                input_tokens: 0,
                                output_tokens: output,
                                cache_creation_input_tokens: 0,
                                cache_read_input_tokens: 0,
                            },
                        },
                    })}\n`
                ),
            record: (session, run, origin = "afk") =>
                fs.appendFileSync(
                    journal,
                    `${JSON.stringify({ ts: 1, session, origin, run })}\n`
                ),
        };
    };

    const report = (args: string[]): Report =>
        JSON.parse(
            spawnSync("bun", [CLI, ...args], { encoding: "utf8" }).stdout
        ) as Report;

    it("counts only the transcripts of the run's own sessions", () => {
        // The acceptance criterion, over synthetic transcripts: a concurrent
        // session that is not a pass of the run contributes nothing.
        const f = fixture();
        const now = new Date().toISOString();
        f.transcript("ours", now, 1000);
        f.transcript("theirs", now, 9_000_000);
        f.record("ours", "R1");
        f.record("theirs", "", "interactive");

        const scoped = report([
            "--since",
            "0",
            "--run",
            "R1",
            "--projects",
            f.projects,
            "--sessions",
            f.journal,
            "--budget",
            "1000000",
        ]);
        expect(scoped.sessions).toBe(1);
        expect(scoped.totals.output).toBe(1000);
        expect(scoped.runId).toBe("R1");

        // …and without the flag the SAME corpus reads machine-wide, which is
        // what made the guard refuse to start on somebody else's spend.
        const wide = report([
            "--hours",
            "5",
            "--projects",
            f.projects,
            "--budget",
            "1000000",
        ]);
        expect(wide.totals.output).toBe(9_001_000);
        expect(wide.runId).toBe(null);
        fs.rmSync(f.dir, { recursive: true, force: true });
    });

    it("a run that has launched no pass yet has spent NOTHING, however hot the machine is", () => {
        // Why a fresh run is never blocked by pre-existing spend: it owns no
        // session, so it owns no tokens. The empty set is a real answer, not a
        // missing filter — failing open here would restore the machine-wide
        // reading under a flag that says the opposite.
        const f = fixture();
        f.transcript("theirs", new Date().toISOString(), 9_000_000);
        const r = report([
            "--since",
            "0",
            "--run",
            "R-new",
            "--projects",
            f.projects,
            "--sessions",
            f.journal,
            "--budget",
            "1000",
        ]);
        expect(r.sessions).toBe(0);
        expect(r.weighted).toBe(0);
        expect(r.pct).toBe(0);
        fs.rmSync(f.dir, { recursive: true, force: true });
    });

    it("--since anchors the left edge absolutely, replacing the trailing window", () => {
        // A window forgets; an anchor does not. `hours` reads null in the
        // report precisely so nobody can mistake one reading for the other.
        const f = fixture();
        f.transcript("ours", "2020-01-01T00:00:00.000Z", 500);
        f.record("ours", "R1");
        const base = [
            "--run",
            "R1",
            "--projects",
            f.projects,
            "--sessions",
            f.journal,
            "--budget",
            "1000",
        ];
        expect(report(["--since", "0", ...base]).totals.output).toBe(500);
        expect(report(["--hours", "5", ...base]).totals.output).toBe(0);
        expect(report(["--since", "0", ...base]).hours).toBe(null);

        // ISO is accepted too — the driver has epoch ms in a shell variable,
        // a human reaching for the docs has a timestamp.
        expect(
            report(["--since", "2019-01-01T00:00:00.000Z", ...base]).totals
                .output
        ).toBe(500);
        fs.rmSync(f.dir, { recursive: true, force: true });
    });
});
