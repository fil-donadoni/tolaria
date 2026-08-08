import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * `scripts/loop-drain.sh` is the out-of-process AFK driver around
 * `claude -p "/process-gh-issues"` (ADR 0097). It is POSIX `sh`, run here
 * exactly the way `.claude/hooks/receipt-guard.sh` is driven in
 * `receipt.test.ts:567-` — a scratch cwd, stub `gh`/`claude`/`bun` placed
 * first on PATH so no real API/network call ever happens, assertions on exit
 * code, stop reason, and the log line the script writes.
 *
 * Every one of these guards exists to stop an unattended process from
 * burning money at 3am — a guard that silently doesn't fire is exactly the
 * failure shape the proof-of-failure discipline exists to catch (see the PR
 * description for what was broken and reverted for each of these).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DRIVER = path.join(REPO_ROOT, "scripts", "loop-drain.sh");

let tmp: string;
let bin: string;
let queueFile: string;
let greenShaFile: string;

const writeStub = (name: string, script: string): void => {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${script}\n`, {
        mode: 0o755,
    });
};

/** `gh` stub: prints whatever integer currently sits in `queueFile`,
 * regardless of arguments — the driver's OWN wiring to `gh issue list` is
 * not what these tests are about; what matters is that it uses gh's stdout
 * as the count. */
const stubGhCountingFrom = (initialCount: number): void => {
    fs.writeFileSync(queueFile, String(initialCount));
    writeStub("gh", `cat "${queueFile}" 2>/dev/null || echo 0`);
};

/** `claude` stub in "progress" mode: decrements the queue file and bumps
 * green-sha on every call, simulating a batch that actually lands a PR. */
const stubClaudeProgress = (): void => {
    writeStub(
        "claude",
        [
            `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
            `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
            `echo "$n" > "${queueFile}"`,
            `echo "sha-$n" > "${greenShaFile}"`,
            `echo "processed one issue"`,
            `exit 0`,
        ].join("\n")
    );
};

/** `claude` stub in "no-progress" mode: touches nothing, exits 0. */
const stubClaudeNoProgress = (): void => {
    writeStub("claude", `echo "nothing happened this pass"\nexit 0`);
};

/** `claude` stub that prints a rate-limit-shaped message but still exits 0
 * — the message match must catch this on its own, without relying on the
 * exit-code fallback. */
const stubClaudeRateLimitMessage = (): void => {
    writeStub(
        "claude",
        `echo "Claude AI usage limit reached. Try again later."\nexit 0`
    );
};

/** `bun` stub: answers `bun run usage:window ...` with a fixed pct. Any
 * other invocation fails loudly (nothing else should call bun here). */
const stubBunUsageWindow = (pct: number, weighted = 1): void => {
    writeStub(
        "bun",
        [
            `if [ "$1" = "run" ] && [ "$2" = "usage:window" ]; then`,
            `  echo '{"sinceIso":"x","hours":5,"models":{},"totals":{"input":0,"output":0,"cacheCreation":0,"cacheRead":0},"weighted":${weighted},"budget":1,"pct":${pct}}'`,
            `  exit 0`,
            `fi`,
            `exit 1`,
        ].join("\n")
    );
};

interface RunOpts {
    args?: string[];
    env?: Record<string, string>;
}

const run = (opts: RunOpts = {}) =>
    spawnSync("sh", [DRIVER, ...(opts.args ?? [])], {
        cwd: tmp,
        encoding: "utf8",
        env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            // Hermetic: never let a real budget configured in the outer
            // shell leak into a test that isn't about the budget guard.
            TOLARIA_LOOP_TOKEN_BUDGET: "",
            ...opts.env,
        },
    });

const logLines = (): string[] => {
    const p = path.join(tmp, ".claude", "telemetry", "loop-drain.log");
    if (!fs.existsSync(p)) return [];
    return fs
        .readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0);
};

const passLogCount = (): number => {
    const dir = path.join(tmp, ".claude", "telemetry", "loop-drain");
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter((f) => f.startsWith("pass-")).length;
};

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-loop-drain-"));
    bin = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-loop-drain-bin-"));
    fs.mkdirSync(path.join(tmp, ".claude", "telemetry"), { recursive: true });
    queueFile = path.join(tmp, "queue-count");
    greenShaFile = path.join(tmp, ".claude", "telemetry", "green-sha");
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
});

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

    it("warns once and disables the guard when no budget is configured", () => {
        stubGhCountingFrom(0);
        const r = run({ args: ["--claude-args", "x"] });
        expect(`${r.stderr}`).toMatch(/budget guard is DISABLED/);
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

    it("also stops on a non-zero claude exit with no matching message (fail-safe fallback)", () => {
        stubGhCountingFrom(5);
        writeStub("claude", `echo "some unrelated crash"\nexit 17`);
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=rate-limit/);
    });

    it("does NOT rate-limit-stop a normal, non-matching, exit-0 pass", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).not.toMatch(/reason=rate-limit/);
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

describe("--max-passes", () => {
    it("stops after exactly N passes even when the queue never empties", () => {
        stubGhCountingFrom(1000);
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x", "--max-passes", "3"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=max-passes/);
        expect(passLogCount()).toBe(3);
        expect(logLines()).toHaveLength(3);
    });
});

describe("progress — draining the queue to zero", () => {
    it("runs several passes and stops on queue-empty once the stub drains it", () => {
        stubGhCountingFrom(3);
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=queue-empty/);
        expect(passLogCount()).toBe(3);
        expect(logLines()).toHaveLength(3);
    });
});

describe("one log line per pass", () => {
    it("each line has 7 whitespace-separated fields: epoch pass exit pct before after reason", () => {
        stubGhCountingFrom(2);
        stubClaudeProgress();
        run({ args: ["--claude-args", "x"] });
        const lines = logLines();
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            expect(line.split(/\s+/)).toHaveLength(7);
        }
    });
});

describe("--claude-args warning", () => {
    it("warns when --claude-args is omitted", () => {
        stubGhCountingFrom(0);
        const r = run({});
        expect(r.stderr).toMatch(/WARNING.*--claude-args is empty/s);
    });

    it("does NOT warn when --claude-args is provided", () => {
        stubGhCountingFrom(0);
        const r = run({
            args: ["--claude-args", "--dangerously-skip-permissions"],
        });
        expect(r.stderr).not.toMatch(/--claude-args is empty/);
    });
});

describe("bad arguments", () => {
    it("rejects an unknown flag", () => {
        const r = run({ args: ["--not-a-real-flag"] });
        expect(r.status).toBe(2);
    });
});
