import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Every test here forks a real `sh`, which forks a real `bun run` against a
// scratch package.json, and several of them deliberately wait on a sleeping
// child. The default 5s per-test ceiling is tuned for pure in-process
// assertions — same allowance, and the same reason, as `loop-drain.test.ts`.
vi.setConfig({ testTimeout: 30_000 });

/**
 * `scripts/gate-run.sh` exists because the Bash tool caps one call at 600s and
 * PROMOTES the command to the background on expiry without the caller opting
 * in. A pre-PR gate queued behind the machine-wide gate mutex routinely
 * outlives that cap; under `claude -p` the promoted pass then ends its turn,
 * the process dies, and the gate is SIGTERMed with its verdict unread —
 * roughly 20 of ~75 recorded AFK pass logs end on that shape (issue #3698).
 *
 * The property these tests pin is the one the acceptance criterion names: a
 * gate longer than the cap COMPLETES, and its exit code is read by the same
 * pass, with no call ever blocking long enough to be promoted. That is three
 * separable facts — each call returns inside the ceiling, the detached run
 * outlives the call that started it, and re-running the identical command
 * re-attaches rather than starting a second gate — and each has its own test.
 *
 * Driven like `loop-drain.test.ts`: a scratch cwd holding its own
 * `package.json`, so `bun run <name>` inside the script resolves to a fixture
 * script and never to a real gate.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GATE_RUN = path.join(REPO_ROOT, "scripts", "gate-run.sh");
let tmp: string;
let runDir: string;

/**
 * The outer environment with every `TOLARIA_GATE_RUN_*` knob removed. This
 * file runs INSIDE gates, and gates are driven through `gate-run.sh`: a knob set
 * on the outer call (`TOLARIA_GATE_RUN_KEY=land-N` for a landing) would
 * otherwise reach every spawn here and silently change what a test measures —
 * which is how the keyless-default test went red inside `land` (PR #3707).
 * Every spawn builds on this, never on `process.env` directly.
 */
const hermeticEnv = (): NodeJS.ProcessEnv =>
    Object.fromEntries(
        Object.entries(process.env).filter(
            ([k]) => !k.startsWith("TOLARIA_GATE_RUN_")
        )
    );

const fixtureScript = (name: string, body: string): void => {
    fs.writeFileSync(path.join(tmp, `${name}.sh`), `#!/bin/sh\n${body}\n`, {
        mode: 0o755,
    });
};

/** A fixture line that blocks until the test creates `release` — ordering the
 *  test controls, never a `sleep N` raced against a loaded machine (issue
 *  #4961). It also returns once `tmp` is gone, so a red test leaves no
 *  immortal poller behind. */
const awaitRelease = (release: string): string =>
    `while [ ! -e "${release}" ] && [ -d "${tmp}" ]; do sleep 0.1; done`;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-run-"));
    runDir = path.join(tmp, "runs");
    fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({
            name: "gate-run-fixture",
            private: true,
            scripts: {
                fast: "sh ./fast.sh",
                fail: "sh ./fail.sh",
                slow: "sh ./slow.sh",
                // A script that deletes its own cwd as part of succeeding —
                // the reaper's cwd rule must spare it (issue #4940).
                land: "sh ./slow.sh",
            },
        })
    );
});

/** Every process group a run under `runDir` still holds. */
const liveRunPgids = (): number[] =>
    fs.existsSync(runDir)
        ? fs
              .readdirSync(runDir)
              .map((d) => path.join(runDir, d, "pid"))
              .filter((f) => fs.existsSync(f))
              .map((f) => Number(fs.readFileSync(f, "utf8").trim()))
              .filter((pid) => pid > 0)
        : [];

const groupAlive = (pgid: number): boolean => {
    try {
        process.kill(-pgid, 0);
        return true;
    } catch {
        return false;
    }
};

const pidAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

afterEach(() => {
    // The #4940 tests leave long sleepers behind on purpose; never leak them.
    for (const pgid of liveRunPgids())
        if (groupAlive(pgid)) process.kill(-pgid, "SIGKILL");
    fs.rmSync(tmp, { recursive: true, force: true });
});

interface RunOpts {
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
}

const run = (opts: RunOpts) =>
    spawnSync("sh", [GATE_RUN, ...opts.args], {
        cwd: opts.cwd ?? tmp,
        encoding: "utf8",
        env: {
            ...hermeticEnv(),
            TOLARIA_GATE_RUN_DIR: runDir,
            TOLARIA_GATE_RUN_POLL_SECS: "1",
            ...(opts.env ?? {}),
        },
    });

/** Block (out of process, so no fake timers are involved) until `file`
 *  exists, up to `secs`. Returns whether it appeared. */
const waitForFile = (file: string, secs = 25): boolean =>
    spawnSync(
        "sh",
        [
            "-c",
            'i=0; while [ "$i" -lt "$2" ]; do [ -e "$1" ] && exit 0; sleep 1; i=$((i+1)); done; exit 1',
            "sh",
            file,
            String(secs),
        ],
        { encoding: "utf8" }
    ).status === 0;

describe("gate-run — the gate's verdict reaches the caller", () => {
    it("returns the gate's own exit code and prints its output", () => {
        fixtureScript("fast", 'echo "MARKER-OK"\nexit 0');
        const r = run({ args: ["fast"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toContain("MARKER-OK");
        expect(r.stdout).toMatch(/exit=0/);
    });

    it("returns a FAILING gate's exit code, not a laundered zero", () => {
        // The whole family of bugs this script sits in the middle of is
        // "the exit code was thrown away" — piped into a pager (§3 of
        // deny-guard), backgrounded (§3b), or killed with the turn (#3698).
        // A wrapper that swallowed a red gate would be the same bug wearing
        // the fix's clothes.
        fixtureScript("fail", 'echo "MARKER-RED"\nexit 7');
        const r = run({ args: ["fail"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(7);
        expect(r.stdout).toContain("MARKER-RED");
        expect(r.stdout).toMatch(/exit=7/);
    });
});

describe("gate-run — no single call can be promoted past the tool cap", () => {
    it("defaults its wait ceiling to well under the Bash tool's 600s cap", () => {
        // A source assertion, deliberately: the behavioural tests below set
        // their own tiny ceiling, so every one of them stays green with the
        // default raised to 3600 — which would reintroduce the exact
        // promotion this script exists to make impossible.
        const source = fs.readFileSync(GATE_RUN, "utf8");
        const m = source.match(/TOLARIA_GATE_RUN_WAIT_SECS:-(\d+)/);
        expect(m, "gate-run.sh must declare a default wait ceiling").not.toBe(
            null
        );
        expect(Number(m![1])).toBeLessThan(600);
    });

    it("returns 75 — 'still running, ask again' — instead of blocking past the ceiling", () => {
        fixtureScript("slow", "sleep 20\nexit 0");
        const r = run({
            args: ["slow"],
            env: { TOLARIA_GATE_RUN_WAIT_SECS: "2" },
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(75);
        expect(r.stdout).toMatch(/STILL RUNNING/);
        expect(r.stdout).toMatch(/re-run the IDENTICAL command/);
    });

    it("re-attaches on the next call instead of starting a SECOND gate", () => {
        // Starting a fresh gate per call would be worse than the bug: each
        // one re-queues behind the machine-wide mutex, so a gate driven this
        // way would never finish at all. The fixture counts its own starts.
        const starts = path.join(tmp, "starts");
        fixtureScript("slow", `echo x >>"${starts}"\nsleep 20\nexit 0`);
        const first = run({
            args: ["slow"],
            env: { TOLARIA_GATE_RUN_WAIT_SECS: "2" },
        });
        const second = run({
            args: ["slow"],
            env: { TOLARIA_GATE_RUN_WAIT_SECS: "2" },
        });
        expect(first.status, `${first.stdout}${first.stderr}`).toBe(75);
        expect(second.status, `${second.stdout}${second.stderr}`).toBe(75);
        expect(second.stderr).toMatch(/re-attached/);
        expect(fs.readFileSync(starts, "utf8").trim().split("\n")).toHaveLength(
            1
        );
    });
});

describe("gate-run — the run outlives the call that started it (#3698 AC1)", () => {
    it("a gate longer than the ceiling completes, and a later call reads its exit code", () => {
        // The acceptance criterion in one test. `TOLARIA_GATE_RUN_WAIT_SECS=0`
        // stands in for the Bash tool's 600s cap: the first call returns 75
        // and its PROCESS EXITS while the gate is still running — exactly the
        // moment at which a pass used to lose the gate. The gate must still
        // reach its end, and the next foreground call must hand back its real
        // exit code.
        const done = path.join(tmp, "done");
        const release = path.join(tmp, "release");
        fixtureScript(
            "slow",
            `${awaitRelease(release)}\necho "MARKER-LATE"\ntouch "${done}"\nexit 3`
        );

        const first = run({
            args: ["slow"],
            env: { TOLARIA_GATE_RUN_WAIT_SECS: "0" },
        });
        expect(first.status, `${first.stdout}${first.stderr}`).toBe(75);
        expect(fs.existsSync(done)).toBe(false);

        fs.writeFileSync(release, "");
        expect(waitForFile(done), "the detached gate never finished").toBe(
            true
        );

        const second = run({
            args: ["slow"],
            env: { TOLARIA_GATE_RUN_WAIT_SECS: "20" },
        });
        expect(second.status, `${second.stdout}${second.stderr}`).toBe(3);
        expect(second.stdout).toContain("MARKER-LATE");
        // And it is the FINISHED run that answered, not a second gate started
        // from scratch: discarding a completed verdict because nobody happened
        // to be waiting for it is issue #3698's own "the verdict was thrown
        // away", one step later.
        expect(second.stderr).toMatch(/already finished/);
    });

    it("survives a group-directed kill of the caller (#3698, the `set -m` claim)", async () => {
        // The load-bearing property, proven rather than argued. `detached:
        // true` makes the spawned `sh` its own process-group leader, so
        // `kill(-pid)` is the same signal a dying pass's group takes — which
        // is what used to SIGTERM the gate mid-run. `set -m` inside the script
        // puts the GATE in a third group, and that is what this asserts.
        const done = path.join(tmp, "done");
        const started = path.join(tmp, "started");
        const release = path.join(tmp, "release");
        fixtureScript(
            "slow",
            `touch "${started}"\n${awaitRelease(release)}\ntouch "${done}"\nexit 4`
        );

        const child = spawn("sh", [GATE_RUN, "slow"], {
            cwd: tmp,
            detached: true,
            stdio: "ignore",
            env: {
                ...hermeticEnv(),
                TOLARIA_GATE_RUN_DIR: runDir,
                TOLARIA_GATE_RUN_POLL_SECS: "1",
                TOLARIA_GATE_RUN_WAIT_SECS: "60",
            },
        });
        // Once the gate is running, kill the caller's whole group.
        expect(waitForFile(started), "the gate never started").toBe(true);
        process.kill(-child.pid!, "SIGTERM");
        await new Promise((r) => setTimeout(r, 500));
        expect(
            fs.existsSync(done),
            "the gate finished too early to prove anything"
        ).toBe(false);
        fs.writeFileSync(release, "");

        expect(
            waitForFile(done),
            "the gate died with the caller's process group"
        ).toBe(true);
        // …and its exit code is still there to be read by whoever comes next.
        const after = run({
            args: ["slow"],
            env: { TOLARIA_GATE_RUN_WAIT_SECS: "20" },
        });
        expect(after.status, `${after.stdout}${after.stderr}`).toBe(4);
    });
});

describe("gate-run — a pid is not an identity (#3698)", () => {
    it("does not re-attach to a RECYCLED pid that is somebody else's process", async () => {
        // Reproduced in review: with `rc` absent and a foreign LIVE pid in the
        // run dir, every later call re-attached, waited the ceiling, exited 75
        // — forever, without ever starting the gate, and printing the previous
        // run's log as the diagnostic. Run dirs outlive processes and macOS
        // recycles pids within hours, so "the pid is alive" is not "the pid is
        // ours"; the process's own start stamp is what makes it an identity.
        const starts = path.join(tmp, "starts");
        fixtureScript("slow", `echo x >>"${starts}"\nsleep 20\nexit 0`);

        // A live process that is NOT our gate, recorded as if it were.
        const foreign = spawn("sleep", ["30"], {
            detached: true,
            stdio: "ignore",
        });
        foreign.unref();
        // Provoke the run dir into existing, then poison it.
        const seed = run({
            args: ["slow"],
            env: { TOLARIA_GATE_RUN_WAIT_SECS: "0" },
        });
        expect(seed.status).toBe(75);
        const runSub = path.join(
            runDir,
            fs.readdirSync(runDir).find((d) => d.startsWith("slow-"))!
        );
        fs.writeFileSync(path.join(runSub, "pid"), `${foreign.pid}\n`);
        fs.rmSync(path.join(runSub, "rc"), { force: true });

        const next = run({
            args: ["slow"],
            env: { TOLARIA_GATE_RUN_WAIT_SECS: "0" },
        });
        expect(next.stderr).toMatch(/started/);
        expect(next.stderr).not.toMatch(/re-attached/);
        try {
            process.kill(foreign.pid!, "SIGKILL");
        } catch {
            /* already gone */
        }
    });
});

describe("gate-run — a run can be named instead of keyed on its cwd (#3706)", () => {
    it("re-attaches across DIFFERENT cwds when the run carries an explicit key", () => {
        // The case that forces this: `land` runs from the PR's own worktree —
        // it refuses to run from the base branch — and DELETES that worktree
        // when it merges. A `land` that returns 75 therefore leaves the next
        // call with a cwd that no longer exists, and a call from anywhere else
        // computes a different key and starts a SECOND `land`, re-paying the
        // whole gate. `/next-issue` shipped a `cd` to the primary checkout as
        // the fix; `land` refused it on the very next landing.
        const starts = path.join(tmp, "starts");
        fixtureScript("slow", `echo x >>"${starts}"\nsleep 20\nexit 0`);

        // A second directory with the SAME fixture package, standing in for
        // the primary checkout a pass falls back to once its worktree is gone.
        const other = fs.mkdtempSync(path.join(os.tmpdir(), "gate-run-other-"));
        for (const f of ["package.json", "slow.sh"]) {
            fs.copyFileSync(path.join(tmp, f), path.join(other, f));
        }
        fs.chmodSync(path.join(other, "slow.sh"), 0o755);

        const env = {
            TOLARIA_GATE_RUN_DIR: runDir,
            TOLARIA_GATE_RUN_POLL_SECS: "1",
            TOLARIA_GATE_RUN_WAIT_SECS: "2",
            TOLARIA_GATE_RUN_KEY: "land-3706",
        };
        const first = spawnSync("sh", [GATE_RUN, "slow"], {
            cwd: tmp,
            encoding: "utf8",
            env: { ...hermeticEnv(), ...env },
        });
        const second = spawnSync("sh", [GATE_RUN, "slow"], {
            cwd: other,
            encoding: "utf8",
            env: { ...hermeticEnv(), ...env },
        });

        expect(first.status, `${first.stdout}${first.stderr}`).toBe(75);
        expect(second.status, `${second.stdout}${second.stderr}`).toBe(75);
        expect(second.stderr).toMatch(/re-attached/);
        // The fixture counts its own starts: exactly one gate, from two
        // directories.
        expect(fs.readFileSync(starts, "utf8").trim().split("\n")).toHaveLength(
            1
        );
        fs.rmSync(other, { recursive: true, force: true });
    });

    it("hands a FINISHED named run's verdict to a caller in a checkout with a different HEAD", () => {
        // The case the key exists for, and the one the first version got
        // wrong (PR #3707 review): `land` finishes — possibly MERGED — while
        // nobody is waiting, its worktree is gone, and the follow-up call comes
        // from the primary checkout, on another branch. The finished-run check
        // compared the recorded HEAD against the CALLER's HEAD, failed, threw
        // the real exit code away and started a second `land`. Both
        // directories are real git repos with different commits here, because
        // two plain temp dirs both read an empty HEAD and pass by accident.
        const git = (cwd: string, ...args: string[]) =>
            spawnSync("git", args, { cwd, encoding: "utf8" });
        const initRepo = (dir: string, msg: string) => {
            git(dir, "init", "-q");
            git(
                dir,
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                msg
            );
        };
        const done = path.join(tmp, "done");
        const starts = path.join(tmp, "starts");
        fixtureScript(
            "slow",
            `echo x >>"${starts}"\nsleep 3\ntouch "${done}"\nexit 3`
        );
        const other = fs.mkdtempSync(path.join(os.tmpdir(), "gate-run-other-"));
        for (const f of ["package.json", "slow.sh"]) {
            fs.copyFileSync(path.join(tmp, f), path.join(other, f));
        }
        initRepo(tmp, "worktree");
        initRepo(other, "primary checkout");
        expect(git(tmp, "rev-parse", "HEAD").stdout).not.toBe(
            git(other, "rev-parse", "HEAD").stdout
        );

        const env = {
            ...hermeticEnv(),
            TOLARIA_GATE_RUN_DIR: runDir,
            TOLARIA_GATE_RUN_POLL_SECS: "1",
            TOLARIA_GATE_RUN_KEY: "land-3707",
        };
        const first = spawnSync("sh", [GATE_RUN, "slow"], {
            cwd: tmp,
            encoding: "utf8",
            env: { ...env, TOLARIA_GATE_RUN_WAIT_SECS: "0" },
        });
        expect(first.status, `${first.stdout}${first.stderr}`).toBe(75);
        expect(waitForFile(done), "the gate never finished").toBe(true);

        const second = spawnSync("sh", [GATE_RUN, "slow"], {
            cwd: other,
            encoding: "utf8",
            env: { ...env, TOLARIA_GATE_RUN_WAIT_SECS: "20" },
        });
        expect(second.status, `${second.stdout}${second.stderr}`).toBe(3);
        expect(second.stderr).toMatch(/already finished/);
        expect(fs.readFileSync(starts, "utf8").trim().split("\n")).toHaveLength(
            1
        );
        fs.rmSync(other, { recursive: true, force: true });
    });

    it("does not hand the run's key down to the gate it runs", () => {
        // A gate is a process tree, and some of its descendants drive
        // `gate-run.sh` themselves. A key left in the environment collapses
        // every one of their runs onto the parent's — observed: the keyless
        // test below went red inside `land`'s own gate (PR #3707).
        fixtureScript("fast", 'echo "KEY=[$TOLARIA_GATE_RUN_KEY]"\nexit 0');
        const r = spawnSync("sh", [GATE_RUN, "fast"], {
            cwd: tmp,
            encoding: "utf8",
            env: {
                ...hermeticEnv(),
                TOLARIA_GATE_RUN_DIR: runDir,
                TOLARIA_GATE_RUN_POLL_SECS: "1",
                TOLARIA_GATE_RUN_KEY: "land-3707",
            },
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toContain("KEY=[]");
    });

    it("still separates two worktrees that gate the same script with no key", () => {
        // A regression guard on the DEFAULT, not a test of the key: it passes
        // with the feature removed, and it is here so that adding the key can
        // never quietly turn "one run per cwd" into "one run per command": two
        // worktrees gating concurrently are two runs, and attaching one to the
        // other's log would report the wrong tree's verdict.
        const starts = path.join(tmp, "starts");
        fixtureScript("slow", `echo x >>"${starts}"\nsleep 20\nexit 0`);
        const other = fs.mkdtempSync(path.join(os.tmpdir(), "gate-run-other-"));
        for (const f of ["package.json", "slow.sh"]) {
            fs.copyFileSync(path.join(tmp, f), path.join(other, f));
        }
        fs.chmodSync(path.join(other, "slow.sh"), 0o755);

        const env = {
            TOLARIA_GATE_RUN_DIR: runDir,
            TOLARIA_GATE_RUN_POLL_SECS: "1",
            TOLARIA_GATE_RUN_WAIT_SECS: "2",
        };
        spawnSync("sh", [GATE_RUN, "slow"], {
            cwd: tmp,
            encoding: "utf8",
            env: { ...hermeticEnv(), ...env },
        });
        const second = spawnSync("sh", [GATE_RUN, "slow"], {
            cwd: other,
            encoding: "utf8",
            env: { ...hermeticEnv(), ...env },
        });
        expect(second.stderr).toMatch(/started/);
        expect(second.stderr).not.toMatch(/re-attached/);
        fs.rmSync(other, { recursive: true, force: true });
    });
});

describe("gate-run — a run records (head, base, command, green) for `land` (ADR 0136 §2)", () => {
    /**
     * `land` skips the lane on a rebased tip already gated green against the
     * same base (issue #3779). The record it reads is written here: `head` (the
     * HEAD the gate ran on), `base` (the `origin/<base>` sha at start, base
     * named by `tolaria.config.json`), `command`, and `green` — present only
     * after a zero exit, and gone the moment the next run of the same command
     * starts, so a red or half-written run can never read as green.
     */
    const git = (...args: string[]) =>
        spawnSync("git", args, { cwd: tmp, encoding: "utf8" });
    const sha = (ref: string) => git("rev-parse", ref).stdout.trim();
    const record = (name: string) => {
        const [dir] = fs
            .readdirSync(runDir)
            .filter((d) => d.startsWith("fast-") || d.startsWith("fail-"));
        const f = path.join(runDir, dir, name);
        return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : null;
    };

    beforeEach(() => {
        fs.writeFileSync(
            path.join(tmp, "tolaria.config.json"),
            JSON.stringify({ branches: { base: "trunk", release: "prod" } })
        );
        git("init", "-q");
        const commit = (msg: string) =>
            git(
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                msg
            );
        commit("base");
        git("update-ref", "refs/remotes/origin/trunk", "HEAD");
        commit("branch tip");
    });

    it("records HEAD, the origin/<base> sha named by the config, the command, and green on a zero exit", () => {
        fixtureScript("fast", "exit 0");
        const r = run({ args: ["fast"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(record("head")).toBe(sha("HEAD"));
        expect(record("base")).toBe(sha("origin/trunk"));
        expect(record("base")).not.toBe(record("head"));
        expect(record("command")).toBe("fast");
        expect(record("green")).toBe("");
    });

    it("leaves no green record for a red gate", () => {
        fixtureScript("fail", "exit 7");
        const r = run({ args: ["fail"] });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(7);
        expect(record("head")).toBe(sha("HEAD"));
        expect(record("green")).toBeNull();
    });

    it("keeps green after the verdict is read, and drops it when the next run starts", () => {
        const flag = path.join(tmp, "flag");
        fixtureScript("fast", `[ ! -e "${flag}" ]`);
        expect(run({ args: ["fast"] }).status).toBe(0);
        // The `rc` file is cleared on read; `green` must survive it — it is
        // what `land` reads, possibly hours after this call returned.
        expect(record("green")).toBe("");

        fs.writeFileSync(flag, "");
        expect(run({ args: ["fast"] }).status).toBe(1);
        expect(record("green")).toBeNull();
    });
});

describe("gate-run — one live run per (cwd, script), and the orphans are reaped (#4940)", () => {
    const KEY = "TOLARIA_GATE_RUN_KEY";
    const short = {
        TOLARIA_GATE_RUN_WAIT_SECS: "1",
        TOLARIA_GATE_RUN_KILL_GRACE: "2",
    };
    const starts = () => path.join(tmp, "starts");
    const startCount = () =>
        fs.existsSync(starts())
            ? fs.readFileSync(starts(), "utf8").trim().split("\n").length
            : 0;
    /** A gate whose process group outlives its leader's `sh`: a background
     *  `sleep` (pid written to `child`) is what a stray `pkill` used to miss.
     *  It also records whether the PREVIOUS run's child was still alive when
     *  it started — the `--replace` overlap the acceptance criterion forbids. */
    const groupFixture = (dir = tmp) =>
        fs.writeFileSync(
            path.join(dir, "slow.sh"),
            [
                "#!/bin/sh",
                `C="${path.join(tmp, "child")}"`,
                `if [ -f "$C" ] && kill -0 "$(cat "$C")" 2>/dev/null; then echo OVERLAP >>"${path.join(tmp, "overlap")}"; fi`,
                "sleep 60 &",
                'echo $! >"$C"',
                `echo x >>"${starts()}"`,
                "wait",
            ].join("\n"),
            { mode: 0o755 }
        );
    const childPid = () =>
        Number(fs.readFileSync(path.join(tmp, "child"), "utf8").trim());
    const waitForChild = () =>
        expect(
            waitForFile(path.join(tmp, "child"), 10),
            "fixture never started"
        ).toBe(true);

    it("refuses a second key for the same script and cwd, naming the live key, and starts nothing", () => {
        groupFixture();
        const first = run({
            args: ["slow"],
            env: { ...short, [KEY]: "try-1" },
        });
        expect(first.status, `${first.stdout}${first.stderr}`).toBe(75);
        waitForChild();

        const second = run({
            args: ["slow"],
            env: { ...short, [KEY]: "try-2" },
        });
        expect(second.status, `${second.stdout}${second.stderr}`).toBe(76);
        expect(second.stderr).toMatch(/REFUSED/);
        expect(second.stderr).toContain(`${KEY}=try-1`);
        expect(startCount()).toBe(1);
        expect(liveRunPgids()).toHaveLength(1);
    });

    it("a keyless call is refused beside a keyed run of the same script and cwd too", () => {
        groupFixture();
        expect(
            run({ args: ["slow"], env: { ...short, [KEY]: "named" } }).status
        ).toBe(75);
        waitForChild();
        const keyless = run({ args: ["slow"], env: short });
        expect(keyless.status, `${keyless.stdout}${keyless.stderr}`).toBe(76);
        expect(startCount()).toBe(1);
    });

    it("--replace kills the old run's whole process group BEFORE the new run starts", () => {
        groupFixture();
        expect(
            run({ args: ["slow"], env: { ...short, [KEY]: "old" } }).status
        ).toBe(75);
        waitForChild();
        const [oldPgid] = liveRunPgids();
        const oldChild = childPid();
        expect(groupAlive(oldPgid)).toBe(true);

        const r = run({
            args: ["--replace", "slow"],
            env: { ...short, [KEY]: "new" },
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(75);
        expect(r.stderr).toMatch(/reaped pgid/);
        expect(
            groupAlive(oldPgid),
            "old process group survived --replace"
        ).toBe(false);
        expect(pidAlive(oldChild), "old run's background child survived").toBe(
            false
        );
        expect(waitForFile(starts(), 10)).toBe(true);
        expect(
            spawnSync("sh", [
                "-c",
                `i=0; while [ "$(wc -l <"$1")" -lt 2 ] && [ $i -lt 10 ]; do sleep 1; i=$((i+1)); done`,
                "sh",
                starts(),
            ]).status
        ).toBe(0);
        expect(startCount()).toBe(2);
        expect(
            fs.existsSync(path.join(tmp, "overlap")),
            "new run started while the old one lived"
        ).toBe(false);
    });

    it("reaps a run whose cwd was deleted on the next gate-run call — a real process group", () => {
        const wt = path.join(tmp, "wt");
        fs.mkdirSync(wt);
        fs.copyFileSync(
            path.join(tmp, "package.json"),
            path.join(wt, "package.json")
        );
        groupFixture(wt);
        expect(run({ args: ["slow"], env: short, cwd: wt }).status).toBe(75);
        waitForChild();
        const [pgid] = liveRunPgids();
        const child = childPid();
        fs.rmSync(wt, { recursive: true, force: true });

        fixtureScript("fast", "exit 0");
        const r = run({ args: ["fast"], env: short });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stderr).toMatch(/its cwd no longer exists/);
        expect(groupAlive(pgid), "orphan process group survived").toBe(false);
        expect(pidAlive(child)).toBe(false);
        expect(
            fs.readFileSync(path.join(runDir, "reaped.log"), "utf8")
        ).toMatch(/cwd no longer exists/);
    });

    it("spares a script that deletes its own cwd (land) from the cwd rule", () => {
        const wt = path.join(tmp, "wt");
        fs.mkdirSync(wt);
        fs.copyFileSync(
            path.join(tmp, "package.json"),
            path.join(wt, "package.json")
        );
        groupFixture(wt);
        expect(
            run({ args: ["land"], env: { ...short, [KEY]: "land-1" }, cwd: wt })
                .status
        ).toBe(75);
        waitForChild();
        const [pgid] = liveRunPgids();
        fs.rmSync(wt, { recursive: true, force: true });

        fixtureScript("fast", "exit 0");
        expect(run({ args: ["fast"], env: short }).status).toBe(0);
        expect(groupAlive(pgid), "a landing was reaped mid-housekeeping").toBe(
            true
        );
    });

    it("reaps a run past the age ceiling that nobody re-attached to, and spares one re-attached recently", () => {
        groupFixture();
        expect(run({ args: ["slow"], env: short }).status).toBe(75);
        waitForChild();
        const [pgid] = liveRunPgids();
        spawnSync("sleep", ["3"]);
        fixtureScript("fast", "exit 0");

        // Old, but attached 3s ago — inside a 100s idle window: spared.
        const spared = run({
            args: ["fast"],
            env: {
                ...short,
                TOLARIA_GATE_RUN_REAP_SECS: "1",
                TOLARIA_GATE_RUN_IDLE_SECS: "100",
            },
        });
        expect(spared.status).toBe(0);
        expect(groupAlive(pgid)).toBe(true);

        const reaped = run({
            args: ["fast"],
            env: {
                ...short,
                TOLARIA_GATE_RUN_REAP_SECS: "1",
                TOLARIA_GATE_RUN_IDLE_SECS: "1",
            },
        });
        expect(reaped.status).toBe(0);
        expect(reaped.stderr).toMatch(/unattended/);
        expect(groupAlive(pgid)).toBe(false);
    });

    it("--list names each live run's key, script, cwd, age and pid", () => {
        groupFixture();
        expect(
            run({ args: ["slow"], env: { ...short, [KEY]: "listed" } }).status
        ).toBe(75);
        waitForChild();
        const [pgid] = liveRunPgids();
        const r = run({ args: ["--list"], env: short });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(r.stdout).toContain("key listed");
        expect(r.stdout).toContain("`bun run slow`");
        expect(r.stdout).toContain(`cwd ${fs.realpathSync(tmp)}`);
        expect(r.stdout).toMatch(/age \d+s/);
        expect(r.stdout).toContain(`pid ${pgid}`);
    });
});

describe("gate-run — a land retried under the same key keeps its earlier attempt (issue #4968)", () => {
    /**
     * Every run under one key reuses one dir, and a start rewrites `started`,
     * `log` and `green` — so a failed `land` retried before anything read the
     * dir vanished, and `workflow:kpi`'s failed-land share counted only
     * survivors. The start now copies the attempt it overwrites into
     * `attempts/<started>/`, which `telemetry-ingest` reads.
     */
    it("archives the overwritten attempt's command, started and log — and no green on a red one", () => {
        fixtureScript("slow", 'echo "ATTEMPT-ONE"\nexit 1');
        expect(run({ args: ["land", "7"] }).status).toBe(1);
        fixtureScript("slow", 'echo "ATTEMPT-TWO"\nexit 0');
        expect(run({ args: ["land", "7"] }).status).toBe(0);

        const [dir] = fs
            .readdirSync(runDir)
            .filter((d) => d.startsWith("land-"));
        const attempts = path.join(runDir, dir, "attempts");
        const kept = fs.readdirSync(attempts);
        expect(kept).toHaveLength(1);
        const a = path.join(attempts, kept[0]);
        expect(fs.readFileSync(path.join(a, "command"), "utf8").trim()).toBe(
            "land 7"
        );
        expect(fs.readFileSync(path.join(a, "started"), "utf8").trim()).toBe(
            kept[0]
        );
        expect(fs.readFileSync(path.join(a, "log"), "utf8")).toContain(
            "ATTEMPT-ONE"
        );
        expect(fs.existsSync(path.join(a, "green"))).toBe(false);
        // The live record is the retry's.
        expect(
            fs.readFileSync(path.join(runDir, dir, "log"), "utf8")
        ).toContain("ATTEMPT-TWO");
    });

    it("archives nothing for a command that is not a land", () => {
        fixtureScript("fail", "exit 1");
        run({ args: ["fail"] });
        run({ args: ["fail"] });
        const [dir] = fs
            .readdirSync(runDir)
            .filter((d) => d.startsWith("fail-"));
        expect(fs.existsSync(path.join(runDir, dir, "attempts"))).toBe(false);
    });
});
