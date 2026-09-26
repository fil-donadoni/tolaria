import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
    mkdtempSync,
    mkdirSync,
    rmSync,
    existsSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    INITIAL_HEARTBEAT,
    SubtreeProgress,
    heartbeatStep,
    parseCpuMs,
    reclaimVerdict,
    subtreeFromPs,
    yieldVerdict,
    type BeatVerdict,
    type GateWaiter,
} from "../lib/gate-liveness";

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
 *
 * What goes through a subprocess is the WIRING only — lock dir, owner stamp,
 * waiter and STALLED lines — and every such test waits for an observable
 * event, never for a wall-clock window. The liveness DECISIONS (progress /
 * silent / stalled, reclaim or wait) are pure functions in
 * `scripts/lib/gate-liveness.ts`, asserted over hand-built samples below
 * (issue #3792): asserting them through a real CPU burner made the verdict a
 * property of the machine's load — a starved spinner reads as a stall — and a
 * false red in `health:main` writes the durable RED marker. The end-to-end
 * burner runs live in `gate.perf.test.ts`, which is never gated.
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
    delete base.TOLARIA_HEAVY_WORKERS_CAP;
    return { ...base, ...extra };
}

function run(
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}
) {
    return spawnSync("bun", [GATE, ...args], {
        encoding: "utf8",
        // A BOUND, not a measurement. `spawnSync` blocks the worker outright,
        // so vitest's own testTimeout cannot interrupt it: a gate that never
        // acquires turns a red into a hang, and a hang is not evidence (the
        // `yield` tier's starvation bound was proven exactly this way — with
        // the bound removed the call sat for 42 minutes instead of failing).
        // Sized so only a gate that never returns can reach it.
        timeout: opts.timeout ?? 60_000,
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

/** Resolve once the spawned holder has actually written owner.json: `spawn`
 *  returns before bun has even started, so a waiter launched immediately would
 *  win the lock and test nothing. */
async function waitForLock(timeoutMs = 20_000) {
    const f = join(lockRoot, "gate.lock", "owner.json");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (existsSync(f)) return;
        await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("holder never took the lock");
}

/** The owner stamp, or null while owner.json is absent or mid-write — the
 *  gate rewrites it in place (truncate, then write), so a poll can land on an
 *  empty file. Callers wait for a number; a torn read is never a verdict. */
function readOwnerTs(): number | null {
    try {
        const f = join(lockRoot, "gate.lock", "owner.json");
        return (JSON.parse(readFileSync(f, "utf8")) as { ts: number }).ts;
    } catch {
        return null;
    }
}

/** A stamp that is actually readable, waited for. */
async function stableOwnerTs(): Promise<number> {
    let ts: number | null = null;
    await waitFor(() => (ts = readOwnerTs()) !== null);
    expect(ts).not.toBeNull();
    return ts!;
}

/** Poll `done` until it holds or a generous deadline passes. Every subprocess
 *  test waits for an EVENT through this — a bound sized so only a hang, never
 *  a loaded machine, can exhaust it. */
async function waitFor(done: () => boolean, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (!done() && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 50));
    return done();
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

    /**
     * The heavy tier's worker count is RAM-bound, not CPU-bound (issue #3123).
     * `ncpu - 1` = 7 workers × ~0.9 GB plus `tsc` at ~2 GB is ~8 GB on top of
     * an ~11 GB baseline on a 16 GB machine — measured 5.5 GB of swap and 1.2M
     * pageouts, i.e. reds from paging rather than from the code. The default
     * ceiling is 4.
     */
    const cap = (ceiling: number) =>
        Math.max(2, Math.min(cpus().length - 1, ceiling));

    it("caps the heavy tier's workers at the RAM-bound default of 4", () => {
        const r = run(["heavy", "echo w=[$TOLARIA_VITEST_WORKERS]"]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain(`w=[${cap(4)}]`);
    });

    it("honours TOLARIA_HEAVY_WORKERS_CAP (a bigger machine raises it)", () => {
        const r = run(["heavy", "echo w=[$TOLARIA_VITEST_WORKERS]"], {
            env: env({ TOLARIA_HEAVY_WORKERS_CAP: "3" }),
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain(`w=[${cap(3)}]`);
    });

    it("never drops below 2 workers, however low the cap", () => {
        const r = run(["heavy", "echo w=[$TOLARIA_VITEST_WORKERS]"], {
            env: env({ TOLARIA_HEAVY_WORKERS_CAP: "1" }),
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("w=[2]");
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

        // Let the first acquire before the second races for the lock — on
        // the lock file itself, not a guessed delay a slow bun start outruns.
        await waitForLock();
        const second = run(["heavy", stamp("B-start")]);

        await new Promise<void>((r) => first.on("exit", () => r()));

        const aOut = Number(/A-out:(\d+)/.exec(outA)?.[1]);
        const bStart = Number(/B-start:(\d+)/.exec(second.stdout)?.[1]);
        expect(Number.isFinite(aOut)).toBe(true);
        expect(Number.isFinite(bStart)).toBe(true);
        // B may only begin once A has released — i.e. after A's last statement.
        expect(bStart).toBeGreaterThan(aOut);
        // A queued waiter names the wait AND closes it: the health gate
        // forwards these lines to the release terminal (issue #3487), where a
        // last line of "waiting …" would still read as queued.
        expect(second.stderr).toMatch(
            /\[gate\] waiting .* for the heavy mutex/
        );
        expect(second.stderr).toMatch(
            /\[gate\] acquired the heavy mutex after /
        );
    }, 20_000);

    it("refreshes the owner stamp on every beat short of a stall verdict — a long hold never reads stale (issue #1924)", async () => {
        // The WIRING only: the beat rewrites owner.json. Whether a beat is
        // progress is `heartbeatStep`'s call, tested pure below — so the stall
        // threshold here is out of reach, and a holder the machine starves
        // still refreshes. (Asserting this through a CPU burner was issue
        // #3792's false red: three starved beats read as a stall.)
        const child = spawn("bun", [GATE, "heavy", "sleep 60"], {
            cwd: lockRoot,
            env: env({
                TOLARIA_GATE_HEARTBEAT_MS: "100",
                TOLARIA_GATE_STALL_BEATS: "1000000",
            }),
            stdio: ["ignore", "ignore", "pipe"],
        } as never);
        let err = "";
        child.stderr!.on("data", (d) => (err += d));
        let refreshes = 0;
        try {
            await waitForLock();
            // The first measurable beat is always "progress", so one refresh
            // proves nothing about SILENT beats: `sleep` burns no CPU, so
            // every beat after it is silent, and each must still rewrite the
            // stamp. Count several distinct advances.
            let last = await stableOwnerTs();
            await waitFor(() => {
                const ts = readOwnerTs();
                if (ts !== null && ts > last) {
                    last = ts;
                    refreshes++;
                }
                return refreshes >= 4;
            });
        } finally {
            child.kill("SIGKILL");
        }
        await new Promise<void>((r) => child.on("exit", () => r()));
        // Waiters measure staleness from this stamp, so a refreshed stamp is
        // what protects a multi-hour ladder hold from the 45-min prune.
        expect(refreshes).toBeGreaterThanOrEqual(4);
        expect(err).not.toContain("STALLED");
    }, 30_000);

    it("prunes a lock whose holder is dead instead of waiting for it", () => {
        // A lock dir with no readable owner is indistinguishable from an
        // orphan: the acquirer must prune it rather than block forever.
        mkdirSync(join(lockRoot, "gate.lock"), { recursive: true });
        const r = run(["heavy", "echo acquired"]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("acquired");
    }, 20_000);
});

describe("gate-liveness — the stall decision, pure (issue #3792)", () => {
    const STALL = 3;

    /** Drive `heartbeatStep` over a sample sequence; one verdict per beat. */
    function beats(
        samples: (number | null)[],
        stallBeats = STALL
    ): BeatVerdict[] {
        let state = INITIAL_HEARTBEAT;
        return samples.map((cpu) => {
            const step = heartbeatStep(state, cpu, stallBeats);
            state = step.state;
            return step.verdict;
        });
    }

    /** The phase turnover every real hold goes through: four burners at a
     *  steady 400ms/beat, then they exit and ONE tail keeps working at
     *  50ms/beat — far under the burst's peak for its whole life. */
    function phaseTurnover(): Map<number, number>[] {
        const snaps: Map<number, number>[] = [];
        for (let beat = 1; beat <= 5; beat++)
            snaps.push(
                new Map([101, 102, 103, 104].map((p) => [p, beat * 400]))
            );
        for (let beat = 1; beat <= 20; beat++)
            snaps.push(new Map([[200, beat * 50]]));
        return snaps;
    }

    it("steady progress never stalls, however long the hold (issue #1924)", () => {
        const samples = Array.from({ length: 500 }, (_, i) => i * 10);
        expect(beats(samples)).not.toContain("stalled");
        expect(new Set(beats(samples))).toEqual(new Set(["progress"]));
    });

    it("flat samples stall at exactly STALL_BEATS — the first sample is the baseline", () => {
        expect(beats([700, 700, 700, 700, 700])).toEqual([
            "progress",
            "silent",
            "silent",
            "stalled",
            "latched",
        ]);
        expect(beats([700, 700], 1)).toEqual(["progress", "stalled"]);
    });

    it("a stall latches — a later rise never re-arms the heartbeat", () => {
        expect(beats([700, 700, 700, 700, 9000, 9999])).toEqual([
            "progress",
            "silent",
            "silent",
            "stalled",
            "latched",
            "latched",
        ]);
    });

    it("a rise resets the silent count", () => {
        expect(beats([1, 1, 1, 2, 2, 2, 3])).not.toContain("stalled");
    });

    it("unmeasurable samples count as progress — never reclaim a holder we cannot judge", () => {
        expect(beats([null, null, null, null, null, null])).not.toContain(
            "stalled"
        );
        // …and they reset a silent run rather than extending it.
        expect(beats([700, 700, 700, null, 700, 700, null, 700])).not.toContain(
            "stalled"
        );
    });

    it("a phase turnover is monotonic and never stalls", () => {
        const progress = new SubtreeProgress();
        const totals = phaseTurnover().map((s) => progress.observe(s)!);
        for (let i = 1; i < totals.length; i++)
            expect(totals[i]).toBeGreaterThan(totals[i - 1]);
        expect(beats(totals)).not.toContain("stalled");

        // The fixture discriminates: the RAW live snapshot collapses at the
        // turnover and a non-monotonic signal stalls this healthy hold.
        const raw = phaseTurnover().map((s) =>
            [...s.values()].reduce((a, b) => a + b, 0)
        );
        expect(beats(raw)).toContain("stalled");
    });

    it("a null snapshot neither resets nor advances the accumulated total", () => {
        const progress = new SubtreeProgress();
        expect(progress.observe(new Map([[1, 500]]))).toBe(500);
        expect(progress.observe(null)).toBeNull();
        expect(progress.observe(new Map([[2, 30]]))).toBe(530);
    });

    it("a waiter reclaims a dead or silent holder, and only those", () => {
        const now = 1_000_000;
        const stale = 45 * 60 * 1000;
        expect(reclaimVerdict(null, false, now, stale)).toBe("dead");
        expect(reclaimVerdict({ ts: now }, false, now, stale)).toBe("dead");
        expect(reclaimVerdict({ ts: now - stale - 1 }, false, now, stale)).toBe(
            "dead"
        );
        expect(reclaimVerdict({ ts: now - stale - 1 }, true, now, stale)).toBe(
            "stalled"
        );
        expect(
            reclaimVerdict({ ts: now - stale }, true, now, stale)
        ).toBeNull();
        expect(reclaimVerdict({ ts: now }, true, now, stale)).toBeNull();
    });

    it("parses `ps` CPU time on both platforms, and refuses garbage", () => {
        expect(parseCpuMs("0:01.50")).toBe(1500);
        expect(parseCpuMs("01:02:03")).toBe(3_723_000);
        expect(parseCpuMs("2-00:00:01")).toBe(172_801_000);
        expect(parseCpuMs("n/a")).toBeNull();
    });

    it("the subtree is every live descendant — not the gate, not the `ps` that measured it", () => {
        const ps = [
            "    1     0   9:99.00",
            "   50     1   0:00.10", // the gate
            "   60    50   0:01.00", // sh
            "   61    60   0:02.00", // vitest
            "   62    61   0:03.00", // worker
            "   70    50   0:00.02", // ps itself
            "   80     1   5:00.00", // unrelated
            "garbage line",
        ].join("\n");
        expect(subtreeFromPs(ps, 50, 70)).toEqual(
            new Map([
                [60, 1000],
                [61, 2000],
                [62, 3000],
            ])
        );
        expect(subtreeFromPs(ps, 999)).toEqual(new Map());
        expect(subtreeFromPs("", 50)).toBeNull();
    });
});

describe("gate.ts — liveness wiring (issue #2999)", () => {
    /**
     * The incident this suite exists for: a `health:main` whose vitest hung at
     * startup burned 16.86 s of CPU in 2h13m and kept heartbeating the whole
     * time, because the heartbeat attested to the GATE process being alive
     * rather than to the wrapped command making progress. `sleep` reproduces
     * exactly that shape: a live subtree burning no CPU at all. Load can only
     * make a zero-CPU subtree stall SOONER, so these never false-red — and
     * each waits for the STALLED line instead of a guessed window.
     */
    const stallEnv = () =>
        env({
            TOLARIA_GATE_HEARTBEAT_MS: "150",
            TOLARIA_GATE_STALL_BEATS: "2",
        });

    function spawnSilentHolder() {
        const child = spawn("bun", [GATE, "heavy", "sleep 60"], {
            cwd: lockRoot,
            env: stallEnv(),
            stdio: ["ignore", "ignore", "pipe"],
        } as never);
        const out = { err: "" };
        child.stderr!.on("data", (d) => (out.err += d));
        return { child, out };
    }

    it("stops heartbeating once the held subtree makes no progress", async () => {
        const { child, out } = spawnSilentHolder();
        let t1: number, t2: number;
        try {
            expect(await waitFor(() => out.err.includes("STALLED"))).toBe(true);
            t1 = await stableOwnerTs();
            // Latched: after the verdict no beat writes again, so any wait
            // shows the same stamp — the length only has to cover a few beats.
            await new Promise((r) => setTimeout(r, 600));
            t2 = await stableOwnerTs();
        } finally {
            child.kill("SIGKILL");
        }
        await new Promise<void>((r) => child.on("exit", () => r()));
        // Frozen subtree ⇒ frozen stamp ⇒ the existing STALE_MS path can fire.
        expect(t2).toBe(t1);
    }, 30_000);

    it("a waiter reclaims a stalled holder's lock through the STALE_MS path", async () => {
        const { child, out } = spawnSilentHolder();
        const stalled = await waitFor(() => out.err.includes("STALLED"));
        if (!stalled) child.kill("SIGKILL");
        expect(stalled).toBe(true);

        // Bounded on purpose: if the holder never goes silent, this call
        // blocks forever in acquire()'s poll loop, and a spawnSync that hangs
        // takes the vitest worker with it instead of reporting red.
        const waiter = spawnSync("bun", [GATE, "heavy", "echo RECLAIMED"], {
            encoding: "utf8",
            cwd: lockRoot,
            env: env({ TOLARIA_GATE_STALE_MS: "600" }),
            timeout: 20_000,
        });
        child.kill("SIGKILL");
        await new Promise<void>((r) => child.on("exit", () => r()));

        expect(waiter.status, waiter.stdout + waiter.stderr).toBe(0);
        expect(waiter.stdout).toContain("RECLAIMED");
        // Loud enough to tell a reclaimed-because-stalled lock apart from a
        // normally released one (which logs nothing at all) and from a dead
        // holder's orphan.
        expect(waiter.stderr).toContain("reclaiming the heavy mutex");
        expect(waiter.stderr).toContain("STALLED holder");
    }, 40_000);

    it("a waiter's first line names the holder — pid, cwd, label and held-for", async () => {
        const holder = spawn("bun", [GATE, "heavy", "sleep 60"], {
            cwd: lockRoot,
            env: env(),
            stdio: "ignore",
        } as never);
        await waitForLock();
        // The line is printed on the first poll: wait for it, then kill —
        // the waiter is blocked by design and never exits on its own.
        const waiter = spawn("bun", [GATE, "heavy", "echo NOPE"], {
            cwd: lockRoot,
            env: env(),
            stdio: ["ignore", "ignore", "pipe"],
        } as never);
        let waiterErr = "";
        waiter.stderr!.on("data", (d) => (waiterErr += d));
        try {
            expect(await waitFor(() => waiterErr.includes("\n"))).toBe(true);
        } finally {
            waiter.kill("SIGKILL");
            holder.kill("SIGKILL");
        }
        await new Promise<void>((r) => waiter.on("exit", () => r()));

        // Three sessions sat blocked for two hours with no way to tell who
        // held the mutex; every field below was already in owner.json.
        expect(waiterErr).toMatch(
            /\[gate\] waiting \S+ for the heavy mutex — pid \d+ · held \S+ · last progress \S+ ago · \S+ · sleep 60/
        );
    }, 30_000);

    it("`who` reports the holder plus its descendant CPU, or says the mutex is free", async () => {
        expect(run(["who"]).stdout).toContain("heavy mutex is free");

        const holder = spawn("bun", [GATE, "heavy", "sleep 60"], {
            cwd: lockRoot,
            env: env(),
            stdio: "ignore",
        } as never);
        await waitForLock();
        const out = run(["who"]).stdout;
        holder.kill("SIGKILL");

        // The figure may be 0.00s — the point is that it is MEASURED.
        expect(out).toMatch(/pid \d+ · held \S+ · last progress \S+ ago/);
        expect(out).toMatch(/holder pid alive · subtree CPU \d+\.\d\ds/);
    }, 30_000);

    it("`who` also names a live check:ui lane holder, and says free otherwise (issue #4687)", () => {
        expect(run(["who"]).stdout).toContain("check:ui lane is free");

        // A holder stamp for THIS test process: alive, so `who` reports it as
        // such without spawning a second real check:ui run.
        const lane = join(lockRoot, "ui.lock");
        mkdirSync(lane, { recursive: true });
        const now = Date.now();
        writeFileSync(
            join(lane, "owner.json"),
            JSON.stringify({
                pid: process.pid,
                label: "check:ui --all",
                cwd: "/some/worktree",
                ts: now,
                acquiredAt: now,
            })
        );
        const out = run(["who"]).stdout;
        expect(out).toMatch(
            new RegExp(
                `check:ui lane — pid ${process.pid} · held \\S+ · last heartbeat \\S+ ago · /some/worktree · check:ui --all`
            )
        );
        expect(out).toContain("holder pid alive");
    }, 30_000);
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

describe("gate.ts — the wrapped tree dies with the gate (issue #3821)", () => {
    /** Live? `signal 0` performs the permission and existence check only. */
    function alive(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Every descendant of `root`, by walking `ps` — not by matching a command
     * line. The processes under test are plain `sleep`s, indistinguishable from
     * any other session's on this shared machine; parentage is the only thing
     * that identifies them, and it is also exactly what the fix is about.
     */
    function descendants(root: number): number[] {
        const r = spawnSync("ps", ["-Ao", "pid,ppid"], { encoding: "utf8" });
        const kids = new Map<number, number[]>();
        for (const line of r.stdout.split("\n").slice(1)) {
            const [pid, ppid] = line.trim().split(/\s+/).map(Number);
            if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
            kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
        }
        const out: number[] = [];
        const queue = [...(kids.get(root) ?? [])];
        while (queue.length) {
            const pid = queue.shift()!;
            out.push(pid);
            queue.push(...(kids.get(pid) ?? []));
        }
        return out;
    }

    let strays: number[] = [];

    afterEach(() => {
        // This suite is about not leaking processes; it does not get to leak
        // its own when it fails.
        for (const pid of strays) {
            try {
                process.kill(pid, "SIGKILL");
            } catch {
                /* already gone */
            }
        }
        strays = [];
    });

    it("a targeted signal reaps the grandchildren, not just the shell", async () => {
        // Two `sleep`s under one `sh`: `child.kill()` reaches the shell alone,
        // so before the fix both of these outlived the gate, reparented to
        // PID 1, with nothing left to reclaim them.
        const gate = spawn("bun", [GATE, "light", "sleep 120 & sleep 120"], {
            cwd: tmpdir(),
            env: env(),
            stdio: "ignore",
        });
        const gatePid = gate.pid!;

        let tree: number[] = [];
        // The shell plus both sleeps — anything less and the assertion below
        // would pass on a tree that never got built.
        await waitFor(() => (tree = descendants(gatePid)).length >= 3);
        strays = [gatePid, ...tree];
        expect(tree.length).toBeGreaterThanOrEqual(3);

        // The signal a session teardown sends: the gate's pid alone. A Ctrl-C
        // would reach the whole foreground group and hide the defect entirely.
        process.kill(gatePid, "SIGTERM");

        const reaped = await waitFor(() => tree.every((pid) => !alive(pid)));
        expect(reaped, `survivors: ${tree.filter(alive).join(", ")}`).toBe(
            true
        );
    });

    it("gives the wrapped command its own process group, so the group is the handle", async () => {
        const gate = spawn("bun", [GATE, "light", "sleep 120"], {
            cwd: tmpdir(),
            env: env(),
            stdio: "ignore",
        });
        const gatePid = gate.pid!;

        let tree: number[] = [];
        await waitFor(() => (tree = descendants(gatePid)).length >= 1);
        strays = [gatePid, ...tree];

        const sh = tree[0]!;
        const pgid = Number(
            spawnSync("ps", ["-o", "pgid=", "-p", String(sh)], {
                encoding: "utf8",
            }).stdout.trim()
        );
        // A leader's group id IS its pid. Without `detached` the child inherits
        // the gate's group, and `process.kill(-pid)` then either misses or —
        // far worse — takes the gate and this test suite down with it.
        expect(pgid).toBe(sh);
        expect(pgid).not.toBe(gatePid);

        process.kill(gatePid, "SIGTERM");
        expect(await waitFor(() => tree.every((pid) => !alive(pid)))).toBe(
            true
        );
    });
});

describe("gate-liveness — the yield decision, pure (ADR 0136 §6, issue #3780)", () => {
    const NOW = 1_000_000;

    function waiter(over: Partial<GateWaiter> = {}): GateWaiter {
        return {
            pid: 4242,
            role: "land",
            label: "unset GITHUB_TOKEN && git fetch …",
            cwd: "/repo-issue-1",
            since: NOW - 1000,
            ...over,
        };
    }

    const decide = (waiters: GateWaiter[], yieldedMs = 0, boundMs = 60_000) =>
        yieldVerdict({
            waiters,
            yieldingSince: NOW - yieldedMs,
            now: NOW,
            boundMs,
        });

    it("acquires when nothing is queued", () => {
        expect(decide([])).toMatchObject({
            verdict: "acquire",
            bounded: false,
        });
    });

    it("yields while ANY land is queued", () => {
        const d = decide([waiter()]);
        expect(d.verdict).toBe("yield");
        expect(d.reason).toContain("pid 4242");
    });

    it("yields to a land, never to another heavy gate or to itself", () => {
        // The rule buys the LANDINGS their four minutes; an ordinary
        // `bun run test` queued behind health gets no such favour, or two
        // gates would each wait for the other to stop waiting.
        expect(decide([waiter({ role: "" })]).verdict).toBe("acquire");
        expect(decide([waiter({ role: "health" })]).verdict).toBe("acquire");
        expect(
            decide([waiter({ role: "health" }), waiter({ role: "land" })])
                .verdict
        ).toBe("yield");
    });

    it("STARVATION BOUND: past it, health takes the mutex with lands still queued", () => {
        // Unbounded yielding is not politeness, it is starvation: at the
        // measured 2.5 PR/h with three sessions there is frequently SOME land
        // in the queue, and the base tip would then never be gated at all —
        // the exposure ADR 0136 §6 exists to bound.
        expect(decide([waiter()], 59_999)).toMatchObject({
            verdict: "yield",
            bounded: false,
        });
        const d = decide([waiter()], 60_000);
        expect(d).toMatchObject({ verdict: "acquire", bounded: true });
        expect(d.reason).toContain("starvation bound");
    });

    it("`bounded` is a field, not a phrase — the ordinary acquire is quiet", () => {
        expect(decide([]).bounded).toBe(false);
        expect(decide([waiter()], 120_000).bounded).toBe(true);
    });

    it("counts down the bound it has left, so a yielding run says when it will stop", () => {
        expect(decide([waiter()], 20_000, 60_000).reason).toContain("40s");
    });
});

describe("gate.ts — the waiter registry and the yield tier (ADR 0136 §6, issue #3780)", () => {
    const waitersDir = () => join(lockRoot, "gate.waiters");

    /** A hand-written waiter entry, with a pid that is genuinely alive (this
     *  test process): the gate's own liveness pruning must not remove it. */
    function seedWaiter(role: string, pid = process.pid) {
        mkdirSync(waitersDir(), { recursive: true });
        const entry: GateWaiter = {
            pid,
            role,
            label: "seeded by the suite",
            cwd: "/repo",
            since: Date.now(),
        };
        writeFileSync(join(waitersDir(), `${pid}.json`), JSON.stringify(entry));
        return join(waitersDir(), `${pid}.json`);
    }

    it("a queued heavy gate registers itself under its role, and leaves nothing behind", async () => {
        const holder = spawn("bun", [GATE, "heavy", "sleep 30"], {
            cwd: lockRoot,
            env: env(),
            stdio: "ignore",
        });
        await waitForLock();

        const queued = spawn("bun", [GATE, "heavy", "true"], {
            cwd: lockRoot,
            env: env({ TOLARIA_GATE_ROLE: "land" }),
            stdio: "ignore",
        });
        const file = join(waitersDir(), `${queued.pid}.json`);
        expect(await waitFor(() => existsSync(file))).toBe(true);
        expect(
            (JSON.parse(readFileSync(file, "utf8")) as GateWaiter).role
        ).toBe("land");

        holder.kill("SIGTERM");
        await new Promise((r) => queued.on("exit", r));
        expect(existsSync(file)).toBe(false);
    });

    it("the yield tier steps aside while a land is queued, and runs once it is gone", async () => {
        const seeded = seedWaiter("land");
        const yielded = spawn("bun", [GATE, "yield", "echo RAN"], {
            cwd: lockRoot,
            env: env(),
            stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        yielded.stdout.on("data", (c: Buffer) => (out += c.toString()));
        yielded.stderr.on("data", (c: Buffer) => (err += c.toString()));

        // The yielding LINE is the event — not a wall-clock window in which
        // nothing happened.
        expect(await waitFor(() => err.includes("[gate] yielding"))).toBe(true);
        expect(out).not.toContain("RAN");
        // The mutex is free the whole time: yielding is not holding.
        expect(existsSync(join(lockRoot, "gate.lock"))).toBe(false);

        rmSync(seeded, { force: true });
        await new Promise((r) => yielded.on("exit", r));
        expect(out).toContain("RAN");
    });

    it("the starvation bound gets the yield tier through a permanently queued land", async () => {
        // The seeded waiter is THIS process: it never goes away, so without a
        // bound the gate yields for ever. `run`'s timeout turns that into a
        // failed assertion rather than a wedged worker.
        seedWaiter("land");
        const r = run(["yield", "echo RAN"], {
            env: env({ TOLARIA_GATE_YIELD_BOUND_MS: "0" }),
            timeout: 20_000,
        });
        expect(r.status, `signal=${r.signal} stderr=${r.stderr}`).toBe(0);
        expect(r.stdout).toContain("RAN");
        expect(r.stderr).toContain("starvation bound");
    });

    it("yields to a land and to nothing else", () => {
        seedWaiter("");
        const r = run(["yield", "echo RAN"], { timeout: 20_000 });
        expect(r.status, `signal=${r.signal} stderr=${r.stderr}`).toBe(0);
        expect(r.stdout).toContain("RAN");
    });

    it("prunes a waiter whose pid is gone — a killed session must not starve health", () => {
        // A session killed mid-queue leaves its entry behind. Without the
        // liveness prune the yield tier would step aside for a land that no
        // longer exists, for the whole bound, every time.
        const dead = spawnSync("sh", ["-c", "exit 0"]);
        const file = seedWaiter("land", dead.pid!);
        const r = run(["yield", "echo RAN"], { timeout: 20_000 });
        expect(r.status, `signal=${r.signal} stderr=${r.stderr}`).toBe(0);
        expect(r.stdout).toContain("RAN");
        expect(existsSync(file)).toBe(false);
    });

    it("the yield tier is the heavy tier in every other respect", () => {
        const r = run(
            [
                "yield",
                "echo held=[$TOLARIA_GATE_HELD] w=[$TOLARIA_VITEST_WORKERS]",
            ],
            { timeout: 20_000 }
        );
        expect(r.status, `signal=${r.signal} stderr=${r.stderr}`).toBe(0);
        expect(r.stdout).toContain("held=[1]");
        expect(r.stdout).toMatch(/w=\[[2-9]\d*\]/);
        // …the mutex included: it is released when the command finishes.
        expect(existsSync(join(lockRoot, "gate.lock"))).toBe(false);
    });

    it("`who` names the queue, not just the holder", async () => {
        const holder = spawn("bun", [GATE, "heavy", "sleep 30"], {
            cwd: lockRoot,
            env: env(),
            stdio: "ignore",
        });
        await waitForLock();
        seedWaiter("land", process.pid);
        const r = run(["who"]);
        expect(r.stdout).toContain("queued — pid");
        expect(r.stdout).toContain("[land]");
        holder.kill("SIGTERM");
        await new Promise((resolve) => holder.on("exit", resolve));
    });
});
