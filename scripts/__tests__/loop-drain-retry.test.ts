import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    installLoopDrainHarness,
    tmp,
    queueFile,
    totalFile,
    greenShaFile,
    writeStub,
    stubGhCountingFrom,
    stubGhTwoCounters,
    stubClaudeProgress,
    stubClaudeNoProgress,
    run,
    logLines,
    passLogCount,
} from "./loop-drain-harness";

installLoopDrainHarness();

describe("claude-error detection — distinct from rate-limit", () => {
    it("stops with reason claude-error (not rate-limit) on a non-zero claude exit with no rate-limit-shaped message", () => {
        stubGhCountingFrom(5);
        writeStub("claude", `echo "some unrelated crash"\nexit 17`);
        // `--max-consecutive-errors 1` = the pre-retry behaviour (stop on the
        // first crash). The retry policy itself is exercised in its own
        // describe block below; this test is about the REASON a crash gets,
        // not about how many crashes are tolerated.
        const r = run({
            args: ["--claude-args", "x", "--max-consecutive-errors", "1"],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=claude-error/);
        expect(r.stdout).not.toMatch(/reason=rate-limit/);
        const lines = logLines();
        expect(lines).toHaveLength(1);
        expect(lines[0].split(" ").pop()).toBe("claude-error");
        // the exit code field (3rd of 7) carries the real code, not a
        // stand-in — proves this isn't just rate-limit renamed.
        expect(lines[0].split(/\s+/)[2]).toBe("17");
    });

    it("still stops as rate-limit, not claude-error, when the message matches even on a non-zero exit", () => {
        stubGhCountingFrom(5);
        writeStub("claude", `echo "Claude AI usage limit reached."\nexit 17`);
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=rate-limit/);
        expect(r.stdout).not.toMatch(/reason=claude-error/);
    });

    it("never retries a rate-limit, however many crash retries are allowed", () => {
        // The retry budget belongs to crashes ONLY. A rate limit has no
        // reset time this driver can learn (ADR 0097), so sleeping on it is
        // guessing — it must stop on the first occurrence even with a
        // generous --max-consecutive-errors.
        stubGhCountingFrom(5);
        writeStub("claude", `echo "Claude AI usage limit reached."\nexit 17`);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--max-consecutive-errors",
                "9",
                "--error-backoff-secs",
                "0",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=rate-limit/);
        expect(logLines()).toHaveLength(1);
        expect(passLogCount()).toBe(1);
    });
});

describe("claude-error retry — a single crash must not end an overnight run", () => {
    it("retries the configured number of consecutive crashes, then stops with claude-error", () => {
        stubGhCountingFrom(5);
        writeStub("claude", `echo "some unrelated crash"\nexit 17`);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--max-consecutive-errors",
                "3",
                "--error-backoff-secs",
                "0",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=claude-error/);
        // 3 passes: crash → retry, crash → retry, crash → stop.
        expect(passLogCount()).toBe(3);
        const reasons = logLines().map((l) => l.split(/\s+/).pop());
        expect(reasons).toEqual([
            "claude-retry",
            "claude-retry",
            "claude-error",
        ]);
    });

    it("resets the crash streak on any pass that does not crash (bounded consecutively, not cumulatively)", () => {
        // Alternating crash/success under --max-consecutive-errors 2 must
        // NEVER reach the stop: two crashes happen, but never back-to-back.
        // Without the reset this run would die on the second crash.
        stubGhTwoCounters(5, 5);
        const flipFile = path.join(tmp, "flip");
        fs.writeFileSync(flipFile, "0");
        writeStub(
            "claude",
            [
                `n=$(cat "${flipFile}")`,
                `echo $((n + 1)) > "${flipFile}"`,
                // odd call = crash, even call = a pass that lands work
                `if [ $((n % 2)) -eq 0 ]; then echo "crash"; exit 17; fi`,
                `q=$(cat "${queueFile}"); echo $((q - 1)) > "${queueFile}"`,
                `t=$(cat "${totalFile}"); echo $((t - 1)) > "${totalFile}"`,
                `echo "landed one"`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--max-consecutive-errors",
                "2",
                "--error-backoff-secs",
                "0",
                "--max-passes",
                "6",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=max-passes/);
        const reasons = logLines().map((l) => l.split(/\s+/).pop());
        expect(reasons).not.toContain("claude-error");
        expect(reasons).toContain("claude-retry");
    });

    it("honours the stop-file DURING a backoff, not only between passes", () => {
        // A backoff that ignores the kill switch is a run the user cannot
        // stop. The stub crashes AND touches the stop-file, so the driver
        // enters the backoff and must abort out of it immediately.
        // 30s is deliberately short: `spawnSync` cannot be interrupted by
        // vitest's own testTimeout, so a regression here BLOCKS the worker
        // for the whole backoff before the elapsed-time assertion can fail
        // it. 30s fails loudly and quickly; a realistic 600s would wedge the
        // suite for ten minutes and read as a hang rather than a red test.
        stubGhCountingFrom(5);
        writeStub(
            "claude",
            [
                `touch "${path.join(tmp, ".claude", "telemetry", "loop-stop")}"`,
                `echo "crash"`,
                `exit 17`,
            ].join("\n")
        );
        const started = Date.now();
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--max-consecutive-errors",
                "5",
                "--error-backoff-secs",
                "30",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=stop-file/);
        expect(Date.now() - started).toBeLessThan(10_000);
    });

    it("rejects a non-numeric --max-consecutive-errors instead of silently coercing it to 0", () => {
        stubGhCountingFrom(5);
        const r = run({ args: ["--max-consecutive-errors", "3x"] });
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/--max-consecutive-errors must be/);
    });
});

describe("driver identity — pid file and single-instance", () => {
    const pidFile = () =>
        path.join(tmp, ".claude", "telemetry", "loop-drain.pid");

    it("refuses to start a second driver over the same queue under --single-instance", () => {
        stubGhCountingFrom(5);
        stubClaudeProgress();
        // vitest's own pid is, by construction, alive.
        fs.writeFileSync(pidFile(), String(process.pid));
        const r = run({ args: ["--claude-args", "x", "--single-instance"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=already-running/);
        expect(passLogCount()).toBe(0);
    });

    it("treats a STALE pid file as no lock at all (a killed driver must not wedge the loop forever)", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        // 2^31-1 is never a live pid on macOS/Linux (pid_max is far lower).
        fs.writeFileSync(pidFile(), "2147483647");
        const r = run({ args: ["--claude-args", "x", "--single-instance"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).not.toMatch(/reason=already-running/);
        expect(passLogCount()).toBe(1);
    });

    it("removes its own pid file on exit", () => {
        stubGhCountingFrom(0);
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.existsSync(pidFile())).toBe(false);
    });

    it("exports TOLARIA_LOOP_DRAIN=1 into the pass so the pass's own handoff no-ops", () => {
        // Without this the pass would detach ANOTHER driver at its end, and
        // the fan-out would be exponential instead of sequential.
        const envFile = path.join(tmp, "seen-env");
        stubGhCountingFrom(1);
        writeStub(
            "claude",
            [
                `echo "TOLARIA_LOOP_DRAIN=[$TOLARIA_LOOP_DRAIN]" > "${envFile}"`,
                `q=$(cat "${queueFile}"); echo $((q - 1)) > "${queueFile}"`,
                `exit 0`,
            ].join("\n")
        );
        run({ args: ["--claude-args", "x"] });
        expect(fs.readFileSync(envFile, "utf8").trim()).toBe(
            "TOLARIA_LOOP_DRAIN=[1]"
        );
    });

    it("exports TOLARIA_LOOP_RUN_ID into the pass — the whole budget rests on it (#3699)", () => {
        // The load-bearing assumption of the run-scoped budget: the pass's
        // SessionStart hook reads this variable and records it beside the
        // session id, and `usage:window --run` sums exactly those transcripts.
        // If it never arrives, every run's session set is empty, every reading
        // is zero, and the budget silently never trips — the failure is
        // indistinguishable from a healthy cheap run. Asserted the same way
        // TOLARIA_LOOP_DRAIN is, next to it.
        const envFile = path.join(tmp, "seen-run-id");
        stubGhCountingFrom(1);
        writeStub(
            "claude",
            [
                `echo "RUN=[$TOLARIA_LOOP_RUN_ID]" > "${envFile}"`,
                `q=$(cat "${queueFile}"); echo $((q - 1)) > "${queueFile}"`,
                `exit 0`,
            ].join("\n")
        );
        run({ args: ["--claude-args", "x"] });
        const seen = fs.readFileSync(envFile, "utf8").trim();
        expect(seen).toMatch(/^RUN=\[\d+-\d+\]$/);
    });
});

describe("background-wait ceiling — a pass runs to completion (#2622)", () => {
    /** `claude -p` kills any still-running background tasks
     * `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` (default 600000ms/600s) after
     * the main turn ends — a wall-clock guillotine on the pass's OWN
     * subagents, unrelated to this driver's budget/pct guards. `0` is the
     * verified sentinel for "no ceiling": the installed CLI's ceiling check
     * is `XS>0 && ...` (`XS` = this env var, `??`-defaulted to 600000), so
     * `0` makes it permanently false and the CLI's own stderr message says
     * exactly this ("Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait
     * indefinitely."). This asserts the env var the STUBBED `claude`
     * PROCESS actually sees — not a var read back in the test's own shell,
     * which would pass even if the driver never exported it. */
    it("exports CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 into the pass's own environment", () => {
        const envFile = path.join(tmp, "seen-ceiling-env");
        stubGhCountingFrom(1);
        writeStub(
            "claude",
            [
                `echo "CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=[$CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS]" > "${envFile}"`,
                `q=$(cat "${queueFile}"); echo $((q - 1)) > "${queueFile}"`,
                `exit 0`,
            ].join("\n")
        );
        run({ args: ["--claude-args", "x"] });
        expect(fs.readFileSync(envFile, "utf8").trim()).toBe(
            "CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=[0]"
        );
    });

    it("the --dry-run echo carries the same ceiling override as the real invocation", () => {
        // A dry-run line that omits what the real invocation sets is exactly
        // how this class of bug hides (#2622) — assert the two stay in sync.
        stubGhCountingFrom(5);
        const r = run({
            args: ["--claude-args", "x", "--max-passes", "1", "--dry-run"],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stderr).toMatch(
            // `claude --model <tier> -p` on the default path (#3083) — the
            // assertion is about the ceiling override, not the tier flag.
            /would run: CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude --model \S+ -p/
        );
    });
});

describe("no-progress", () => {
    it("stops after exactly 2 consecutive passes with neither queue nor green-sha moving", () => {
        stubGhCountingFrom(5);
        stubClaudeNoProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=no-progress/);
        expect(passLogCount()).toBe(2);
        expect(logLines()).toHaveLength(2);
    });

    it("resets the streak once progress resumes (proof the counter isn't just 'ever stalled once')", () => {
        // First call: no progress (queue file untouched). Second call
        // onward: progress. If the streak didn't reset on a progressing
        // pass, this would still stop at pass 2 with no-progress instead of
        // draining to queue-empty.
        stubGhCountingFrom(2);
        writeStub(
            "claude",
            [
                `STATE="${path.join(tmp, "call-count")}"`,
                `c=$(cat "$STATE" 2>/dev/null || echo 0)`,
                `c=$((c+1))`,
                `echo "$c" > "$STATE"`,
                `if [ "$c" -eq 1 ]; then`,
                `  echo "no progress this time"`,
                `  exit 0`,
                `fi`,
                `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `echo "$n" > "${queueFile}"`,
                `echo "sha-$n" > "${greenShaFile}"`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=queue-empty/);
    });
});
