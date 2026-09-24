import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    installLoopDrainHarness,
    REAL_BUN,
    tmp,
    writeStub,
    stubGhCountingFrom,
    stubClaudeProgress,
    stubClaudeRateLimitMessage,
    stubBunUsageWindow,
    writeBunUsageWindowStub,
    planBranch,
    run,
    logLines,
    passLogCount,
} from "./loop-drain-harness";

installLoopDrainHarness();

describe("stop-file — the user's kill switch", () => {
    it("stops before running any pass when the stop-file exists", () => {
        stubGhCountingFrom(5);
        fs.writeFileSync(
            path.join(tmp, ".claude", "telemetry", "loop-stop"),
            ""
        );
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=stop-file/);
        expect(passLogCount()).toBe(0);
        expect(logLines()).toHaveLength(0);
    });

    it("honours a custom --stop-file path", () => {
        stubGhCountingFrom(5);
        const custom = path.join(tmp, "custom-stop");
        fs.writeFileSync(custom, "");
        const r = run({ args: ["--claude-args", "x", "--stop-file", custom] });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/reason=stop-file/);
    });
});

describe("queue-empty", () => {
    it("stops immediately when nothing is unclaimed", () => {
        stubGhCountingFrom(0);
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=queue-empty/);
        expect(passLogCount()).toBe(0);
    });
});

describe("the budget is THIS RUN's spend, not a window over the machine (#3699)", () => {
    /** `bun` stub that RECORDS the argv `usage:window` was called with and
     *  answers from a per-call script. `budgetCalls` is the file the test
     *  reads back — a stub that only answered would leave "did the driver
     *  actually stop asking for a trailing window" unprovable. */
    const stubBunUsageRecording = (body: string): void => {
        writeStub(
            "bun",
            [
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                planBranch(),
                `if [ "$1" = "run" ] && [ "$2" = "usage:window" ]; then`,
                `  echo "$*" >> "${path.join(tmp, "usage-argv")}"`,
                body,
                `fi`,
                `if [ "$1" = "-e" ] && [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
    };

    const usageArgv = (): string[] => {
        const f = path.join(tmp, "usage-argv");
        if (!fs.existsSync(f)) return [];
        return fs
            .readFileSync(f, "utf8")
            .split("\n")
            .filter((l) => l.trim() !== "");
    };

    /** A reading shaped like the reporter's JSON. */
    const usageJson = (weighted: number, budget: number): string =>
        `{"sinceIso":"x","sinceMs":0,"hours":null,"runId":"r","sessions":1,` +
        `"models":{},"totals":{"input":0,"output":0,"cacheCreation":0,"cacheRead":0},` +
        `"weighted":${weighted},"budget":${budget},"pct":${(weighted * 100) / budget}}`;

    it("asks the reporter for the RUN, from its launch — never for a trailing window", () => {
        // The bug in one assertion. `--hours` reads every transcript on the
        // machine over the last five hours: it refused to start on the
        // operator's own interactive spend (observed: 132% of a 140M budget
        // with the driver having spent nothing) and it can never stop a run at
        // a cumulative total, because a window forgets.
        stubGhCountingFrom(1);
        stubClaudeProgress();
        stubBunUsageRecording(`  echo '${usageJson(0, 10000)}'\n  exit 0`);
        const r = run({
            args: ["--claude-args", "x", "--budget", "10000"],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        const argv = usageArgv();
        expect(argv.length).toBeGreaterThan(0);
        for (const line of argv) {
            expect(line).toMatch(/--since \d+/);
            expect(line).toMatch(/--run \S+/);
            expect(line).not.toMatch(/--hours/);
        }
    });

    it("starts and runs its first pass however much unrelated spend precedes it", () => {
        // AC: "A driver launched immediately after heavy unrelated local spend
        // starts and runs its first pass." The stub answers 0 for the run's
        // own reading — which is what a run that has launched no pass yet has
        // spent — regardless of how hot the machine is.
        stubGhCountingFrom(1);
        stubClaudeProgress();
        stubBunUsageRecording(`  echo '${usageJson(0, 140000000)}'\n  exit 0`);
        const r = run({
            args: ["--claude-args", "x", "--budget", "140000000"],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=queue-empty/);
        expect(passLogCount()).toBe(1);
    });

    it("reports a MONOTONIC figure — a reading that dips does not lower the run's spend", () => {
        // One recorded run went 22.11% → 12.91% across seven passes, which is
        // not a budget at all. The reader is monotonic by construction now
        // (fixed left edge, growing set of the run's own transcripts), and the
        // driver's high-water mark says so out loud: a compacted transcript or
        // a journal row that has not landed yet must not hand spend back.
        stubGhCountingFrom(9);
        stubClaudeProgress();
        stubBunUsageRecording(
            [
                `  STATE="${path.join(tmp, "usage-calls")}"`,
                `  c=$(cat "$STATE" 2>/dev/null || echo 0)`,
                `  c=$((c+1))`,
                `  echo "$c" > "$STATE"`,
                `  if [ "$c" -eq 1 ]; then echo '${usageJson(5000, 10000)}'; exit 0; fi`,
                `  echo '${usageJson(100, 10000)}'`,
                `  exit 0`,
            ].join("\n")
        );
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--budget",
                "10000",
                "--max-passes",
                "2",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        // Field 7 (0-indexed 6) is the cumulative spend.
        const spends = logLines().map((l) => Number(l.split(/\s+/)[6]));
        expect(spends.length).toBe(2);
        expect(spends[0]).toBe(5000);
        expect(spends[1]).toBe(5000);
    });

    it("stops with reason=budget, and the summary names the spend and the budget", () => {
        stubGhCountingFrom(9);
        stubClaudeProgress();
        stubBunUsageRecording(`  echo '${usageJson(10000, 10000)}'\n  exit 0`);
        const r = run({
            args: ["--claude-args", "x", "--budget", "10000"],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=budget/);
        expect(r.stdout).toMatch(/spent=10000 budget=10000/);
    });

    it("defaults --max-pct to 100 and states the effective ceiling in tokens at launch", () => {
        // A declared budget and a spendable budget must never be different
        // numbers in silence. The old default of 80 made `--budget N` mean
        // 0.8N with nothing in the output saying so.
        stubGhCountingFrom(1);
        stubClaudeProgress();
        stubBunUsageRecording(`  echo '${usageJson(8500, 10000)}'\n  exit 0`);
        const r = run({
            args: ["--claude-args", "x", "--budget", "10000"],
        });
        // 85% would have tripped the old 80 default; under 100 it runs.
        expect(r.stdout).not.toMatch(/reason=budget/);
        expect(r.stderr).toMatch(/effective ceiling 10000 tokens/);
    });

    it("carries the spend and the budget on every pass line", () => {
        stubGhCountingFrom(2);
        stubClaudeProgress();
        stubBunUsageRecording(`  echo '${usageJson(1234, 10000)}'\n  exit 0`);
        run({ args: ["--claude-args", "x", "--budget", "10000"] });
        for (const line of logLines()) {
            const f = line.split(/\s+/);
            expect(f).toHaveLength(9);
            expect(f[6]).toBe("1234");
            expect(f[7]).toBe("10000");
        }
    });
});

describe("budget threshold", () => {
    it("stops before running a pass when pct >= --max-pct", () => {
        stubGhCountingFrom(5);
        stubBunUsageWindow(90, 9000);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--budget",
                "10000",
                "--max-pct",
                "80",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=budget/);
        expect(`${r.stdout}${r.stderr}`).toMatch(/90%/);
        expect(passLogCount()).toBe(0);
    });

    it("does NOT stop when pct is below --max-pct", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        stubBunUsageWindow(10, 100);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--budget",
                "10000",
                "--max-pct",
                "80",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=queue-empty/);
        expect(passLogCount()).toBe(1);
    });

    it("REFUSES a budget that is numerically zero however it is spelled (#3704 review)", () => {
        // The disable-guard used to be a list of literals — `"" | 0 | 0.0 |
        // -*` — so `0.00`, `.0` and `00` read as REAL budgets. A zero budget
        // can never trip a percentage, so the driver ran unthrottled forever
        // instead of refusing to start: the precise failure ADR 0109 exists
        // to prevent, reached by a typo.
        for (const b of ["0.00", "00", "0e0"]) {
            stubGhCountingFrom(0);
            const r = run({
                args: ["--claude-args", "x", "--budget", b],
                env: { TOLARIA_LOOP_ALLOW_NO_BUDGET: "" },
            });
            expect(r.status, `expected refusal for --budget ${b}`).toBe(1);
            expect(r.stderr).toMatch(/refuses to run unbudgeted/);
            expect(passLogCount()).toBe(0);
        }
        // `.0` is refused one step earlier, by the numeric validation, with
        // its own exit code — also a refusal, and the message names the real
        // problem ("a plain number"), so it is not folded into the branch
        // above.
        stubGhCountingFrom(0);
        const leading = run({
            args: ["--claude-args", "x", "--budget", ".0"],
            env: { TOLARIA_LOOP_ALLOW_NO_BUDGET: "" },
        });
        expect(leading.status).toBe(2);
        expect(leading.stderr).toMatch(/--budget must be a plain number/);
    });

    it("REFUSES to run when no budget is configured (mandatory, ADR 0109)", () => {
        // The opt-in era ended 2026-08-27: every launcher after 2026-08-23
        // forgot the flag and the driver ran unthrottled for days.
        stubGhCountingFrom(0);
        const r = run({
            args: ["--claude-args", "x"],
            env: { TOLARIA_LOOP_ALLOW_NO_BUDGET: "" },
        });
        expect(r.status).toBe(1);
        expect(`${r.stderr}`).toMatch(/REQUIRED/);
        // Refused BEFORE doing anything: no pass log line, no pid file.
        expect(passLogCount()).toBe(0);
    });

    it("the test-only hatch says so out loud when it disables the guard", () => {
        stubGhCountingFrom(0);
        const r = run({ args: ["--claude-args", "x"] });
        expect(`${r.stderr}`).toMatch(/test-only hatch.*DISABLED/);
    });
});

describe("budget guard fails CLOSED when the usage reader is unreadable (BLOCKING fix)", () => {
    // Before this fix, every one of these four shapes hit the same `-z
    // "$pct"` branch, printed a warning, and ran the pass anyway — forever,
    // on every subsequent pass too, since nothing about the broken reader
    // self-heals. `bun` not being on PATH (the AFK/launchd case this driver
    // exists for) and a budget written with a suffix (`--budget 2M`) both
    // produced this exact shape in production.

    it("stops with reason usage-error when `bun run usage:window` exits non-zero", () => {
        stubGhCountingFrom(5);
        writeBunUsageWindowStub(`echo "usage-window: crashed" 1>&2\n  exit 1`);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--budget",
                "10000",
                "--max-pct",
                "80",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=usage-error/);
        expect(passLogCount()).toBe(0);
        expect(r.stderr).toMatch(/FAILED CLOSED/);
        expect(r.stderr).toMatch(/usage-window: crashed/);
    });

    it("stops with reason usage-error on non-JSON reader output", () => {
        stubGhCountingFrom(5);
        writeBunUsageWindowStub(`echo "not json at all {{{"\n  exit 0`);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--budget",
                "10000",
                "--max-pct",
                "80",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=usage-error/);
        expect(passLogCount()).toBe(0);
    });

    it("stops with reason usage-error when pct is null", () => {
        stubGhCountingFrom(5);
        writeBunUsageWindowStub(`echo '{"pct":null,"weighted":123}'\n  exit 0`);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--budget",
                "10000",
                "--max-pct",
                "80",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=usage-error/);
        expect(passLogCount()).toBe(0);
    });

    it("stops with reason usage-error when pct is present but not a valid number", () => {
        stubGhCountingFrom(5);
        writeBunUsageWindowStub(
            `echo '{"pct":1.2.3,"weighted":123}'\n  exit 0`
        );
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--budget",
                "10000",
                "--max-pct",
                "80",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=usage-error/);
        expect(passLogCount()).toBe(0);
    });
});

describe("rate-limit detection", () => {
    it("stops after exactly one pass on a rate-limit-shaped message, even with exit 0", () => {
        stubGhCountingFrom(5);
        stubClaudeRateLimitMessage();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=rate-limit/);
        expect(passLogCount()).toBe(1);
        const lines = logLines();
        expect(lines).toHaveLength(1);
        expect(lines[0].split(" ").pop()).toBe("rate-limit");
        expect(r.stderr).toMatch(/usage limit reached/i);
    });

    it("does NOT rate-limit-stop a normal, non-matching, exit-0 pass", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).not.toMatch(/reason=rate-limit/);
    });
});
