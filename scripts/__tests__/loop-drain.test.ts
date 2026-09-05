import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Every test here forks a real `sh` process, which itself spawns `mktemp`,
// `tee`, `awk`, `grep`, and stub subprocesses per pass. The default 5s
// per-test ceiling is tuned for pure in-process assertions, not this — under
// shared-machine contention (several concurrent sessions, see CLAUDE.md §
// Quality gates) that's enough to false-time-out a test doing nothing wrong.
// Same reasoning as the bot suite's 60s allowance in vitest.config.ts.
vi.setConfig({ testTimeout: 15_000 });

/**
 * `scripts/loop-drain.sh` is the out-of-process AFK driver around
 * `claude -p "/process-gh-issues"` (ADR 0097). It is POSIX `sh`, run here
 * exactly the way `.claude/hooks/receipt-guard.sh` is driven in
 * `receipt.test.ts:567-` — a scratch cwd, a `bin/` directory prepended onto
 * PATH with stub `gh`/`claude`/`bun` executables, assertions on exit code,
 * stop reason, and the log line the script writes.
 *
 * Isolation is NOT automatic just because `bin` precedes the real PATH: a
 * test that forgets to stub a binary the driver calls falls through to the
 * REAL one still later on PATH — confirmed empirically (a prior version of
 * this suite invoked the real `claude` binary twice under the budget
 * mutation, because none of the budget-adjacent tests installed a `claude`
 * stub). `beforeEach` now installs a default `claude` stub that exits 99
 * precisely to close that gap: every test either overrides it with its own
 * stub, or gets the exit-99 stub, never the real `claude` CLI. (`gh` and
 * `bun` are not defaulted the same way — every test that reaches them
 * installs its own stub via `stubGhCountingFrom`/`stubGhTwoCounters` /
 * `stubBunUsageWindow`, and a test that doesn't reach them never calls out.)
 *
 * Every one of these guards exists to stop an unattended process from
 * burning money at 3am — a guard that silently doesn't fire is exactly the
 * failure shape the proof-of-failure discipline exists to catch (see the PR
 * description for what was broken and reverted for each of these).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DRIVER = path.join(REPO_ROOT, "scripts", "loop-drain.sh");

/**
 * The REAL `bun`, resolved once from the outer PATH. `beforeEach` installs a
 * default `bun` stub (see below) that forwards everything it does not itself
 * answer to this — without the forward, installing a default stub at all would
 * break the `claims-held` tests, which deliberately let `claims_held_check`
 * reach the real `bun -e`.
 */
const REAL_BUN = spawnSync("sh", ["-c", "command -v bun"], {
    encoding: "utf8",
}).stdout.trim();

let tmp: string;
let bin: string;
let queueFile: string;
let totalFile: string;
let greenShaFile: string;

const writeStub = (name: string, script: string): void => {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${script}\n`, {
        mode: 0o755,
    });
};

/** `gh` stub: prints whatever integer currently sits in `queueFile`,
 * regardless of arguments — the driver's OWN wiring to `gh issue list` is
 * not what these tests are about; what matters is that it uses gh's stdout
 * as the count. Under this stub, `count_unclaimed` and `count_total_open`
 * both read the same file, so tests that don't care about the
 * unclaimed-vs-total distinction see them move together. */
const stubGhCountingFrom = (initialCount: number): void => {
    fs.writeFileSync(queueFile, String(initialCount));
    writeStub("gh", `cat "${queueFile}" 2>/dev/null || echo 0`);
};

/** `gh` stub that distinguishes the driver's two searches: the unclaimed
 * count (`count_unclaimed`, search carries `-label:in-progress`) from the
 * total open `ready-for-agent` count (`count_total_open`, no such
 * negation). Lets a test simulate "claimed but not landed": the unclaimed
 * count drops (a claim) while the total stays put (nothing actually
 * landed). */
const stubGhTwoCounters = (
    unclaimedInitial: number,
    totalInitial: number
): void => {
    fs.writeFileSync(queueFile, String(unclaimedInitial));
    fs.writeFileSync(totalFile, String(totalInitial));
    writeStub(
        "gh",
        [
            `args="$*"`,
            `case "$args" in`,
            `  *"-label:in-progress"*) cat "${queueFile}" 2>/dev/null || echo 0 ;;`,
            `  *) cat "${totalFile}" 2>/dev/null || echo 0 ;;`,
            `esac`,
        ].join("\n")
    );
};

/** `gh` stub that succeeds for the first `succeedCalls` invocations (the
 * pre-pass `queue_before`/`total_before` reads) and fails every call after
 * that (the post-pass `queue_after`/`total_after` reads) — reproduces a
 * transient `gh` API error that happens to land AFTER a pass runs rather
 * than before it. Used to prove `queue_after` gets the same `-` placeholder
 * `claude_exit` already gets, so the 7-field log-line invariant survives a
 * post-pass `gh` failure the same way it survives a subshell that dies
 * before writing its exit code. */
const stubGhSucceedsPrePassFailsPostPass = (
    succeedCalls: number,
    value: number
): void => {
    const counterFile = path.join(tmp, "gh-call-count");
    fs.writeFileSync(counterFile, "0");
    writeStub(
        "gh",
        [
            `n=$(cat "${counterFile}" 2>/dev/null || echo 0)`,
            `n=$((n + 1))`,
            `echo "$n" > "${counterFile}"`,
            `if [ "$n" -le ${succeedCalls} ]; then`,
            `  echo ${value}`,
            `  exit 0`,
            `fi`,
            `echo "gh: transient API error" 1>&2`,
            `exit 1`,
        ].join("\n")
    );
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

/** `bun` stub for the "reader is unreadable" family of tests: runs `body`
 * for `bun run usage:window ...` and falls through to exit 1 for anything
 * else, mirroring `stubBunUsageWindow`'s argument gate. `body` is
 * responsible for its own exit code — that's the whole point, each test
 * chooses a different broken shape. */
const writeBunUsageWindowStub = (body: string): void => {
    writeStub(
        "bun",
        [
            `if [ "$1" = "run" ] && [ "$2" = "usage:window" ]; then`,
            body,
            `fi`,
            `exit 1`,
        ].join("\n")
    );
};

/** A one-issue `queue:plan` plan, JSON-encoded for a shell stub to echo. The
 *  driver's pre-flight (#3083) reads `batch[0].number` and `batch[0].model`
 *  off this and nothing else, so the other fields are present only because a
 *  real plan has them. */
const planJson = (number: number, model: string): string =>
    JSON.stringify({
        version: 1,
        lane: "engine",
        batch: [
            {
                number,
                title: `issue ${number}`,
                type: "feat",
                model,
                hitl: false,
                targetFiles: [],
                blastRadius: "declared",
                lane: "engine",
                reason: "admitted",
            },
        ],
        deferred: [],
        skipped: [],
        staleClaims: [],
    });

/** Body of the default `bun` stub: no-op the orphan-claim sweep, answer the
 * pre-flight's `queue:plan` with a one-issue plan, forward everything else to
 * the real `bun`.
 *
 * The `queue:plan` branch is not optional politeness: without it every test in
 * this file would fork the REAL planner — which calls out to `gh` — from a
 * scratch cwd. That is the same isolation hole the file docstring describes
 * for `claude`, and it is closed the same way, by default rather than per
 * test. `bun -e` (the pre-flight's JSON read, and `claims_held_check`) still
 * falls through to the real `bun`, which is what those need. */
const stubBunDefaultBody = (): string =>
    [
        `case "$*" in`,
        `  *loop-doctor.ts*) exit 0 ;;`,
        `esac`,
        // `bun run <script>` prints this banner on STDERR before the script's
        // own output. Reproducing it is load-bearing: the pre-flight's first
        // implementation captured `2>&1` and could not parse a single real
        // plan, while every stub here was silent on stderr and stayed green.
        `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
        `  echo "$ bun scripts/queue-plan.ts --cap \\"1\\"" >&2`,
        `  cat <<'PLANEOF'`,
        planJson(101, "sonnet"),
        `PLANEOF`,
        `  exit 0`,
        `fi`,
        `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
        `echo "unstubbed bun invocation in test: $*" >&2`,
        `exit 1`,
    ].join("\n");

/** `bun` stub whose `queue:plan` branch answers with a plan naming `number`
 *  on `model` — the pre-flight's only input. Everything else behaves as the
 *  default stub does. */
const stubBunPlanHead = (number: number, model: string): void => {
    writeStub(
        "bun",
        [
            `case "$*" in`,
            `  *loop-doctor.ts*) exit 0 ;;`,
            `esac`,
            `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
            `  echo "$ bun scripts/queue-plan.ts --cap \\"1\\"" >&2`,
            `  cat <<'PLANEOF'`,
            planJson(number, model),
            `PLANEOF`,
            `  exit 0`,
            `fi`,
            `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
            `exit 1`,
        ].join("\n")
    );
};

/** `bun` stub whose `loop-doctor.ts --release` branch runs `body` (which owns
 * its own exit code — that is the point, each test picks a different sweep
 * outcome). Everything else forwards to the real `bun`, as the default does. */
const stubBunReap = (body: string): void => {
    writeStub(
        "bun",
        [
            `case "$*" in`,
            `  *loop-doctor.ts*)`,
            body,
            `    ;;`,
            `esac`,
            `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
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
            // The budget guard is MANDATORY since ADR 0109 — an unbudgeted
            // driver refuses to start. This hatch exists FOR THIS SUITE:
            // most tests here are about pass mechanics, not the guard.
            // Budget-guard tests override it back to "".
            TOLARIA_LOOP_ALLOW_NO_BUDGET: "1",
            // Hermetic, and load-bearing for #2622: the driver's own fix puts
            // this var in the pass's environment, so every descendant of a
            // pass inherits it — including `bun run test` -> vitest -> this
            // spawned `sh`. Without the reset, the ceiling assertion below
            // reads the AMBIENT value and stays green with the fix deleted,
            // precisely when the suite runs inside an AFK pass.
            CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "",
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
    totalFile = path.join(tmp, "total-count");
    greenShaFile = path.join(tmp, ".claude", "telemetry", "green-sha");
    // Default `claude` stub — see the file docstring. Any test that actually
    // needs `claude` to run a pass installs its own stub, which overwrites
    // this one (writeStub always replaces the file).
    writeStub(
        "claude",
        `echo "unstubbed claude invocation in test" >&2\nexit 99`
    );
    // Default `bun` stub for the orphan-claim sweep (#2627). The driver now
    // runs `bun scripts/loop-doctor.ts --release` on EVERY pass, so without
    // this every test in the file would fork the real loop:doctor against a
    // scratch cwd and a counter-printing `gh` stub. Answering only that one
    // invocation and forwarding the rest keeps `claims_held_check`'s real
    // `bun -e` working exactly as it did.
    writeStub("bun", stubBunDefaultBody());
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

describe("progress is measured on the total open count, not the claim-adjusted unclaimed count", () => {
    it("reports claims-held, not no-progress, when a pass claims work and lands nothing (#2626)", () => {
        // Simulates a pass that claims work (adds `in-progress`, dropping
        // the UNCLAIMED count) but lands nothing (TOTAL open ready-for-agent
        // stays put, green-sha never moves) — the exact shape of a pass
        // forcibly terminated mid-batch (#2621): it exits 0, so from the
        // outside it is indistinguishable from a pass that genuinely found
        // nothing to do UNLESS the claim count itself is consulted.
        //
        // Historical note: BEFORE this behaviour existed, an earlier bug had
        // the no-progress check compare the UNCLAIMED count directly, which
        // dropped every pass here and read as "progress" — resetting the
        // streak forever, so a batch that claims-and-abandons could burn
        // through the whole queue without landing a single PR. That bug is
        // what `count_total_open` (deliberately distinct from
        // `count_unclaimed`) already guards against. This test now asserts
        // the CURRENT, more specific diagnosis (#2626): claiming without
        // landing is a `claims-held` FAULT, reported immediately — not a
        // generic `no-progress` streak that takes two passes to notice.
        stubGhTwoCounters(5, 5);
        writeStub(
            "claude",
            [
                `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `echo "$n" > "${queueFile}"`,
                `echo "claimed one issue, landed nothing"`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=claims-held/);
        expect(r.stdout).not.toMatch(/reason=no-progress/);
        // Immediate — a fault, not a 2-pass streak like ordinary no-progress.
        expect(passLogCount()).toBe(1);
    });

    it("DOES treat a real landing (total open count drops) as progress", () => {
        stubGhTwoCounters(3, 3);
        writeStub(
            "claude",
            [
                `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `echo "$n" > "${queueFile}"`,
                `t=$(cat "${totalFile}" 2>/dev/null || echo 0)`,
                `if [ "$t" -gt 0 ]; then t=$((t-1)); fi`,
                `echo "$t" > "${totalFile}"`,
                `echo "sha-$t" > "${greenShaFile}"`,
                `echo "landed a PR"`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=queue-empty/);
        expect(passLogCount()).toBe(3);
    });
});

describe("claims-held (#2626)", () => {
    it("consumes claimsHeld from lib/loop-status rather than re-implementing the comparison in shell", () => {
        // AC: "The predicate is imported from the verdict engine, not
        // re-implemented in shell or duplicated in TypeScript." A source
        // check rather than a behavioural one — the behavioural tests above
        // and below would pass just as well against a hand-rolled
        // `[ "$claims_after" -gt "$claims_before" ]` shell comparison, which
        // is exactly the drift this AC exists to prevent (this log and the
        // dashboard's `claims-held` alarm disagreeing about what happened).
        const source = fs.readFileSync(DRIVER, "utf8");
        expect(source).toMatch(/import\s*\{\s*claimsHeld\s*\}\s*from/);
        expect(source).toMatch(/lib\/loop-status/);
    });

    it("only counts claims taken during THIS pass's own window, not a prior pass's", () => {
        // Pass 1 is a real landing (total drops, green-sha moves) — ordinary
        // progress, no claim left outstanding from it. Pass 2 claims one
        // issue and lands nothing. If `claims_before`/`claims_after` were
        // measured cumulatively from the run's start (or from a stale
        // snapshot) rather than bracketing pass 2's own before/after, pass 1's
        // drop in `total` could pollute the comparison; bracketing per-pass
        // is what keeps a concurrent session's or an earlier pass's claims
        // from being attributed to a pass that didn't take them.
        stubGhTwoCounters(5, 5);
        writeStub(
            "claude",
            [
                `STATE="${path.join(tmp, "call-count")}"`,
                `c=$(cat "$STATE" 2>/dev/null || echo 0)`,
                `c=$((c+1))`,
                `echo "$c" > "$STATE"`,
                `if [ "$c" -eq 1 ]; then`,
                // Pass 1: a real landing.
                `  n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `  if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `  echo "$n" > "${queueFile}"`,
                `  t=$(cat "${totalFile}" 2>/dev/null || echo 0)`,
                `  if [ "$t" -gt 0 ]; then t=$((t-1)); fi`,
                `  echo "$t" > "${totalFile}"`,
                `  echo "sha-$t" > "${greenShaFile}"`,
                `  echo "landed a PR"`,
                `  exit 0`,
                `fi`,
                // Pass 2: claims one more, lands nothing.
                `n=$(cat "${queueFile}" 2>/dev/null || echo 0)`,
                `if [ "$n" -gt 0 ]; then n=$((n-1)); fi`,
                `echo "$n" > "${queueFile}"`,
                `echo "claimed one issue, landed nothing"`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=claims-held/);
        expect(passLogCount()).toBe(2);
        // pass 1's own log line must NOT itself read claims-held/no-progress
        // — it made real progress, so it carries the "-" placeholder.
        const lines = logLines();
        expect(lines[0].split(" ").pop()).toBe("-");
        expect(lines[1].split(" ").pop()).toBe("claims-held");
    });

    it("does NOT flag claims-held when claims already standing from before the window stay flat (review finding, #2626)", () => {
        // The companion test above ("only counts claims taken during THIS
        // pass's own window") starts every window at claims_before=0 — its
        // own pass 1 decrements the unclaimed and total counters in
        // lockstep, so `claims_before` is always 0 by the time pass 2 (the
        // one that matters) runs. That leaves the window's LOWER bound
        // itself unexercised: `claims_held_check "0" "$claims_after" 0`
        // (hardcoding the bound away) still passes the whole suite green.
        //
        // This test starts with 2 claims ALREADY standing from a prior,
        // unmodeled pass (unclaimed=3, total=5) and a `claude` stub that
        // changes nothing. The correct reading is `claims_before=2`,
        // `claims_after=2` — flat, not a rise — so this is ordinary
        // no-progress, never claims-held. Under the mutation above,
        // `claims_before` is forced to "0" regardless of the real value, so
        // `claimsHeld({claimsBefore: 0, claimsAfter: 2, merges: 0})` reads
        // true and this test goes red on pass 1 with `reason=claims-held`
        // instead of the correct `reason=no-progress` — exactly the
        // every-pass-reports-claims-held noise the AC forbids.
        stubGhTwoCounters(3, 5);
        stubClaudeNoProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=no-progress/);
        expect(r.stdout).not.toMatch(/reason=claims-held/);
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

    it("still has 7 fields when gh fails AFTER the pass (queue_after unreadable)", () => {
        // Reproduces the hole a re-review found: `queue_after=$(count_unclaimed
        // 2>/dev/null) || queue_after=""` had no default, unlike
        // `claude_exit`, which DOES get `is_uint "$claude_exit" || claude_exit=1`.
        // 2 pre-pass gh calls succeed (queue_before, total_before) so the
        // pass actually runs; every gh call after that fails, so
        // queue_after/total_after both come back unreadable.
        stubGhSucceedsPrePassFailsPostPass(2, 3);
        stubClaudeNoProgress();
        const r = run({ args: ["--claude-args", "x"] });
        const lines = logLines();
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            expect(line.split(/\s+/)).toHaveLength(7);
        }
        // field 6 (0-indexed 5) is queue_after — must be the `-` placeholder,
        // never empty, when gh couldn't be read post-pass.
        const fields = lines[0].split(/\s+/);
        expect(fields[5]).toBe("-");
        // The run's NEXT pre-pass gh call also fails (the stub never
        // recovers), so the driver stops with gh-error on pass 2 — confirms
        // this is a genuine post-pass-only failure, not a stub that never
        // worked at all.
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=gh-error/);
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

describe("pre-flight — WHICH issue, on WHICH tier (#3083)", () => {
    /** One pass with an argv-recording `claude`, then stop on max-passes.
     *  Returns the argv the driver handed to `claude`. */
    const argvForOnePass = (extraArgs: string[] = []): string[] => {
        const argvFile = path.join(tmp, "claude-argv");
        writeStub(
            "claude",
            [
                `{ echo "argc=$#"; for a in "$@"; do echo "arg=$a"; done; } > "${argvFile}"`,
                `echo "recorded"`,
                `exit 0`,
            ].join("\n")
        );
        const r = run({ args: ["--max-passes", "1", ...extraArgs] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=max-passes/);
        return fs.readFileSync(argvFile, "utf8").trim().split("\n");
    };

    it("drains a queue whose head is ESCALATED instead of stalling on it", () => {
        // The wall this exists to remove: /next-issue §1 stops the pass —
        // BEFORE claiming — when the issue's model:* label outranks the
        // session tier. Nothing gets claimed, so the same issue is at the head
        // next pass, and an unattended run dies on no-progress with the queue
        // untouched. 47 of 233 open ready-for-agent issues carry model:opus.
        stubGhCountingFrom(5);
        stubBunPlanHead(2707, "opus");
        expect(argvForOnePass()).toEqual([
            "argc=4",
            "arg=--model",
            "arg=opus",
            "arg=-p",
            "arg=/next-issue 2707",
        ]);
    });

    it("uses the DEFAULT tier for an unlabelled head, not a blanket escalation", () => {
        // The other half of the same guard: routing follows the label, so an
        // unlabelled issue must not be dragged up to the escalated tier just
        // because the previous one was.
        stubGhCountingFrom(5);
        stubBunPlanHead(3083, "sonnet");
        expect(argvForOnePass()).toEqual([
            "argc=4",
            "arg=--model",
            "arg=sonnet",
            "arg=-p",
            "arg=/next-issue 3083",
        ]);
    });

    it("the --dry-run echo names the resolved issue and tier", () => {
        // A dry run is how a human checks a night BEFORE committing to it; an
        // echo that hid which issue and which tier were resolved would make
        // the pre-flight unauditable.
        stubGhCountingFrom(5);
        stubBunPlanHead(2707, "opus");
        const r = run({ args: ["--max-passes", "1", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stderr).toMatch(/issue #2707 on tier opus/);
        expect(r.stderr).toMatch(
            /would run: CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude --model opus -p "\/next-issue 2707"/
        );
    });

    it("degrades LOUDLY to the bare prompt when the planner cannot answer, rather than ending the run", () => {
        // Non-fatal by construction, like the orphan-claim sweep: a planner
        // outage at 3am must not end a budgeted night. It must also never be
        // silent — the degraded pass carries back the stall risk this
        // pre-flight exists to remove.
        stubGhCountingFrom(5);
        writeStub(
            "bun",
            [
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
                `  echo "queue:plan: gh API error" >&2`,
                `  exit 1`,
                `fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
        const argv = argvForOnePass();
        expect(argv).toEqual(["argc=2", "arg=-p", "arg=/next-issue"]);
    });

    it("says so on stderr when it degrades, never silently", () => {
        stubGhCountingFrom(5);
        writeStub(
            "bun",
            [
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then exit 1; fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
        stubClaudeProgress();
        const r = run({ args: ["--max-passes", "1"] });
        expect(r.stderr).toMatch(/pre-flight FAILED/);
    });

    it("parses a plan even though `bun run` prints a banner on stderr (regression)", () => {
        // The bug a real dry run found and no unit test could: the pre-flight
        // captured `bun run queue:plan 2>&1`, so `bun run`'s own
        // `$ bun scripts/queue-plan.ts …` banner landed inside the captured
        // stdout and JSON.parse threw on every real plan. Against a 230-issue
        // queue it resolved NOTHING, silently degrading every pass. Only
        // stdout is the plan.
        stubGhCountingFrom(5);
        writeStub(
            "bun",
            [
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
                `  echo "$ bun scripts/queue-plan.ts --cap \\"1\\"" >&2`,
                `  echo "warning: something on stderr" >&2`,
                `  cat <<'PLANEOF'`,
                planJson(2288, "opus"),
                `PLANEOF`,
                `  exit 0`,
                `fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
        expect(argvForOnePass()).toEqual([
            "argc=4",
            "arg=--model",
            "arg=opus",
            "arg=-p",
            "arg=/next-issue 2288",
        ]);
    });

    it("resolves nothing when an empty batch is all the planner returns — a deferred issue's number is not a head", () => {
        // The reason the plan is read through `bun -e` and not a `grep -o` on
        // the JSON: `deferred` and `skipped` entries carry `number` fields
        // too, so a first-match scan hands the pass a DEFERRED issue exactly
        // when the batch is empty and it must hand it nothing.
        stubGhCountingFrom(5);
        writeStub(
            "bun",
            [
                `case "$*" in`,
                `  *loop-doctor.ts*) exit 0 ;;`,
                `esac`,
                `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
                `  echo '{"version":1,"batch":[],"deferred":[{"number":9999,"reason":"blocked","conflictsWith":null}],"skipped":[],"staleClaims":[]}'`,
                `  exit 0`,
                `fi`,
                `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
                `exit 1`,
            ].join("\n")
        );
        const argv = argvForOnePass();
        expect(argv).toEqual(["argc=2", "arg=-p", "arg=/next-issue"]);
        expect(argv.join(" ")).not.toContain("9999");
    });
});

describe("health RED — the green-main invariant (ADR 0110)", () => {
    const redMarker = (): string =>
        path.join(tmp, ".claude", "telemetry", "health", "RED");

    const writeRed = (): void => {
        fs.mkdirSync(path.dirname(redMarker()), { recursive: true });
        fs.writeFileSync(redMarker(), "main @ deadbeef red at test:app\n");
    };

    it("stops before running any pass when the marker exists", () => {
        // "A RED marker means fix-forward FIRST — never stack unrelated work
        // on a red tip" (ADR 0110). `land` only WARNS, which is the right
        // strength for a human who can read it; unattended there is nobody to.
        stubGhCountingFrom(5);
        stubClaudeProgress();
        writeRed();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.stdout).toMatch(/reason=health-red/);
        expect(passLogCount()).toBe(0);
    });

    it("exits non-zero — a red tip is a fault, not a clean finish", () => {
        // stop-file / max-passes / queue-empty / budget all exit 0; this must
        // not join them, or a wrapper that checks the exit code reads a night
        // aborted on a broken main as a night that finished its work.
        stubGhCountingFrom(5);
        writeRed();
        expect(run({ args: ["--claude-args", "x"] }).status).toBe(1);
    });

    it("names the marker's contents on stderr, so the morning log says what to fix", () => {
        stubGhCountingFrom(5);
        writeRed();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.stderr).toMatch(/main is RED/);
        expect(r.stderr).toMatch(/red at test:app/);
    });

    it("runs normally when the marker is absent (proof the check is the marker, not the directory)", () => {
        stubGhCountingFrom(1);
        stubClaudeProgress();
        fs.mkdirSync(path.dirname(redMarker()), { recursive: true });
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.stdout).not.toMatch(/reason=health-red/);
        expect(passLogCount()).toBe(1);
    });
});

describe("--prompt — the prompt each pass runs", () => {
    /** `claude` stub that RECORDS its own argv, one line per element, and
     * exits 0. This is what makes the quoting assertions real: a dry-run
     * echo only proves the driver can print the prompt, while the argv file
     * proves what the process actually received — the difference between
     * `claude -p "/process-gh-issues figli di 2405"` (one argument) and the
     * word-split `-p /process-gh-issues figli di 2405` (four), which would
     * silently drain the wrong queue all night. */
    const stubClaudeRecordingArgv = (): string => {
        const argvFile = path.join(tmp, "claude-argv");
        writeStub(
            "claude",
            [
                `{ echo "argc=$#"; for a in "$@"; do echo "arg=$a"; done; } > "${argvFile}"`,
                `echo "recorded"`,
                `exit 0`,
            ].join("\n")
        );
        return argvFile;
    };

    /** One pass with a real (argv-recording) `claude`, then stop on
     * max-passes. Returns the argv the driver handed to `claude`. */
    const argvForOnePass = (extraArgs: string[]): string[] => {
        stubGhCountingFrom(5);
        const argvFile = stubClaudeRecordingArgv();
        const r = run({
            args: ["--claude-args", "x", "--max-passes", "1", ...extraArgs],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=max-passes/);
        return fs.readFileSync(argvFile, "utf8").trim().split("\n");
    };

    it("defaults to /next-issue with the resolved issue appended and its tier injected (#3083)", () => {
        // The default path is the single-session pipeline (ADR 0110), and the
        // pass is HANDED its issue and its tier rather than re-deriving both
        // from inside the model's context. The default `bun` stub answers the
        // pre-flight with issue 101 on sonnet.
        expect(argvForOnePass([])).toEqual([
            "argc=5",
            "arg=--model",
            "arg=sonnet",
            "arg=-p",
            "arg=/next-issue 101",
            "arg=x",
        ]);
    });

    it("a --prompt override switches the pre-flight OFF — no issue appended, no --model injected", () => {
        // An operator who names the prompt owns the whole invocation: the
        // driver must not append an issue number to a scoped prompt, nor
        // second-guess the tier they launched with.
        expect(
            argvForOnePass(["--prompt", "/process-gh-issues figli di 2405"])
        ).toEqual([
            "argc=3",
            "arg=-p",
            "arg=/process-gh-issues figli di 2405",
            "arg=x",
        ]);
    });

    it("passes a multi-word prompt as ONE argument, never word-split", () => {
        expect(
            argvForOnePass(["--prompt", "/process-gh-issues figli di 2405"])
        ).toEqual([
            "argc=3",
            "arg=-p",
            "arg=/process-gh-issues figli di 2405",
            "arg=x",
        ]);
    });

    it("treats $(...) / backticks in the prompt as literal text, never as shell", () => {
        const prompt = "/process-gh-issues $(touch pwned) `touch pwned2` a=b";
        expect(argvForOnePass(["--prompt", prompt])).toEqual([
            "argc=3",
            "arg=-p",
            `arg=${prompt}`,
            "arg=x",
        ]);
        expect(fs.existsSync(path.join(tmp, "pwned"))).toBe(false);
        expect(fs.existsSync(path.join(tmp, "pwned2"))).toBe(false);
    });

    it("prints the prompt actually used in the --dry-run echo", () => {
        // The dry run is how a human checks a scoped run BEFORE committing a
        // night to it — echoing the hardcoded default there would be a lie.
        stubGhCountingFrom(5);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--max-passes",
                "1",
                "--dry-run",
                "--prompt",
                "/process-gh-issues figli di 2405",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stderr).toMatch(
            /would run: CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude -p "\/process-gh-issues figli di 2405" x/
        );
    });

    it('rejects an empty --prompt instead of running `claude -p ""` forever', () => {
        stubGhCountingFrom(5);
        const r = run({ args: ["--claude-args", "x", "--prompt", ""] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
        expect(r.stderr).toMatch(/--prompt must not be empty/);
        expect(passLogCount()).toBe(0);
    });
});

describe("bad arguments", () => {
    it("rejects an unknown flag", () => {
        const r = run({ args: ["--not-a-real-flag"] });
        expect(r.status).toBe(2);
    });

    it("rejects a non-numeric --max-passes instead of silently running unbounded", () => {
        // Before the fix, `[ "$MAX_PASSES" -gt 0 ] 2>/dev/null` swallowed
        // `test`'s error on a non-numeric value, the `if` read that as
        // "false", and the driver ran with NO pass ceiling at all — exit 0,
        // no error, just unbounded.
        stubGhCountingFrom(1000);
        stubClaudeProgress();
        const r = run({
            args: ["--claude-args", "x", "--max-passes", "abc"],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
        expect(r.stderr).toMatch(/--max-passes must be a non-negative integer/);
        expect(passLogCount()).toBe(0);
    });

    it("rejects a non-numeric --max-pct instead of silently comparing against 0", () => {
        // Before the fix, awk's `m+0` coerced "abc" to 0, so the guard
        // tripped on pass 0 with reason=budget and exit 0 — a typo silently
        // reported as a normal, successful stop.
        stubGhCountingFrom(5);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--budget",
                "10000",
                "--max-pct",
                "abc",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
        expect(r.stderr).toMatch(/--max-pct must be numeric/);
        expect(passLogCount()).toBe(0);
    });

    it("rejects a non-numeric --budget (suffix/separator shapes)", () => {
        stubGhCountingFrom(5);
        const r = run({ args: ["--claude-args", "x", "--budget", "2M"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
        expect(r.stderr).toMatch(/--budget must be a plain number/);
        expect(passLogCount()).toBe(0);
    });

    it("accepts a valid numeric --max-passes/--max-pct/--budget combination", () => {
        stubGhCountingFrom(1000);
        stubClaudeProgress();
        stubBunUsageWindow(10, 100);
        const r = run({
            args: [
                "--claude-args",
                "x",
                "--max-passes",
                "2",
                "--max-pct",
                "80",
                "--budget",
                "10000",
            ],
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=max-passes/);
    }, 15000);
});

/**
 * Orphan-claim reap (#2627).
 *
 * A pass that dies holding claims leaves `in-progress` on issues nothing will
 * ever release; every later pass skips them as somebody else's live work. The
 * skill has asked its pass to sweep "every pass, unconditionally, before
 * selection" since it was written — as PROSE in SKILL.md §1a, which an LLM
 * pass follows or does not. These tests pin the mechanical half: the DRIVER
 * runs the sweep, before it counts the queue, and never decides for itself
 * what is stale.
 */
describe("orphan-claim reap (#2627)", () => {
    it("delegates the verdict to loop-doctor instead of carrying a claim rule of its own", () => {
        // AC: "The existing claim classifier is the sole authority; no second
        // age threshold is added." A source check, deliberately — the
        // behavioural tests below would pass just as happily against a shell
        // re-implementation that greps `gh issue list` for old claims, which
        // is exactly the drift this AC forbids (and the shape already sitting
        // in queue-plan.ts's `staleClaimHours`, a second opinion this driver
        // must not reach for).
        const source = fs.readFileSync(DRIVER, "utf8");
        expect(source).toMatch(/loop-doctor\.ts/);
        expect(source).toMatch(/--release/);
        // The driver must not edit labels itself, nor own an hours
        // threshold. (`--remove-label` appears once in a COMMENT about the
        // handoff grace period, so the label assertion is on the invocation
        // shape, not the flag string.)
        expect(source).not.toMatch(/gh\s+issue\s+edit/);
        expect(source).not.toMatch(/STALE_CLAIM_HOURS|staleClaimHours/i);
    });

    it("sweeps BEFORE the queue is counted, so a reclaimed issue is work this pass can pick up", () => {
        // The 2026-08-19 shape end to end: the queue reads empty because the
        // only remaining candidates are claimed by a pass that died. Sweeping
        // after the count would let the driver quit with `queue-empty` on a
        // queue the sweep was about to refill — so the ordering IS the fix,
        // and this test is the only thing that pins it.
        stubGhCountingFrom(0);
        stubBunReap(
            [
                // Release exactly once: the "orphan" it reclaims returns to
                // the unclaimed queue.
                `    if [ ! -f "${path.join(tmp, "reaped")}" ]; then`,
                `      : > "${path.join(tmp, "reaped")}"`,
                `      echo 1 > "${queueFile}"`,
                `      echo "released  #1841 — no branch, no PR, untouched for 30h"`,
                `    fi`,
                `    exit 0`,
            ].join("\n")
        );
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/reason=queue-empty/);
        // One pass ran: without the sweep preceding the count, the driver
        // would have seen 0 and stopped before running any.
        expect(passLogCount()).toBe(1);
    });

    it("reports what the sweep reclaimed, so an operator can see it in the driver's own output", () => {
        // AC: "The release is recorded, so an operator can see what was
        // reclaimed and why." loop-doctor writes the durable record into the
        // claim journal; the driver's job is not to swallow it.
        stubGhCountingFrom(1);
        stubBunReap(
            [
                `    echo "released  #1841 — no branch, no PR, untouched for 30h"`,
                `    exit 0`,
            ].join("\n")
        );
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.stderr).toMatch(/orphan-claim sweep/);
        expect(r.stderr).toMatch(/released {2}#1841 — no branch, no PR/);
    });

    it("is a janitor, not a guard — a failing sweep is reported and the run continues", () => {
        // An unattended run must not die because `gh` rate-limited the
        // sweep. But it must not go quiet either: a janitor that stopped
        // running without saying so is how the prose version of this rule
        // failed in the first place.
        stubGhCountingFrom(1);
        stubBunReap(
            [`    echo "gh: API rate limit exceeded" >&2`, `    exit 1`].join(
                "\n"
            )
        );
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stderr).toMatch(/orphan-claim sweep FAILED/);
        expect(r.stderr).toMatch(/API rate limit exceeded/);
        expect(passLogCount()).toBe(1);
    });

    // ── --dry-run must reach no `gh issue edit` (round-2 review) ─────────
    //
    // The sweep runs at step 3b, ABOVE the `--dry-run` branch that only ECHOES
    // the pass — so before the guard, `loop:drain --dry-run` reclaimed claims
    // and wrote them to the GitHub board. The verdict behind those writes was
    // correct; the flag's contract ("lands nothing") was not.
    //
    // Deliberately end-to-end through the REAL loop-doctor rather than an argv
    // assertion on a stub: what the flag promises is that no `gh issue edit`
    // happens, and only running the thing that would issue it can show that.
    // `gh` here is a recorder, exactly as the reviewer's repro was.
    const stubRealSweepAgainstRecordingGh = (): string => {
        const editLog = path.join(tmp, "gh-issue-edit-calls");
        const claimedJson = path.join(tmp, "claimed.json");
        // 30h stale, so `classifyClaim` reads it as an orphan on the
        // no-branch/no-PR path (2h threshold) and `--release` would edit it.
        fs.writeFileSync(
            claimedJson,
            JSON.stringify([
                {
                    number: 9001,
                    title: "an orphaned claim",
                    updatedAt: new Date(
                        Date.now() - 30 * 60 * 60 * 1000
                    ).toISOString(),
                },
            ])
        );
        writeStub(
            "gh",
            [
                `args="$*"`,
                `case "$args" in`,
                // The one write in the whole subsystem. Recorded, never made.
                `  *"issue edit"*) echo "$args" >> "${editLog}" ; exit 0 ;;`,
                `  *"pr list"*) echo '[]' ; exit 0 ;;`,
                // loop-doctor's claimed-issue read (the driver's own counts
                // ask for `--json number` only).
                `  *"number,title,updatedAt"*) cat "${claimedJson}" ; exit 0 ;;`,
                `  *) cat "${queueFile}" 2>/dev/null || echo 0 ;;`,
                `esac`,
            ].join("\n")
        );
        // loop-doctor's branch scans: no local branch, no remote branch.
        writeStub("git", `exit 0`);
        // Forward everything to the real bun, so the sweep the driver invokes
        // is the real `scripts/loop-doctor.ts`.
        writeStub("bun", `exec "${REAL_BUN}" "$@"`);
        fs.writeFileSync(queueFile, "1");
        return editLog;
    };

    /** Hermetic ledger root: without this, an ambient CLAUDE_PROJECT_DIR (set
     *  in every Claude Code session, including the one running this suite)
     *  would point the real loop-doctor at the REPO's claims.jsonl and have it
     *  append a release row there. */
    const sweepEnv = () => ({ CLAUDE_PROJECT_DIR: tmp });

    it("--dry-run runs the sweep in report-only mode and makes NO board write", () => {
        const editLog = stubRealSweepAgainstRecordingGh();
        const r = run({
            args: ["--claude-args", "x", "--dry-run", "--max-passes", "1"],
            env: sweepEnv(),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        // THE assertion: not one `gh issue edit` was reached.
        expect(
            fs.existsSync(editLog)
                ? fs.readFileSync(editLog, "utf8")
                : "(no gh issue edit call)"
        ).toBe("(no gh issue edit call)");
        expect(r.stderr).not.toMatch(/^released {2}#9001/m);
        // The sweep still RAN and still reported the orphan it can see —
        // report-only, not skipped, so a dry run still shows the operator
        // what a real run would reclaim.
        expect(r.stderr).toMatch(/\[dry-run\] orphan-claim sweep/);
        expect(r.stderr).toMatch(/#9001/);
        expect(r.stderr).toMatch(/1 claimed, 1 orphaned/);
    });

    it("without --dry-run the same setup DOES edit the board (the paired half — proof the recorder works)", () => {
        const editLog = stubRealSweepAgainstRecordingGh();
        stubClaudeNoProgress();
        const r = run({
            args: ["--claude-args", "x", "--max-passes", "1"],
            env: sweepEnv(),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.existsSync(editLog)).toBe(true);
        expect(fs.readFileSync(editLog, "utf8")).toMatch(
            /issue edit 9001 --remove-label in-progress/
        );
    });

    it("sweeps on EVERY pass, not once per run", () => {
        // A pass can die holding claims at any point in an overnight run, so
        // a once-at-startup sweep would leave every later orphan standing
        // until morning — the exact latency #2627 is about.
        const counter = path.join(tmp, "reap-calls");
        stubGhCountingFrom(3);
        stubBunReap(
            [
                `    n=$(cat "${counter}" 2>/dev/null || echo 0)`,
                `    echo $((n + 1)) > "${counter}"`,
                `    exit 0`,
            ].join("\n")
        );
        stubClaudeProgress();
        const r = run({ args: ["--claude-args", "x", "--max-passes", "3"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(passLogCount()).toBe(3);
        expect(Number(fs.readFileSync(counter, "utf8").trim())).toBe(3);
    });
});
