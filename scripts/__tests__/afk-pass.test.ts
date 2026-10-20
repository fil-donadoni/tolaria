import { describe, it, expect } from "vitest";
import {
    DEFAULT_PASS_TIMEOUT_MIN,
    UNKNOWN_RESET_HOLD_MS,
    issuePr,
    outcomeExitCode,
    parsePassInputs,
    passClaudeArgs,
    passOutcome,
    passRecord,
    passTimeoutMin,
    passTokens,
    resultCost,
    summaryLines,
    usageLimitLine,
    usageLimitResetIso,
    wipAction,
    type OutcomeFacts,
} from "../lib/afk-pass";
import { parsePassRecord, passRunIssue } from "../lib/afk-dispatch";

// The AFK pass job's decisions (issue #5650). The record it writes is read
// back by the dispatcher's own parser here, so the two ends of the artifact
// cannot drift; the usage-limit lines are the CLI's real shape (transcripts
// of 2026-09-20 and 2026-10-14, trimmed).

const LIMIT_QUOTA = JSON.stringify({
    type: "assistant",
    timestamp: "2026-10-14T09:13:55.526Z",
    message: {
        content: [
            {
                type: "text",
                text: "You've hit your session limit · resets 12:30pm (Europe/Rome)",
            },
        ],
    },
    error: "rate_limit",
    isApiErrorMessage: true,
    apiErrorStatus: 429,
    quotaLimits: { status: "rejected", resetsAt: 1791973800 },
});
const LIMIT_PARAMS_ONLY = JSON.stringify({
    error: "rate_limit",
    isApiErrorMessage: true,
    apiErrorParams: { rate_limit_info: { resetsAt: 1791991800 } },
});
const LIMIT_NO_RESET = JSON.stringify({
    error: "rate_limit",
    isApiErrorMessage: true,
    apiError: "model_requires_usage_credits",
});

const facts = (over: Partial<OutcomeFacts> = {}): OutcomeFacts => ({
    exitCode: 0,
    timedOut: false,
    usageLimited: false,
    pr: null,
    issueClosed: false,
    labels: ["ready-for-agent", "in-progress"],
    ...over,
});

describe("afk-pass inputs and command line", () => {
    it("parses the dispatcher's inputs", () => {
        expect(
            parsePassInputs({
                AFK_ISSUE: "5650",
                AFK_MODEL: "opus",
                AFK_RESUME: "true",
            })
        ).toEqual({ issue: 5650, model: "opus", resume: true });
        expect(
            parsePassInputs({ AFK_ISSUE: "12", AFK_MODEL: "sonnet" }).resume
        ).toBe(false);
    });

    it("refuses a malformed issue or tier before any session starts", () => {
        expect(() =>
            parsePassInputs({ AFK_ISSUE: "12; rm", AFK_MODEL: "opus" })
        ).toThrow(/issue/);
        expect(() =>
            parsePassInputs({ AFK_ISSUE: "0", AFK_MODEL: "opus" })
        ).toThrow(/issue/);
        expect(() =>
            parsePassInputs({ AFK_ISSUE: "12", AFK_MODEL: "--opus" })
        ).toThrow(/tier/);
        expect(() => parsePassInputs({ AFK_ISSUE: "12" })).toThrow(/tier/);
    });

    it("runs /next-ticket N on the tier, with the session id and a JSON result", () => {
        const args = passClaudeArgs(
            { issue: 7, model: "fable", resume: false },
            "sid",
            ["--dangerously-skip-permissions"]
        );
        expect(args).toEqual([
            "--model",
            "fable",
            "--session-id",
            "sid",
            "-p",
            "/next-ticket 7",
            "--output-format",
            "json",
            "--dangerously-skip-permissions",
        ]);
        expect(
            passClaudeArgs({ issue: 7, model: "opus", resume: true }, "s", [])
        ).toContain("/next-ticket 7 --resume");
    });

    it("bounds the pass under the job's timeout", () => {
        expect(passTimeoutMin(undefined)).toBe(DEFAULT_PASS_TIMEOUT_MIN);
        expect(passTimeoutMin("")).toBe(DEFAULT_PASS_TIMEOUT_MIN);
        expect(passTimeoutMin("90")).toBe(90);
        expect(passTimeoutMin("500")).toBe(DEFAULT_PASS_TIMEOUT_MIN);
        expect(passTimeoutMin("-1")).toBe(DEFAULT_PASS_TIMEOUT_MIN);
    });
});

describe("afk-pass usage limit", () => {
    it("reads the reset off quotaLimits, else apiErrorParams", () => {
        expect(usageLimitLine(LIMIT_QUOTA)).toEqual({
            resetsAtMs: 1791973800_000,
        });
        expect(usageLimitLine(LIMIT_PARAMS_ONLY)).toEqual({
            resetsAtMs: 1791991800_000,
        });
        expect(usageLimitLine(LIMIT_NO_RESET)).toEqual({ resetsAtMs: null });
    });

    it("ignores lines that only mention a rate limit", () => {
        expect(usageLimitLine("")).toBeNull();
        expect(usageLimitLine('not json "rate_limit"')).toBeNull();
        expect(
            usageLimitLine(
                JSON.stringify({
                    type: "user",
                    message: { content: 'grep "rate_limit"' },
                })
            )
        ).toBeNull();
        expect(
            usageLimitLine(JSON.stringify({ error: "rate_limit" }))
        ).toBeNull();
    });

    it("tells the dispatcher the latest future reset", () => {
        const ended = 1791970000_000;
        expect(usageLimitResetIso([], ended)).toBeNull();
        expect(
            usageLimitResetIso(
                [
                    { resetsAtMs: 1791973800_000 },
                    { resetsAtMs: 1791991800_000 },
                ],
                ended
            )
        ).toBe(new Date(1791991800_000).toISOString());
        // a reset already past is no hold
        expect(
            usageLimitResetIso([{ resetsAtMs: ended - 1 }], ended)
        ).toBeNull();
        // no reset named: a bounded hold, never none
        expect(usageLimitResetIso([{ resetsAtMs: null }], ended)).toBe(
            new Date(ended + UNKNOWN_RESET_HOLD_MS).toISOString()
        );
    });
});

describe("afk-pass outcome", () => {
    const ready = {
        number: 9,
        headRefName: "feat/issue-7",
        labels: ["ready-to-land"],
    };

    it("a PR in the queue is a hand-off, whatever else happened", () => {
        expect(
            passOutcome(facts({ pr: ready, usageLimited: true, exitCode: 1 }))
        ).toBe("handed-off");
        expect(
            passOutcome(facts({ pr: { ...ready, labels: [] }, exitCode: 0 }))
        ).toBe("no-hand-off");
    });

    it("a usage limit explains a timeout or an error, and exits 0", () => {
        const o = passOutcome(
            facts({ usageLimited: true, timedOut: true, exitCode: null })
        );
        expect(o).toBe("usage-limit");
        expect(outcomeExitCode(o)).toBe(0);
    });

    it("a released claim is the skill's abort; a closed issue is done", () => {
        expect(passOutcome(facts({ labels: ["ready-for-human"] }))).toBe(
            "aborted"
        );
        expect(passOutcome(facts({ labels: ["pr-open"] }))).toBe("no-hand-off");
        expect(passOutcome(facts({ issueClosed: true, exitCode: 1 }))).toBe(
            "closed"
        );
    });

    it("a held claim with nothing handed off fails the run", () => {
        expect(passOutcome(facts({ timedOut: true, exitCode: null }))).toBe(
            "timeout"
        );
        expect(passOutcome(facts({ exitCode: 2 }))).toBe("error");
        expect(passOutcome(facts())).toBe("no-hand-off");
        for (const o of ["timeout", "error", "no-hand-off"] as const)
            expect(outcomeExitCode(o)).toBe(1);
        for (const o of ["handed-off", "closed", "aborted"] as const)
            expect(outcomeExitCode(o)).toBe(0);
    });

    it("finds the issue's own PR by branch", () => {
        const prs = [
            { number: 1, headRefName: "feat/issue-70", labels: [] },
            { number: 2, headRefName: "fix/issue-7", labels: [] },
        ];
        expect(issuePr(7, prs)?.number).toBe(2);
        expect(issuePr(8, prs)).toBeNull();
    });
});

describe("afk-pass WIP push", () => {
    const base = {
        outcome: "timeout" as const,
        issue: 7,
        branch: "feat/issue-7",
        dirty: true,
        unpushed: true,
    };

    it("pushes a stopped pass's work to its own branch, committing it first", () => {
        expect(wipAction(base)).toEqual({
            kind: "push",
            commit: true,
            branch: "feat/issue-7",
        });
        expect(wipAction({ ...base, dirty: false })).toEqual({
            kind: "push",
            commit: false,
            branch: "feat/issue-7",
        });
    });

    it("never pushes a detached HEAD, another branch, or a finished pass", () => {
        expect(wipAction({ ...base, branch: "HEAD" }).kind).toBe("none");
        expect(wipAction({ ...base, branch: "staging" }).kind).toBe("none");
        expect(wipAction({ ...base, branch: "feat/issue-70" }).kind).toBe(
            "none"
        );
        expect(wipAction({ ...base, outcome: "handed-off" }).kind).toBe("none");
        expect(wipAction({ ...base, outcome: "aborted" }).kind).toBe("none");
        expect(wipAction({ ...base, dirty: false, unpushed: false }).kind).toBe(
            "none"
        );
    });
});

describe("afk-pass record", () => {
    it("is read back whole by the dispatcher's parser", () => {
        const models = passTokens([
            {
                tsMs: 1,
                model: "claude-opus-5-5",
                input: 10,
                output: 20,
                cacheCreation: 30,
                cacheRead: 40,
            },
            {
                tsMs: 2,
                model: "claude-opus-5-5",
                input: 1,
                output: 2,
                cacheCreation: 3,
                cacheRead: 4,
            },
        ]);
        const rec = passRecord({
            issue: 7,
            pr: 9,
            outcome: "usage-limit",
            host: "macbook",
            startedMs: Date.parse("2026-10-20T10:00:00Z"),
            endedMs: Date.parse("2026-10-20T11:30:00Z"),
            models,
            costUsd: 4.25,
            usageLimitResetAt: "2026-10-20T12:30:00.000Z",
        });
        expect(parsePassRecord(JSON.stringify(rec))).toEqual(rec);
        expect(rec.durationS).toBe(5400);
        expect(rec.models["claude-opus-5-5"]).toEqual({
            input: 11,
            output: 22,
            cacheCreation: 33,
            cacheRead: 44,
        });
    });

    it("the summary carries numbers, never a host", () => {
        const rec = passRecord({
            issue: 7,
            pr: null,
            outcome: "error",
            host: "secret-host",
            startedMs: 0,
            endedMs: 60_000,
            models: {},
            costUsd: null,
            usageLimitResetAt: null,
        });
        const text = summaryLines(rec).join("\n");
        expect(text).toContain("#7");
        expect(text).toContain("`error`");
        expect(text).not.toContain("secret-host");
    });

    it("reads the cost off the JSON result, or none", () => {
        expect(
            resultCost(JSON.stringify({ type: "result", total_cost_usd: 1.5 }))
        ).toBe(1.5);
        expect(
            resultCost(`noise\n${JSON.stringify({ total_cost_usd: 2 })}\n`)
        ).toBe(2);
        expect(resultCost("")).toBeNull();
        expect(resultCost("killed")).toBeNull();
    });

    it("the run name convention names the issue for the dispatcher", () => {
        // afk-pass.yml's run-name: `afk-pass #<N>` or `afk-pass #<N> (resume)`
        expect(passRunIssue("afk-pass #7")).toBe(7);
        expect(passRunIssue("afk-pass #7 (resume)")).toBe(7);
    });
});
