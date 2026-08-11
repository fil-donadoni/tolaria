import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

vi.setConfig({ testTimeout: 15_000 });

/**
 * `scripts/loop-handoff.sh` is the AFK entry point: it arms a checkout for
 * unattended draining and detaches `scripts/loop-drain.sh` into its own
 * session, either because a human asked (`--start`) or because a
 * `/process-gh-issues` pass just finished on an armed checkout
 * (`--from-pass`). See ADR 0099.
 *
 * Everything here runs the real `sh` script against a scratch cwd, exactly
 * as `loop-drain.test.ts` does. `--dry-run` is used wherever the assertion is
 * about the DECISION (start / don't start, and with which argv) rather than
 * about a live background process — a test suite that detaches real
 * long-lived processes leaks them onto the developer's machine.
 *
 * The guards here bound an unattended run that edits files, pushes branches
 * and merges PRs with nobody watching. Each one below was proven to fail
 * against a deliberately broken script before being committed (see the PR
 * description).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HANDOFF = path.join(REPO_ROOT, "scripts", "loop-handoff.sh");
const DRIVER = path.join(REPO_ROOT, "scripts", "loop-drain.sh");

let tmp: string;

const telemetry = (...parts: string[]): string =>
    path.join(tmp, ".claude", "telemetry", ...parts);

const CONF = () => telemetry("afk.conf");
const STOP = () => telemetry("loop-stop");
const PID = () => telemetry("loop-drain.pid");

interface RunOpts {
    args?: string[];
    env?: Record<string, string>;
}

const run = (opts: RunOpts = {}) =>
    spawnSync("sh", [HANDOFF, ...(opts.args ?? [])], {
        cwd: tmp,
        encoding: "utf8",
        env: {
            ...process.env,
            // Hermetic: this variable is the "am I already inside a driven
            // pass" marker, and a real AFK run in the outer shell would
            // otherwise silently switch every test to the no-op branch.
            TOLARIA_LOOP_DRAIN: "",
            ...opts.env,
        },
    });

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-loop-handoff-"));
    fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".claude", "telemetry"), { recursive: true });
    // The handoff builds a `sh scripts/loop-drain.sh …` argv relative to cwd;
    // copy the real driver in so --dry-run prints a command that would
    // actually resolve.
    fs.copyFileSync(DRIVER, path.join(tmp, "scripts", "loop-drain.sh"));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("arming — an unattended run is an explicit, durable, revocable act", () => {
    it("does not fire the end-of-pass handoff on an unarmed checkout", () => {
        // The reason arming exists at all: an ordinary interactive
        // `/process-gh-issues` must not silently fork an hours-long run that
        // auto-approves every permission prompt.
        const r = run({ args: ["--from-pass", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/not armed/);
        expect(r.stdout).not.toMatch(/would detach/);
    });

    it("fires the end-of-pass handoff once armed", () => {
        run({ args: ["--arm"] });
        const r = run({ args: ["--from-pass", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/would detach/);
        expect(r.stdout).toMatch(/scripts\/loop-drain\.sh/);
    });

    it("--arm writes the permission mode in plain text and starts nothing", () => {
        const r = run({ args: ["--arm"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.readFileSync(CONF(), "utf8")).toMatch(
            /CLAUDE_ARGS=--dangerously-skip-permissions/
        );
        expect(fs.existsSync(PID())).toBe(false);
    });

    it("--disarm removes the marker so the handoff stops firing", () => {
        run({ args: ["--arm"] });
        const r = run({ args: ["--disarm"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.existsSync(CONF())).toBe(false);
        expect(run({ args: ["--from-pass", "--dry-run"] }).stdout).toMatch(
            /not armed/
        );
    });

    it("carries the recorded knobs into the driver argv", () => {
        run({
            args: [
                "--arm",
                "--budget",
                "12345",
                "--max-pct",
                "70",
                "--max-passes",
                "9",
                "--max-consecutive-errors",
                "5",
                "--start-delay",
                "7",
            ],
        });
        const out = run({ args: ["--from-pass", "--dry-run"] }).stdout;
        expect(out).toMatch(/--budget 12345/);
        expect(out).toMatch(/--max-pct 70/);
        expect(out).toMatch(/--max-passes 9/);
        expect(out).toMatch(/--max-consecutive-errors 5/);
        expect(out).toMatch(/--start-delay 7/);
        // --single-instance is not optional: it is the whole reason two
        // concurrent passes cannot each detach their own driver.
        expect(out).toMatch(/--single-instance/);
    });

    it("parses the conf file instead of sourcing it (no shell injection from a file an unattended process reads)", () => {
        fs.writeFileSync(
            CONF(),
            "CLAUDE_ARGS=--dangerously-skip-permissions $(touch pwned)\n"
        );
        const r = run({ args: ["--from-pass", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.existsSync(path.join(tmp, "pwned"))).toBe(false);
    });
});

describe("blocked-start guards — every reason a driver must NOT be detached", () => {
    it("no-ops when the pass was itself started BY the driver", () => {
        // Without this the fan-out is exponential: every driven pass would
        // detach another driver at its end.
        run({ args: ["--arm"] });
        const r = run({
            args: ["--from-pass", "--dry-run"],
            env: { TOLARIA_LOOP_DRAIN: "1" },
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/TOLARIA_LOOP_DRAIN=1/);
        expect(r.stdout).not.toMatch(/would detach/);
    });

    it("no-ops when the stop-file exists (the kill switch outranks arming)", () => {
        run({ args: ["--arm"] });
        fs.writeFileSync(STOP(), "");
        const r = run({ args: ["--from-pass", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).not.toMatch(/would detach/);
    });

    it("no-ops when a driver is already running over this checkout", () => {
        run({ args: ["--arm"] });
        fs.writeFileSync(PID(), String(process.pid));
        const r = run({ args: ["--from-pass", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/already running/);
        expect(r.stdout).not.toMatch(/would detach/);
    });

    it("ignores a STALE pid file — a killed driver must not block every future run", () => {
        run({ args: ["--arm"] });
        fs.writeFileSync(PID(), "2147483647");
        const r = run({ args: ["--from-pass", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/would detach/);
    });

    it("a blocked --from-pass is a quiet exit 0, never a failed batch", () => {
        // --from-pass runs at the end of a pass that already merged PRs.
        // Failing there would mark a successful batch as failed.
        run({ args: ["--arm"] });
        fs.writeFileSync(STOP(), "");
        expect(run({ args: ["--from-pass", "--dry-run"] }).status).toBe(0);
    });

    it("a blocked --start is a LOUD exit 1 — a human typed it and must be told", () => {
        fs.writeFileSync(STOP(), "");
        const r = run({ args: ["--start", "--dry-run"] });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/stop-file/);
    });
});

describe("stop / resume / status", () => {
    it("--stop writes the stop-file", () => {
        const r = run({ args: ["--stop"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.existsSync(STOP())).toBe(true);
    });

    it("--resume clears the stop-file and starts, while --start refuses", () => {
        run({ args: ["--stop"] });
        expect(run({ args: ["--start", "--dry-run"] }).status).toBe(1);
        const r = run({ args: ["--resume", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.existsSync(STOP())).toBe(false);
        expect(r.stdout).toMatch(/would detach/);
    });

    it("--status reports armed / driver / stop-file without changing anything", () => {
        const r = run({ args: ["--status"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/armed:\s+no/);
        expect(r.stdout).toMatch(/driver:\s+not running/);
        expect(r.stdout).toMatch(/stop-file:\s+absent/);
        expect(fs.existsSync(CONF())).toBe(false);
    });

    it("warns loudly when the armed run auto-approves every permission prompt", () => {
        const r = run({ args: ["--start", "--dry-run"] });
        expect(r.stderr).toMatch(/answers every permission prompt/);
    });

    it("rejects an unknown argument instead of ignoring it", () => {
        const r = run({ args: ["--budgett", "5"] });
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/unknown argument/);
    });
});
