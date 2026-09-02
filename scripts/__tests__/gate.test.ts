import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
    mkdtempSync,
    mkdirSync,
    rmSync,
    existsSync,
    readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * CPU admission control (scripts/gate.ts) — see CLAUDE.md § Quality gates.
 *
 * These assertions are the reason the gate exists: concurrent subagents each
 * spawning `ncpu - 1` vitest workers drove this machine to 5x oversubscription.
 * The mutex and the issue-worktree guard are what stop that, so they get a test
 * that actually runs the script rather than re-implementing its logic.
 *
 * The lock root is redirected to a temp dir (TOLARIA_GATE_LOCK_ROOT) so the
 * suite never contends with — or blocks on — a real gate run on this machine.
 */
const GATE = resolve(__dirname, "..", "gate.ts");

let lockRoot: string;

function env(extra: Record<string, string> = {}) {
    const base = { ...process.env, TOLARIA_GATE_LOCK_ROOT: lockRoot };
    // Strip everything gate.ts itself sets: this suite may well be running
    // UNDER a heavy gate (`bun run test`), which exports these to its whole
    // process tree — inheriting them would make the child observe the outer
    // gate's state instead of the one under test.
    delete base.TOLARIA_GATE_HELD;
    delete base.TOLARIA_ALLOW_FULL_SUITE;
    delete base.TOLARIA_VITEST_WORKERS;
    return { ...base, ...extra };
}

function run(
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
) {
    return spawnSync("bun", [GATE, ...args], {
        encoding: "utf8",
        // Default to the neutral temp dir, NOT the checkout this suite runs
        // in: the suite itself may be running inside a `feat/issue-N`
        // worktree (the light `check:guards` gate runs there routinely), and
        // with an inherited cwd every heavy-tier spawn would trip gate.ts's
        // issue-worktree guard and fail the suite. The guard's own tests pass
        // an explicit cwd to exercise exactly that behaviour.
        cwd: opts.cwd ?? lockRoot,
        env: opts.env ?? env(),
    });
}

/** A shell command that burns real CPU for `seconds` — the only kind of hold
 *  the heartbeat is allowed to vouch for since issue #2999. `sleep` is its
 *  opposite: alive, zero CPU, indistinguishable from the hung vitest that
 *  blocked three sessions for 2h13m. */
function burnCpu(seconds: number) {
    return `end=$(( $(date +%s) + ${seconds} )); while [ $(date +%s) -lt $end ]; do :; done`;
}

/** Resolve once the spawned holder has actually written owner.json: `spawn`
 *  returns before bun has even started, so a waiter launched immediately would
 *  win the lock and test nothing. */
async function waitForLock(timeoutMs = 5000) {
    const f = join(lockRoot, "gate.lock", "owner.json");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (existsSync(f)) return;
        await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("holder never took the lock");
}

/** A hold shaped like every real one: a heavy PARALLEL phase whose children
 *  then exit, followed by a lighter single-process phase that keeps working.
 *  The full suite is three sequential vitest invocations, each tearing down a
 *  worker pool; `check:all:inner` walks a chain of separate tools. The live
 *  CPU snapshot COLLAPSES at each turnover, so a progress signal that is not
 *  monotonic reads this healthy command as frozen. */
function burstThenSteady(
    parallel: number,
    burstSeconds: number,
    tailSeconds: number
) {
    const burn = (n: number) =>
        `end=$(( $(date +%s) + ${n} )); while [ $(date +%s) -lt $end ]; do :; done`;
    return (
        `for i in $(seq 1 ${parallel}); do ( ${burn(burstSeconds)} ) & done; wait; ` +
        `${burn(tailSeconds)}; echo PHASES-DONE`
    );
}

function readOwnerTs(): number {
    const f = join(lockRoot, "gate.lock", "owner.json");
    return (JSON.parse(readFileSync(f, "utf8")) as { ts: number }).ts;
}

beforeEach(() => {
    lockRoot = mkdtempSync(join(tmpdir(), "tolaria-gate-test-"));
});

afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
});

describe("gate.ts — tier dispatch", () => {
    it("light tier runs the command without setting a worker override", () => {
        const r = run([
            "light",
            "echo held=[$TOLARIA_GATE_HELD] w=[$TOLARIA_VITEST_WORKERS]",
        ]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("held=[]");
        expect(r.stdout).toContain("w=[]");
    });

    it("heavy tier raises the vitest worker cap for its child", () => {
        const r = run([
            "heavy",
            "echo held=[$TOLARIA_GATE_HELD] w=[$TOLARIA_VITEST_WORKERS]",
        ]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("held=[1]");
        expect(r.stdout).toMatch(/w=\[[2-9]\d*\]/);
    });

    it("propagates the child's exit code", () => {
        expect(run(["heavy", "exit 3"]).status).toBe(3);
        expect(run(["light", "exit 3"]).status).toBe(3);
    });

    it("rejects an unknown tier", () => {
        expect(run(["turbo", "echo hi"]).status).toBe(2);
    });
});

describe("gate.ts — machine-wide mutex", () => {
    it("releases the lock after the command finishes", () => {
        run(["heavy", "true"]);
        expect(existsSync(join(lockRoot, "gate.lock"))).toBe(false);
    });

    it("serializes two heavy runs — the second starts only after the first ends", async () => {
        const stamp = (tag: string) => `printf '${tag}:%s\\n' "$(date +%s%N)"`;
        const first = spawn(
            "bun",
            [GATE, "heavy", `${stamp("A-end")}; sleep 2; ${stamp("A-out")}`],
            { encoding: "utf8", cwd: lockRoot, env: env() } as never
        );
        let outA = "";
        first.stdout!.on("data", (d) => (outA += d));

        // Let the first acquire before the second races for the lock.
        await new Promise((r) => setTimeout(r, 400));
        const second = run(["heavy", stamp("B-start")]);

        await new Promise<void>((r) => first.on("exit", () => r()));

        const aOut = Number(/A-out:(\d+)/.exec(outA)?.[1]);
        const bStart = Number(/B-start:(\d+)/.exec(second.stdout)?.[1]);
        expect(Number.isFinite(aOut)).toBe(true);
        expect(Number.isFinite(bStart)).toBe(true);
        // B may only begin once A has released — i.e. after A's last statement.
        expect(bStart).toBeGreaterThan(aOut);
    }, 20_000);

    it("heartbeats the owner stamp while the held command BURNS CPU — a long hold never reads stale (issue #1924)", async () => {
        // ── Why the beat is 400ms and not 150ms ────────────────────────────
        //
        // The progress signal is `ps -o time=`, which reports CENTISECONDS —
        // so a beat sees "progress" only if the subtree gained >= 10ms of CPU
        // since the last sample. That is free on an idle machine and NOT free
        // here: this test runs inside the full suite, which saturates the box
        // with `ncpu - 1` vitest workers, and a starved burner gets a few
        // percent of a core. At 5% CPU a 150ms beat earns ~7.5ms — under one
        // tick — so two consecutive beats could legitimately observe no
        // change and the gate would correctly declare STALLED. The test then
        // failed for a property of the MACHINE rather than of the code, which
        // is what made it flaky on main (it was red in `health:main` and in
        // the #2699 merge gate, and green in isolation every time).
        //
        // 400ms beats earn ~20ms at 5% CPU — two ticks, with margin — so a
        // STALLED verdict now needs the burner held under ~1.25% of a core for
        // 800ms straight. The ASSERTION is unchanged; only the sampling window
        // is wide enough to make the measurement.
        //
        // This is the HOUSE REMEDY, not a new one: the monotonic-total test
        // below already carries the same 400ms beat and says why, in the same
        // terms ("under a loaded machine a 150ms beat can legitimately see no
        // measurable change on a starved process"). That test was widened when
        // someone hit this; this one is the last with the vulnerable shape —
        // asserting the ABSENCE of a stall while burning. The `stallEnv` tests
        // keep 150ms correctly: they assert a zero-CPU `sleep` DOES trip, and
        // starvation only makes that fire sooner.
        //
        // Production never had the problem at all: HEARTBEAT_MS defaults to
        // five MINUTES (`scripts/gate.ts`), where a 10ms tick is never the
        // limiting factor. Do not re-compress this to chase a faster test.
        const child = spawn("bun", [GATE, "heavy", burnCpu(6)], {
            cwd: lockRoot,
            env: env({
                TOLARIA_GATE_HEARTBEAT_MS: "400",
                TOLARIA_GATE_STALL_BEATS: "2",
            }),
            stdio: ["ignore", "ignore", "pipe"],
        } as never);
        let err = "";
        child.stderr!.on("data", (d) => (err += d));
        await new Promise((r) => setTimeout(r, 1200));
        const t1 = readOwnerTs();
        await new Promise((r) => setTimeout(r, 1200));
        const t2 = readOwnerTs();
        await new Promise<void>((r) => child.on("exit", () => r()));
        // The stamp must advance while the command runs: waiters measure
        // staleness from it, so a refreshed stamp is what protects a
        // multi-hour ladder hold from the 45-min prune. The command has to
        // burn real CPU for that — the stamp attests to the SUBTREE making
        // progress, not to the gate process existing (issue #2999).
        expect(t2).toBeGreaterThan(t1);
        expect(err).not.toContain("STALLED");
    }, 20_000);

    it("prunes a lock whose holder is dead instead of waiting for it", () => {
        // A lock dir with no readable owner is indistinguishable from an
        // orphan: the acquirer must prune it rather than block forever.
        mkdirSync(join(lockRoot, "gate.lock"), { recursive: true });
        const r = run(["heavy", "echo acquired"]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("acquired");
    }, 20_000);
});

describe("gate.ts — liveness (issue #2999)", () => {
    /**
     * The incident this suite exists for: a `health:main` whose vitest hung at
     * startup burned 16.86 s of CPU in 2h13m and kept heartbeating the whole
     * time, because the heartbeat attested to the GATE process being alive
     * rather than to the wrapped command making progress. `alive(pid)` was
     * true and the stamp was never stale, so no waiter could reclaim it.
     * `sleep` reproduces exactly that shape in milliseconds: a live subtree
     * burning no CPU at all.
     */
    const stallEnv = (extra: Record<string, string> = {}) =>
        env({
            TOLARIA_GATE_HEARTBEAT_MS: "150",
            TOLARIA_GATE_STALL_BEATS: "2",
            ...extra,
        });

    it("stops heartbeating once the held subtree makes no progress", async () => {
        const child = spawn("bun", [GATE, "heavy", "sleep 5"], {
            cwd: lockRoot,
            env: stallEnv(),
            stdio: ["ignore", "ignore", "pipe"],
        } as never);
        let err = "";
        child.stderr!.on("data", (d) => (err += d));
        // Wait for the VERDICT, then sample — never sample on a wall-clock
        // guess. The beat is a 150ms `setInterval`, and under the load this
        // suite creates it fires late; a fixed 1200ms window can therefore
        // land BEFORE the stall is declared, catching the stamp mid-advance
        // and failing `t2 === t1` for a property of the machine. (Observed:
        // t2 - t1 = 1227ms, co-scheduled with the catalogue round-trip file.)
        // The property under test is "once stalled, the stamp stops", which
        // says nothing about when the stall lands — so wait for it.
        const stalledBy = Date.now() + 10_000;
        while (!err.includes("STALLED") && Date.now() < stalledBy)
            await new Promise((r) => setTimeout(r, 50));
        expect(err).toContain("STALLED");
        const t1 = readOwnerTs();
        await new Promise((r) => setTimeout(r, 600));
        const t2 = readOwnerTs();
        child.kill("SIGKILL");
        await new Promise<void>((r) => child.on("exit", () => r()));
        // Frozen subtree ⇒ frozen stamp ⇒ the existing STALE_MS path can fire.
        expect(t2).toBe(t1);
    }, 20_000);

    it("a waiter reclaims a stalled holder's lock through the STALE_MS path", async () => {
        const holder = spawn("bun", [GATE, "heavy", "sleep 10"], {
            cwd: lockRoot,
            env: stallEnv(),
            stdio: ["ignore", "ignore", "pipe"],
        } as never);
        // Let it beat, go silent, and then age past the (shortened) staleness
        // threshold — the reclaim itself is the UNCHANGED 45-min path, only
        // fed an honest input.
        await new Promise((r) => setTimeout(r, 1500));

        // Bounded on purpose: if the holder never goes silent, this call
        // blocks forever in acquire()'s poll loop, and a spawnSync that hangs
        // takes the vitest worker with it instead of reporting red.
        const waiter = spawnSync("bun", [GATE, "heavy", "echo RECLAIMED"], {
            encoding: "utf8",
            cwd: lockRoot,
            env: env({ TOLARIA_GATE_STALE_MS: "600" }),
            timeout: 8000,
        });
        holder.kill("SIGKILL");
        await new Promise<void>((r) => holder.on("exit", () => r()));

        expect(waiter.status, waiter.stdout + waiter.stderr).toBe(0);
        expect(waiter.stdout).toContain("RECLAIMED");
        // Loud enough to tell a reclaimed-because-stalled lock apart from a
        // normally released one (which logs nothing at all) and from a dead
        // holder's orphan.
        expect(waiter.stderr).toContain("reclaiming the heavy mutex");
        expect(waiter.stderr).toContain("STALLED holder");
    }, 25_000);

    it("never reclaims a holder that IS making progress, however long it runs (issue #1924)", async () => {
        const holder = spawn("bun", [GATE, "heavy", burnCpu(6)], {
            cwd: lockRoot,
            env: stallEnv(),
            stdio: "ignore",
        } as never);
        await waitForLock();
        // Staleness at 10x the heartbeat period and a bound at 2x staleness:
        // a holder still attesting cannot age out inside the bound, while one
        // that stopped attesting goes stale at ~1.7s and would be reclaimed
        // well before it — so this bound discriminates instead of merely
        // running out. A false reclaim here is the issue #1924 ladder
        // regression and nothing else.
        const waiter = spawnSync(
            "bun",
            [GATE, "heavy", "echo SHOULD-NOT-RUN"],
            {
                encoding: "utf8",
                cwd: lockRoot,
                env: env({ TOLARIA_GATE_STALE_MS: "1500" }),
                timeout: 3000,
            }
        );
        holder.kill("SIGKILL");

        // Still blocked when the bound fired ⇒ the lock was never taken from
        // a live, working holder.
        expect(waiter.signal).toBe("SIGTERM");
        expect(waiter.stdout).not.toContain("SHOULD-NOT-RUN");
        expect(waiter.stderr).not.toContain("reclaiming");
    }, 20_000);

    it("survives a phase turnover — a heavy parallel phase exiting is not a stall", async () => {
        // Without a monotonic total this is a FALSE reclaim: the four burners
        // push the live snapshot to ~8 CPU-seconds, they exit, and the single
        // tail process cannot climb back past that peak within its lifetime —
        // so every remaining beat reads "no progress" on a command that is
        // working and will exit 0.
        // A slower beat than the other liveness tests on purpose: `ps` reports
        // CPU at 10ms granularity, so under a loaded machine a 150ms beat can
        // legitimately see no measurable change on a starved process. 3 beats
        // of 400ms needs 1.2s of ZERO measurable CPU to trip — unreachable for
        // a spinning process at any share of a core, while still firing well
        // inside the 5s tail if the total is not monotonic.
        const child = spawn("bun", [GATE, "heavy", burstThenSteady(4, 2, 5)], {
            cwd: lockRoot,
            env: env({
                TOLARIA_GATE_HEARTBEAT_MS: "400",
                TOLARIA_GATE_STALL_BEATS: "3",
            }),
            stdio: ["ignore", "pipe", "pipe"],
        } as never);
        let out = "";
        let err = "";
        child.stdout!.on("data", (d) => (out += d));
        child.stderr!.on("data", (d) => (err += d));
        const code = await new Promise<number>((r) =>
            child.on("exit", (c) => r(c ?? 1))
        );

        expect(code, err).toBe(0);
        expect(out).toContain("PHASES-DONE");
        expect(err).not.toContain("STALLED");
    }, 30_000);

    it("a waiter's first line names the holder — pid, cwd, label and held-for", async () => {
        const holder = spawn("bun", [GATE, "heavy", "sleep 10"], {
            cwd: lockRoot,
            env: env(),
            stdio: "ignore",
        } as never);
        await waitForLock();
        const waiter = spawnSync("bun", [GATE, "heavy", "echo NOPE"], {
            encoding: "utf8",
            cwd: lockRoot,
            env: env(),
            timeout: 3000,
        });
        holder.kill("SIGKILL");

        // Three sessions sat blocked for two hours with no way to tell who
        // held the mutex; every field below was already in owner.json.
        expect(waiter.stderr).toMatch(
            /\[gate\] waiting \S+ for the heavy mutex — pid \d+ · held \S+ · last progress \S+ ago · \S+ · sleep 10/
        );
    }, 20_000);

    it("`who` reports the holder plus its descendant CPU, or says the mutex is free", async () => {
        expect(run(["who"]).stdout).toContain("heavy mutex is free");

        const holder = spawn("bun", [GATE, "heavy", "sleep 10"], {
            cwd: lockRoot,
            env: env(),
            stdio: "ignore",
        } as never);
        await waitForLock();
        // `sh -c "sleep 10"` burns a few ms at startup, so the descendant
        // total is small but present — the point is that it is MEASURED.
        await new Promise((r) => setTimeout(r, 300));
        const out = run(["who"]).stdout;
        holder.kill("SIGKILL");

        expect(out).toMatch(/pid \d+ · held \S+ · last progress \S+ ago/);
        expect(out).toMatch(/holder pid alive · subtree CPU \d+\.\d\ds/);
    }, 20_000);
});

describe("gate.ts — issue-worktree guard", () => {
    /** A non-repo dir whose path matches the issue-worktree naming convention. */
    function issueWorktree() {
        const d = join(lockRoot, "tolaria-issue-4242");
        mkdirSync(d, { recursive: true });
        return d;
    }

    it("blocks the heavy tier inside an issue worktree", () => {
        const r = run(["heavy", "echo SHOULD-NOT-RUN"], {
            cwd: issueWorktree(),
        });
        expect(r.status).toBe(1);
        expect(r.stdout).not.toContain("SHOULD-NOT-RUN");
        expect(r.stderr).toContain("Full gate blocked");
    });

    it("still allows the light tier there — targeted tests are the pre-PR gate", () => {
        const r = run(["light", "echo TARGETED-OK"], { cwd: issueWorktree() });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("TARGETED-OK");
    });

    it("honours the TOLARIA_ALLOW_FULL_SUITE escape hatch (merge-train only)", () => {
        const r = run(["heavy", "echo ESCAPE-OK"], {
            cwd: issueWorktree(),
            env: env({ TOLARIA_ALLOW_FULL_SUITE: "1" }),
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("ESCAPE-OK");
    });

    it("does not block outside an issue worktree", () => {
        const r = run(["heavy", "echo MAIN-OK"], { cwd: lockRoot });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("MAIN-OK");
    });
});
