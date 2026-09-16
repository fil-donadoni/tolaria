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

const fixtureScript = (name: string, body: string): void => {
    fs.writeFileSync(path.join(tmp, `${name}.sh`), `#!/bin/sh\n${body}\n`, {
        mode: 0o755,
    });
};

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
            },
        })
    );
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

interface RunOpts {
    args: string[];
    env?: Record<string, string>;
}

const run = (opts: RunOpts) =>
    spawnSync("sh", [GATE_RUN, ...opts.args], {
        cwd: tmp,
        encoding: "utf8",
        env: {
            ...process.env,
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
        fixtureScript(
            "slow",
            `sleep 4\necho "MARKER-LATE"\ntouch "${done}"\nexit 3`
        );

        const first = run({
            args: ["slow"],
            env: { TOLARIA_GATE_RUN_WAIT_SECS: "0" },
        });
        expect(first.status, `${first.stdout}${first.stderr}`).toBe(75);
        expect(fs.existsSync(done)).toBe(false);

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
        fixtureScript("slow", `sleep 5\ntouch "${done}"\nexit 4`);

        const child = spawn("sh", [GATE_RUN, "slow"], {
            cwd: tmp,
            detached: true,
            stdio: "ignore",
            env: {
                ...process.env,
                TOLARIA_GATE_RUN_DIR: runDir,
                TOLARIA_GATE_RUN_POLL_SECS: "1",
                TOLARIA_GATE_RUN_WAIT_SECS: "60",
            },
        });
        // Let the script reach its wait loop, then kill its whole group.
        await new Promise((r) => setTimeout(r, 2000));
        process.kill(-child.pid!, "SIGTERM");
        await new Promise((r) => setTimeout(r, 500));
        expect(
            fs.existsSync(done),
            "the gate finished too early to prove anything"
        ).toBe(false);

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
            env: { ...process.env, ...env },
        });
        const second = spawnSync("sh", [GATE_RUN, "slow"], {
            cwd: other,
            encoding: "utf8",
            env: { ...process.env, ...env },
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

    it("still separates two worktrees that gate the same script with no key", () => {
        // The default must not become "one global run per command": two
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
            env: { ...process.env, ...env },
        });
        const second = spawnSync("sh", [GATE_RUN, "slow"], {
            cwd: other,
            encoding: "utf8",
            env: { ...process.env, ...env },
        });
        expect(second.stderr).toMatch(/started/);
        expect(second.stderr).not.toMatch(/re-attached/);
        fs.rmSync(other, { recursive: true, force: true });
    });
});
