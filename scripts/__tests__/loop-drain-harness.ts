import { beforeEach, afterEach, vi } from "vitest";
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

/**
 * `scripts/loop-drain.sh` is the out-of-process AFK driver around
 * `claude -p "/next-issue"` (ADR 0097; the prompt was `/process-gh-issues`
 * until ADR 0110 retired the fan-out loop). It is POSIX `sh`, run here
 * exactly the way `.claude/hooks/receipt-guard.sh` was driven in
 * `receipt.test.ts` before issue #3131 retired that hook — a scratch cwd, a
 * `bin/` directory prepended onto
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

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DRIVER = path.join(REPO_ROOT, "scripts", "loop-drain.sh");

/**
 * The REAL `bun`, resolved once from the outer PATH. `beforeEach` installs a
 * default `bun` stub (see below) that forwards everything it does not itself
 * answer to this — without the forward, installing a default stub at all would
 * break the `claims-held` tests, which deliberately let `claims_held_check`
 * reach the real `bun -e`.
 */
export const REAL_BUN = spawnSync("sh", ["-c", "command -v bun"], {
    encoding: "utf8",
}).stdout.trim();

export let tmp: string;
export let bin: string;
export let queueFile: string;
export let totalFile: string;
export let greenShaFile: string;

export const writeStub = (name: string, script: string): void => {
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
export const stubGhCountingFrom = (initialCount: number): void => {
    fs.writeFileSync(queueFile, String(initialCount));
    writeStub("gh", `cat "${queueFile}" 2>/dev/null || echo 0`);
};

/** `gh` stub that distinguishes the driver's two searches: the unclaimed
 * count (`count_unclaimed`, search carries `-label:in-progress`) from the
 * total open `ready-for-agent` count (`count_total_open`, no such
 * negation). Lets a test simulate "claimed but not landed": the unclaimed
 * count drops (a claim) while the total stays put (nothing actually
 * landed). */
export const stubGhTwoCounters = (
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
export const stubGhSucceedsPrePassFailsPostPass = (
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
export const stubClaudeProgress = (): void => {
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
export const stubClaudeNoProgress = (): void => {
    writeStub("claude", `echo "nothing happened this pass"\nexit 0`);
};

/** `claude` stub that prints a rate-limit-shaped message but still exits 0
 * — the message match must catch this on its own, without relying on the
 * exit-code fallback. */
export const stubClaudeRateLimitMessage = (): void => {
    writeStub(
        "claude",
        `echo "Claude AI usage limit reached. Try again later."\nexit 0`
    );
};

/** `bun` stub: answers `bun run usage:window ...` with a fixed pct. Any
 * other invocation fails loudly (nothing else should call bun here). */
export const stubBunUsageWindow = (pct: number, weighted = 1): void => {
    writeStub(
        "bun",
        [
            planBranch(),
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
export const writeBunUsageWindowStub = (body: string): void => {
    writeStub(
        "bun",
        [
            planBranch(),
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
export const planJson = (number: number, model: string): string =>
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

/** Everything the pre-flight calls `bun` for, as one shell fragment.
 *
 *  EVERY stub needs it, not just the pre-flight's own tests: since #3088 a
 *  pre-flight that cannot resolve a head STOPS the run, so a `bun` stub that
 *  answers only `usage:window` or only `loop-doctor.ts` now ends the run
 *  before its own subject is ever reached.
 *
 *  It reproduces `bun run`'s `$ bun scripts/… ` banner on STDERR. That is
 *  load-bearing: the pre-flight's first implementation captured `2>&1` and
 *  could not parse a single real plan, while every stub here was silent on
 *  stderr and stayed green. */
export const planBranch = (number = 101, model = "sonnet"): string =>
    [
        `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
        `  echo "$ bun scripts/queue-plan.ts --cap \\"1\\"" >&2`,
        `  cat <<'PLANEOF'`,
        planJson(number, model),
        `PLANEOF`,
        `  exit 0`,
        `fi`,
        // The pre-flight reads the plan's JSON with `bun -e`; that must reach
        // the REAL bun even in stubs that otherwise answer one script and fail
        // everything else, or the read comes back empty and the run stops.
        `if [ "$1" = "-e" ] && [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
    ].join("\n");

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
export const stubBunDefaultBody = (): string =>
    [
        `case "$*" in`,
        `  *loop-doctor.ts*) exit 0 ;;`,
        `esac`,
        planBranch(101, "sonnet"),
        `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
        `echo "unstubbed bun invocation in test: $*" >&2`,
        `exit 1`,
    ].join("\n");

/** `bun` stub whose `queue:plan` branch answers with a plan naming `number`
 *  on `model` — the pre-flight's only input. Everything else behaves as the
 *  default stub does. */
export const stubBunPlanHead = (number: number, model: string): void => {
    writeStub(
        "bun",
        [
            `case "$*" in`,
            `  *loop-doctor.ts*) exit 0 ;;`,
            `esac`,
            planBranch(number, model),
            `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
            `exit 1`,
        ].join("\n")
    );
};

/** `bun` stub whose `loop-doctor.ts --release` branch runs `body` (which owns
 * its own exit code — that is the point, each test picks a different sweep
 * outcome). Everything else forwards to the real `bun`, as the default does. */
export const stubBunReap = (body: string): void => {
    writeStub(
        "bun",
        [
            planBranch(),
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

export interface RunOpts {
    args?: string[];
    env?: Record<string, string>;
}

export const run = (opts: RunOpts = {}) =>
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

export const logLines = (): string[] => {
    const p = path.join(tmp, ".claude", "telemetry", "loop-drain.log");
    if (!fs.existsSync(p)) return [];
    return fs
        .readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0);
};

export const passLogCount = (): number => {
    const dir = path.join(tmp, ".claude", "telemetry", "loop-drain");
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter((f) => f.startsWith("pass-")).length;
};

export const installLoopDrainHarness = (): void => {
    vi.setConfig({ testTimeout: 15_000 });
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-loop-drain-"));
        bin = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-loop-drain-bin-"));
        fs.mkdirSync(path.join(tmp, ".claude", "telemetry"), {
            recursive: true,
        });
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
};
