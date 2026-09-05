import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

vi.setConfig({ testTimeout: 15_000 });

/**
 * `scripts/loop-handoff.sh` is the AFK entry point: it detaches
 * `scripts/loop-drain.sh` into its own session ONLY when a human asks
 * (`--start` / `--resume`), always with a token budget. `--from-pass` — the
 * end-of-pass autostart of ADR 0099 — is a dead switch since ADR 0109: a
 * pass never starts the driver.
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
            // Hermetic: budget is mandatory on --start (ADR 0109); a budget
            // configured in the outer shell must not leak into tests that
            // prove the refusal.
            TOLARIA_LOOP_TOKEN_BUDGET: "",
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

describe("a pass NEVER starts the driver (ADR 0109)", () => {
    it("--from-pass is a no-op on an unarmed checkout", () => {
        const r = run({ args: ["--from-pass", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/never starts the driver/);
        expect(r.stdout).not.toMatch(/would detach/);
    });

    it("--from-pass is a no-op EVEN WHEN armed, budgeted and unblocked", () => {
        // The incident this pins down: a weeks-old afk.conf plus ONE
        // interactive /process-gh-issues pass used to detach an unattended
        // multi-day drain nobody asked for. Armed, budgeted, no stop-file,
        // no live driver — and STILL nothing may be detached from a pass.
        run({ args: ["--arm", "--budget", "12345"] });
        const r = run({ args: ["--from-pass", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/never starts the driver/);
        expect(r.stdout).not.toMatch(/would detach/);
        expect(r.stdout).not.toMatch(/driver detached/);
    });

    it("--arm writes the permission mode in plain text and starts nothing", () => {
        const r = run({ args: ["--arm"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.readFileSync(CONF(), "utf8")).toMatch(
            /CLAUDE_ARGS=--dangerously-skip-permissions/
        );
        expect(fs.existsSync(PID())).toBe(false);
    });

    it("--disarm removes the stored --start defaults", () => {
        run({ args: ["--arm"] });
        const r = run({ args: ["--disarm"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.existsSync(CONF())).toBe(false);
    });

    it("carries the recorded knobs into the driver argv on --start", () => {
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
        const out = run({ args: ["--start", "--dry-run"] }).stdout;
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
        const r = run({ args: ["--start", "--dry-run", "--budget", "1"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.existsSync(path.join(tmp, "pwned"))).toBe(false);
    });
});

describe("budget is mandatory on --start (ADR 0109)", () => {
    it("bare --start refuses without a budget from flag, conf or env", () => {
        const r = run({ args: ["--start", "--dry-run"] });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/without a token budget/);
    });

    it("a conf-recorded budget satisfies --start", () => {
        run({ args: ["--arm", "--budget", "777"] });
        const r = run({ args: ["--start", "--dry-run"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/--budget 777/);
    });

    it("TOLARIA_LOOP_TOKEN_BUDGET in the environment satisfies --start", () => {
        // The detached driver inherits the env, so an env budget is a real
        // budget — refusing it would only teach people to pass --budget 1.
        const r = run({
            args: ["--start", "--dry-run"],
            env: { TOLARIA_LOOP_TOKEN_BUDGET: "888" },
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/would detach/);
    });
});

describe("blocked-start guards — every reason a driver must NOT be detached", () => {
    it("--start refuses inside a driven pass (TOLARIA_LOOP_DRAIN=1)", () => {
        // Without this the fan-out is exponential: a driven pass typing
        // --start would detach another driver alongside its own.
        const r = run({
            args: ["--start", "--dry-run", "--budget", "1"],
            env: { TOLARIA_LOOP_DRAIN: "1" },
        });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/TOLARIA_LOOP_DRAIN=1/);
        expect(r.stdout).not.toMatch(/would detach/);
    });

    it("--start refuses when a driver is already running over this checkout", () => {
        fs.writeFileSync(PID(), String(process.pid));
        const r = run({ args: ["--start", "--dry-run", "--budget", "1"] });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/already running/);
        expect(r.stdout).not.toMatch(/would detach/);
    });

    it("ignores a STALE pid file — a killed driver must not block every future run", () => {
        fs.writeFileSync(PID(), "2147483647");
        const r = run({ args: ["--start", "--dry-run", "--budget", "1"] });
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
        const r = run({ args: ["--start", "--dry-run", "--budget", "1"] });
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
        expect(
            run({ args: ["--start", "--dry-run", "--budget", "1"] }).status
        ).toBe(1);
        const r = run({ args: ["--resume", "--dry-run", "--budget", "1"] });
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
        const r = run({ args: ["--start", "--dry-run", "--budget", "1"] });
        expect(r.stderr).toMatch(/answers every permission prompt/);
    });

    it("rejects an unknown argument instead of ignoring it", () => {
        const r = run({ args: ["--budgett", "5"] });
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/unknown argument/);
    });
});

describe("--prompt — scoping an unattended run to part of the queue", () => {
    const SCOPED = "/process-gh-issues figli di 2405";

    /** What the handoff would hand the driver, as one string. The env
     * budget keeps these tests about --prompt, not about the mandatory
     * budget (which has its own describe above). */
    const driverArgv = (): string =>
        run({
            args: ["--start", "--dry-run"],
            env: { TOLARIA_LOOP_TOKEN_BUDGET: "1" },
        }).stdout;

    it("records an EMPTY prompt when --prompt is absent, and passes no --prompt to the driver (#3083)", () => {
        // An unscoped arming must state no opinion: `--prompt` is what turns
        // the driver's issue/tier pre-flight OFF, so a conf that echoed the
        // driver's own default would silently disable it for every run
        // started through this script.
        run({ args: ["--arm"] });
        expect(fs.readFileSync(CONF(), "utf8")).toMatch(/^PROMPT=$/m);
        expect(driverArgv()).not.toMatch(/--prompt/);
    });

    it('never announces `claude -p ""` on --start when the run is unscoped', () => {
        // This line is the last thing an operator reads before walking away.
        // With the conf's PROMPT now empty by default, an unbranched echo
        // announces a pass that does nothing forever — the opposite of what
        // the driver's pre-flight actually does.
        run({ args: ["--arm"] });
        const out = run({
            args: ["--start", "--dry-run"],
            env: { TOLARIA_LOOP_TOKEN_BUDGET: "1" },
        }).stdout;
        expect(out).not.toMatch(/claude -p ""/);
        expect(out).toMatch(/every pass will run: \/next-issue/);
    });

    it("round-trips a multi-word prompt through the conf into the driver argv", () => {
        run({ args: ["--arm", "--prompt", SCOPED] });
        expect(fs.readFileSync(CONF(), "utf8")).toContain(`PROMPT=${SCOPED}`);
        expect(driverArgv()).toContain(`--prompt ${SCOPED}`);
    });

    it("round-trips a value containing spaces, `=`, quotes and $(...) without executing or truncating it", () => {
        // conf_get cuts at the FIRST `=` precisely so a value may contain
        // more of them; and the file is parsed, never sourced, so a
        // command substitution in it is inert text. Both properties are
        // load-bearing for an unattended process that reads this file and
        // then runs `claude`.
        const nasty =
            '/process-gh-issues a=b "quoted" $(touch pwned) `touch pwned2`';
        const r = run({ args: ["--arm", "--prompt", nasty] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(fs.readFileSync(CONF(), "utf8")).toContain(`PROMPT=${nasty}`);
        expect(driverArgv()).toContain(`--prompt ${nasty}`);
        expect(fs.existsSync(path.join(tmp, "pwned"))).toBe(false);
        expect(fs.existsSync(path.join(tmp, "pwned2"))).toBe(false);
    });

    it("REJECTS a prompt containing a newline instead of writing a value that reads back truncated", () => {
        // The conf is line-based KEY=VALUE: a newline would be written as
        // two lines and read back as the first half only — the driver would
        // then run a mangled prompt for hours with nobody watching. The
        // pre-existing conf must survive the rejection untouched.
        run({ args: ["--arm", "--prompt", SCOPED] });
        const r = run({
            args: ["--arm", "--prompt", "/process-gh-issues\nrm -rf /"],
        });
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/--prompt must be a single line/);
        const conf = fs.readFileSync(CONF(), "utf8");
        expect(conf).toContain(`PROMPT=${SCOPED}`);
        expect(conf).not.toMatch(/rm -rf/);
    });

    it("--status says what the armed run is scoped to", () => {
        // An armed-but-scoped run that LOOKS unscoped is a trap for whoever
        // reads this the next morning.
        run({ args: ["--arm", "--prompt", SCOPED] });
        expect(run({ args: ["--status"] }).stdout).toMatch(
            /prompt:\s+\/process-gh-issues figli di 2405/
        );
    });

    it("--status on a conf carrying no PROMPT says unscoped, not a blank", () => {
        fs.writeFileSync(
            CONF(),
            "CLAUDE_ARGS=--dangerously-skip-permissions\n"
        );
        const out = run({ args: ["--status"] }).stdout;
        expect(out).toMatch(/prompt:\s+\(unscoped/);
        // …and --start leaves it unscoped all the way to the driver argv: no
        // --prompt at all, so the driver's pre-flight stays ON (#3083).
        expect(driverArgv()).not.toMatch(/--prompt/);
    });
});
