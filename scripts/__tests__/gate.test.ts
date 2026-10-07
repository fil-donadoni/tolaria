import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
    mkdtempSync,
    mkdirSync,
    rmSync,
    existsSync,
    utimesSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    AGE_STEP_MS,
    INITIAL_HEARTBEAT,
    POLL_GAP_FACTOR,
    STALLED_RECLAIM_MS,
    SubtreeProgress,
    TrackedTree,
    WAITER_SINCE_ENV,
    admissionOrder,
    describeClass,
    heartbeatStep,
    parseCpuMs,
    parsePsRows,
    pollGap,
    reclaimVerdict,
    reclaimableInMs,
    stallJudgeable,
    subtreeFromPs,
    survivorLines,
    waiterLive,
    waiterSince,
    type BeatVerdict,
    type GateWaiter,
} from "../lib/gate-liveness";
import { lockedEnv } from "../land";

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
    // `who` asks `gate-run.sh --list`, which REAPS (issue #4940): pointed at
    // the real run registry, this suite would kill other sessions' runs.
    const base = {
        ...process.env,
        TOLARIA_GATE_LOCK_ROOT: lockRoot,
        TOLARIA_GATE_RUN_DIR: join(lockRoot, "gate-runs"),
    };
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

/** One live (non-zombie) process, as `ps` sees it. */
interface Proc {
    pid: number;
    ppid: number;
    pgid: number;
    comm: string;
}

function procs(): Proc[] {
    const r = spawnSync("ps", ["-Ao", "pid=,ppid=,pgid=,stat=,comm="], {
        encoding: "utf8",
    });
    const out: Proc[] = [];
    for (const line of r.stdout.split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        if (!m || m[4].startsWith("Z")) continue;
        out.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            pgid: Number(m[3]),
            comm: m[5].trim(),
        });
    }
    return out;
}

/** Resolves once `child` has exited — an event, never a guessed window. */
function exited(child: ReturnType<typeof spawn>): Promise<void> {
    return new Promise((r) => {
        if (child.exitCode !== null || child.signalCode !== null) r();
        else child.on("exit", () => r());
    });
}

/** Every process a test started and must not leak — SIGSTOPped ones included,
 *  which is why this is SIGKILL: nothing else reaches a stopped process. */
let strays: number[] = [];

/**
 * `roots` and everything under them, every member SIGSTOPped before it is
 * returned (issue #4978). A gate spawns its command DETACHED, so SIGKILLing
 * the gate alone runs no teardown and reparents that command to launchd,
 * where no parentage walk can find it again. Frozen first, the tree can
 * neither fork past the walk nor lose a member to reparenting; the walk
 * repeats until a round finds nobody new.
 */
function frozenTree(roots: number[]): number[] {
    const seen = new Set<number>();
    // A root already gone may be a recycled pid by now: walking it would
    // freeze an unrelated subtree.
    let frontier = roots.filter(alive);
    while (frontier.length) {
        for (const pid of frontier) {
            seen.add(pid);
            try {
                process.kill(pid, "SIGSTOP");
            } catch {
                /* already gone */
            }
        }
        frontier = [...new Set(frontier.flatMap(descendants))].filter(
            (pid) => !seen.has(pid)
        );
    }
    return [...seen];
}

/** Live processes whose command line names `path` — the test's own commands
 *  all embed `lockRoot`, so after cleanup this must come back empty. */
function naming(path: string): { pid: number; args: string }[] {
    const r = spawnSync("ps", ["-Ao", "pid=,stat=,args="], {
        encoding: "utf8",
    });
    const out: { pid: number; args: string }[] = [];
    for (const line of r.stdout.split("\n")) {
        const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        if (!m || m[2].startsWith("Z") || !m[3].includes(path)) continue;
        if (Number(m[1]) !== process.pid)
            out.push({ pid: Number(m[1]), args: m[3] });
    }
    return out;
}

beforeEach(() => {
    lockRoot = mkdtempSync(join(tmpdir(), "tolaria-gate-test-"));
});

afterEach(async () => {
    for (const pid of frozenTree(strays)) {
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            /* already gone */
        }
    }
    strays = [];
    // A failing test exits before it lets its commands go: whatever still
    // names `lockRoot` once the tree is dead would poll a deleted directory
    // forever (issue #4978). Killed so the run leaks nothing — and a red, so
    // the cleanup that missed it is fixed rather than outlived.
    const root = lockRoot;
    await waitFor(() => naming(root).length === 0, 5_000);
    const survivors = naming(root);
    for (const { pid } of survivors) {
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            /* already gone */
        }
    }
    rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
    expect(survivors, "processes outlived the test's cleanup").toEqual([]);
    // Above vitest's 10 s default: the survivor wait alone is 5 s, plus the
    // `ps` walks, on a loaded machine.
}, 30_000);

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

    it("a holder frees only a lock it can read as its own (issue #4965)", () => {
        // The reclaimer of a stalled holder takes the mutex at the moment the
        // holder's child dies and the holder releases: "no readable owner"
        // must never be read as "mine to delete".
        const lock = join(lockRoot, "gate.lock");
        const r = run(["heavy", `rm ${join(lock, "owner.json")}`]);
        expect(r.status, r.stderr).toBe(0);
        expect(existsSync(lock)).toBe(true);
        // …and what it leaves is an orphan the next gate reclaims, once it
        // is old enough to be one (next test).
        const next = run(["heavy", "echo OK"], {
            env: env({ TOLARIA_GATE_OWNERLESS_GRACE_MS: "0" }),
        });
        expect(next.stdout).toContain("OK");
        expect(next.stderr).toContain("no readable owner");
        expect(existsSync(lock)).toBe(false);
    });

    it("a lock with no owner is a gate mid-acquire while it is young, an orphan only once it is old (issue #4965)", async () => {
        // `mkdir`, then the owner stamp: for an instant every acquisition is
        // a lock directory with nothing in it. Reclaimed on sight, that is a
        // second gate under the mutex.
        const lock = join(lockRoot, "gate.lock");
        mkdirSync(lock);
        const waiter = spawn("bun", [GATE, "heavy", "echo RAN"], {
            cwd: lockRoot,
            // The grace is the default five seconds; the poll is fast, so
            // "still waiting" is many rounds, not one slow one.
            env: env({ TOLARIA_GATE_POLL_MS: "50" }),
            stdio: ["ignore", "pipe", "pipe"],
        });
        strays.push(waiter.pid!);
        let out = "";
        let err = "";
        waiter.stdout.on("data", (c: Buffer) => (out += c.toString()));
        waiter.stderr.on("data", (c: Buffer) => (err += c.toString()));

        expect(await waitFor(() => err.includes("with no owner yet"))).toBe(
            true
        );
        expect(err).not.toContain("reclaiming");
        expect(out).not.toContain("RAN");

        // The same directory, an hour old: nobody is coming to stamp it.
        const hourAgo = new Date(Date.now() - 3_600_000);
        utimesSync(lock, hourAgo, hourAgo);
        await exited(waiter);
        expect(err).toContain("no readable owner");
        expect(out).toContain("RAN");
    }, 60_000);

    it("prunes a lock whose holder is dead instead of waiting for it", () => {
        // An owner whose pid is gone is an orphan: the acquirer must prune it
        // rather than block forever. (A lock with NO owner is the next-but-
        // one test: an orphan too, but only once it is old enough.)
        const dead = spawnSync("sh", ["-c", "exit 0"]);
        mkdirSync(join(lockRoot, "gate.lock"), { recursive: true });
        writeFileSync(
            join(lockRoot, "gate.lock", "owner.json"),
            JSON.stringify({
                pid: dead.pid,
                label: "a gate that was killed",
                cwd: "/repo",
                ts: Date.now(),
            })
        );
        const r = run(["heavy", "echo acquired"]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("acquired");
        expect(r.stderr).toContain("holder is gone");
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

    it("a declared stall stands while the total is flat or unmeasurable, and a MEASURED rise withdraws it (issue #4965)", () => {
        // It used to latch for good. With the reclaimer killing a stalled
        // subtree, a latch would kill a run that resumed minutes earlier.
        expect(beats([700, 700, 700, 700, 700, null, 9000, 9999])).toEqual([
            "progress",
            "silent",
            "silent",
            "stalled",
            "latched",
            "latched", // no evidence is not a recovery
            "recovered",
            "progress",
        ]);
        // …and a recovered holder can stall again, from a fresh count.
        expect(beats([1, 1, 1, 1, 2, 2, 2, 2])).toEqual([
            "progress",
            "silent",
            "silent",
            "stalled",
            "recovered",
            "silent",
            "silent",
            "stalled",
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

    it("a DECLARED stall is reclaimable after the short threshold, not after STALE_MS (issue #4965)", () => {
        const now = 10_000_000;
        const stale = 45 * 60 * 1000;
        const short = STALLED_RECLAIM_MS;
        expect(short).toBe(5 * 60 * 1000);
        // The stamp itself is nowhere near stale: only the declaration counts.
        const declared = (agoMs: number) => ({
            ts: now - 60_000,
            stalledAt: now - agoMs,
        });
        expect(reclaimVerdict(declared(short + 1), true, now, stale)).toBe(
            "stalled"
        );
        expect(reclaimVerdict(declared(short), true, now, stale)).toBeNull();
        expect(reclaimVerdict(declared(0), true, now, stale)).toBeNull();
        // A dead pid is an orphan whatever it declared.
        expect(reclaimVerdict(declared(0), false, now, stale)).toBe("dead");
        // The threshold is a parameter, which is what the wiring test drives.
        expect(reclaimVerdict(declared(50), true, now, stale, 10)).toBe(
            "stalled"
        );
        // `gate:who` prints the SAME number the verdict branches on: the
        // sooner of the two thresholds, negative once reclaimable.
        expect(reclaimableInMs(declared(1000), now, stale)).toBe(short - 1000);
        expect(reclaimableInMs({ ts: now - 1000 }, now, stale)).toBe(
            stale - 1000
        );
        expect(
            reclaimableInMs(
                { ts: now - stale - 5, stalledAt: now - 1 },
                now,
                stale
            )
        ).toBe(-5);
    });

    it("a waiter that was not running judges no stall until it has polled a full beat (issue #4965)", () => {
        const poll = 2000;
        const t = 50_000_000;
        // Jitter and a loaded machine are not a gap; a closed lid is.
        expect(pollGap(t, t + poll * 1.25, poll)).toBe(false);
        expect(pollGap(t, t + POLL_GAP_FACTOR * poll, poll)).toBe(false);
        expect(pollGap(t, t + POLL_GAP_FACTOR * poll + 1, poll)).toBe(true);
        expect(pollGap(t, t + 60 * 60_000, poll)).toBe(true);
        // Never paused: judge at once. Paused: only after the settle time.
        const settle = 5 * 60_000;
        expect(stallJudgeable(null, t, settle)).toBe(true);
        expect(stallJudgeable(t, t, settle)).toBe(false);
        expect(stallJudgeable(t, t + settle - 1, settle)).toBe(false);
        expect(stallJudgeable(t, t + settle, settle)).toBe(true);
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

    it("a stalled holder is reclaimed after the SHORT threshold, and its subtree is dead before the lock changes hands (issue #4965)", async () => {
        const { child, out } = spawnSilentHolder();
        strays.push(child.pid!);
        expect(await waitFor(() => out.err.includes("STALLED"))).toBe(true);
        // The hung command: what used to keep running, with its workers,
        // under whoever took the mutex next.
        const tree = descendants(child.pid!);
        strays.push(...tree);
        expect(tree.length).toBeGreaterThanOrEqual(1);

        // STALE_MS is left at its 45 min: only the stall DECLARATION can make
        // this lock reclaimable, so a reclaimer that runs proves the short
        // threshold. And the proof of ORDER is the reclaimer's own command —
        // it runs under the mutex it just took, and looks. It then HOLDS
        // until the test lets go, so the stalled holder ends while the lock
        // is the reclaimer's. The hold is bounded (600 x 0.1 s, the test's
        // own timeout): a cleanup that missed it still ends (issue #4978).
        const letGo = join(lockRoot, "let-go");
        const probe = `for p in ${tree.join(" ")}; do ps -o stat= -p $p; done | grep -v Z | grep -q . && echo SUBTREE-ALIVE || echo SUBTREE-DEAD; i=0; while [ ! -f ${letGo} ] && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done`;
        const reclaimer = spawn("bun", [GATE, "heavy", probe], {
            cwd: lockRoot,
            env: env({ TOLARIA_GATE_STALLED_RECLAIM_MS: "1" }),
            stdio: ["ignore", "pipe", "pipe"],
        });
        strays.push(reclaimer.pid!);
        const got = { out: "", err: "" };
        reclaimer.stdout.on("data", (c: Buffer) => (got.out += c.toString()));
        reclaimer.stderr.on("data", (c: Buffer) => (got.err += c.toString()));

        expect(
            await waitFor(() => got.out.includes("SUBTREE-"), 30_000),
            got.err
        ).toBe(true);
        expect(got.out).toContain("SUBTREE-DEAD");
        expect(got.err).toContain("STALLED holder");
        expect(got.err).toContain("killed the stalled subtree");

        // The holder was never signalled: its child died, so it ends by
        // itself. The lock is the reclaimer's by then, and still is once
        // the holder is gone. (A sanity check, not the guard on `release()`:
        // the holder normally exits before the reclaimer acquires. The guard
        // is "a holder frees only a lock it can read as its own".)
        await exited(child);
        const owner = JSON.parse(
            readFileSync(join(lockRoot, "gate.lock", "owner.json"), "utf8")
        ) as { pid: number };
        expect(owner.pid).toBe(reclaimer.pid);

        writeFileSync(letGo, "");
        await exited(reclaimer);
        expect(existsSync(join(lockRoot, "gate.lock"))).toBe(false);
    }, 60_000);

    it("a stalled holder that burns CPU again withdraws its declaration and keeps the mutex (issue #4965)", async () => {
        // Frozen until the test says go, then busy: the command that "came
        // back". Before, the stall latched and the reclaimer killed it.
        // Blocked on a FIFO, not polling for a file: a blocked read burns NO
        // CPU, where a `sleep` loop ticks `ps` over every couple of seconds
        // and would recover by itself. The open blocks until cleanup kills
        // it; the spin after it ends by itself at 60 s (issue #4978).
        const go = join(lockRoot, "go");
        expect(spawnSync("mkfifo", [go]).status).toBe(0);
        const child = spawn(
            "bun",
            [
                GATE,
                "heavy",
                `read _ < ${go}; while [ $SECONDS -lt 60 ]; do :; done`,
            ],
            {
                cwd: lockRoot,
                env: stallEnv(),
                stdio: ["ignore", "ignore", "pipe"],
            }
        );
        strays.push(child.pid!);
        let err = "";
        child.stderr.on("data", (d: Buffer) => (err += d.toString()));
        const owner = () =>
            JSON.parse(
                readFileSync(join(lockRoot, "gate.lock", "owner.json"), "utf8")
            ) as { ts: number; stalledAt?: number };

        expect(await waitFor(() => err.includes("STALLED"))).toBe(true);
        expect(
            await waitFor(() => {
                try {
                    return owner().stalledAt !== undefined;
                } catch {
                    return false;
                }
            })
        ).toBe(true);
        const stalledTs = owner().ts;
        strays.push(...descendants(child.pid!));

        expect(err).not.toContain("RECOVERED");
        writeFileSync(go, "go\n");
        expect(await waitFor(() => err.includes("RECOVERED"))).toBe(true);
        expect(owner().stalledAt).toBeUndefined();
        expect(owner().ts).toBeGreaterThan(stalledTs);
    }, 60_000);

    it("a waiter that was paused — a slept machine — does not reclaim a holder on stamps that aged while it was not running (issue #4965)", async () => {
        // A live holder, stamped now. Nothing here is a gate: the test plays
        // the holder, so it decides exactly what the stamp says and when.
        const holder = spawn("sleep", ["60"]);
        strays.push(holder.pid!);
        const lock = join(lockRoot, "gate.lock");
        const stamp = (ts: number) =>
            writeFileSync(
                join(lock, "owner.json"),
                JSON.stringify({
                    pid: holder.pid,
                    label: "a healthy land",
                    cwd: "/repo",
                    ts,
                    acquiredAt: ts,
                })
            );
        mkdirSync(lock);
        stamp(Date.now());

        const POLL = 100;
        const waiter = spawn("bun", [GATE, "heavy", "echo RAN"], {
            cwd: lockRoot,
            env: env({ TOLARIA_GATE_POLL_MS: String(POLL) }),
            stdio: ["ignore", "pipe", "pipe"],
        });
        strays.push(waiter.pid!);
        let out = "";
        let err = "";
        waiter.stdout.on("data", (c: Buffer) => (out += c.toString()));
        waiter.stderr.on("data", (c: Buffer) => (err += c.toString()));
        expect(await waitFor(() => err.includes("a healthy land"))).toBe(true);

        // The lid closes: the waiter stops, and wall-clock time runs on —
        // an hour of it, as far as the holder's stamp can tell.
        process.kill(waiter.pid!, "SIGSTOP");
        const stoppedAt = Date.now();
        stamp(Date.now() - 3_600_000);
        // A FLOOR, not a window: the pause must be long enough to be a gap,
        // and a longer one is only more of the same.
        await waitFor(
            () => Date.now() - stoppedAt > 2 * POLL_GAP_FACTOR * POLL
        );
        process.kill(waiter.pid!, "SIGCONT");

        expect(await waitFor(() => err.includes("resumed after"))).toBe(true);
        // It polls on — the "resumed" line is one round, these are more —
        // and the hour-old stamp of a live holder is not acted on.
        const waiterFile = join(lockRoot, "gate.waiters", `${waiter.pid}.json`);
        const stamps = new Set<number>();
        const resumedAt = Date.now();
        expect(
            await waitFor(() => {
                try {
                    const seen = (
                        JSON.parse(readFileSync(waiterFile, "utf8")) as {
                            seen: number;
                        }
                    ).seen;
                    if (seen > resumedAt) stamps.add(seen);
                } catch {
                    /* gone: it acquired — the assertion below says so */
                }
                return stamps.size >= 3;
            })
        ).toBe(true);
        expect(err).not.toContain("reclaiming");
        expect(out).not.toContain("RAN");
    }, 60_000);

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

    it("a SIGTERMed holder reaps a NESTED gate's tree — a second process group — before it frees the lock (issue #4965)", async () => {
        // The observed orphan: `land` holds the mutex and runs `bun run test`,
        // i.e. a nested `gate.ts heavy`, which detaches ITS child into a new
        // process group. The holder signalled its one group, released, and a
        // vitest with four workers ran on under the next holder.
        const gate = spawn(
            "bun",
            [GATE, "heavy", `bun ${GATE} heavy 'sleep 120'`],
            { cwd: lockRoot, env: env(), stdio: ["ignore", "ignore", "pipe"] }
        );
        let gateErr = "";
        gate.stderr.on("data", (c: Buffer) => (gateErr += c.toString()));
        const gatePid = gate.pid!;
        strays.push(gatePid);

        // The tree is built once the sleeper runs in a group that is not the
        // outer child's — anything less and the assertion below would pass on
        // a tree with nothing nested in it.
        let tree: Proc[] = [];
        const nestedSleeper = () => {
            const all = procs();
            const ids = new Set(descendants(gatePid));
            tree = all.filter((p) => ids.has(p.pid));
            const outer = tree.find((p) => p.ppid === gatePid);
            return tree.some(
                (p) =>
                    p.comm.endsWith("sleep") &&
                    outer !== undefined &&
                    p.pgid !== outer.pgid
            );
        };
        expect(await waitFor(nestedSleeper)).toBe(true);
        strays.push(...tree.map((p) => p.pid));
        const pids = new Set(tree.map((p) => p.pid));
        const groups = new Set(tree.map((p) => p.pgid));
        expect(groups.size).toBeGreaterThanOrEqual(2);

        // The signal a session teardown sends: the holder's pid alone.
        process.kill(gatePid, "SIGTERM");
        await exited(gate);

        // The holder exits only after it has SEEN the tree gone, so the very
        // first look must find nothing, in either group. The one exception
        // is a machine so loaded that the teardown ran out its own bound —
        // which the gate says, and which is then a matter of waiting.
        const alive = () =>
            procs().filter((p) => pids.has(p.pid) || groups.has(p.pgid));
        if (gateErr.includes("could NOT confirm"))
            await waitFor(() => alive().length === 0);
        const survivors = alive();
        expect(survivors).toEqual([]);
        expect(existsSync(join(lockRoot, "gate.lock"))).toBe(false);
    }, 60_000);

    it("an unconfirmed teardown names every survivor of its last pass — pid, stat, command; a confirmed one names nothing (issue #4976)", async () => {
        // A survivor cannot be made for real: SIGKILL is not ignorable, and a
        // process in a protected group is reached by pid. So the gate's `ps`
        // is wrapped — the real rows plus, once the test plants it, one row
        // that never leaves, sitting in the wrapped child's group.
        const bin = join(lockRoot, "bin");
        mkdirSync(bin);
        const planted = join(lockRoot, "planted-row");
        const realPs = spawnSync("which", ["ps"], {
            encoding: "utf8",
        }).stdout.trim();
        writeFileSync(
            join(bin, "ps"),
            [
                "#!/bin/sh",
                `'${realPs}' "$@" || exit $?`,
                `case "$*" in *stat=*) cat '${planted}' 2>/dev/null ;; esac`,
                "exit 0",
                "",
            ].join("\n"),
            { mode: 0o755 }
        );

        const teardown = async (plant: boolean) => {
            const gate = spawn("bun", [GATE, "light", "sleep 120"], {
                cwd: tmpdir(),
                env: env({
                    PATH: `${bin}:${process.env.PATH}`,
                    TOLARIA_GATE_KILL_GRACE_MS: "100",
                }),
                stdio: ["ignore", "ignore", "pipe"],
            });
            let err = "";
            gate.stderr.on("data", (c: Buffer) => (err += c.toString()));
            const gatePid = gate.pid!;
            strays.push(gatePid);
            // The wrapped command: the gate's child that leads its own group.
            let root: Proc | undefined;
            const wrapped = () =>
                (root = procs().find(
                    (p) => p.ppid === gatePid && p.pgid === p.pid
                )) !== undefined;
            expect(await waitFor(wrapped)).toBe(true);
            strays.push(...descendants(gatePid));
            // The planted pid is never signalled: its group is one the
            // teardown signals as a group, so no kill goes to 999999 by pid —
            // above macOS's pid ceiling, and harmless where one could exist.
            if (plant)
                writeFileSync(
                    planted,
                    `999999     1 ${root!.pid} E    planted-survivor --never-dies\n`
                );
            process.kill(gatePid, "SIGTERM");
            await exited(gate);
            return { err, root: root!.pid };
        };

        const stuck = await teardown(true);
        expect(stuck.err).toContain(
            `could NOT confirm the tree of pid ${stuck.root} is gone (SIGTERM)`
        );
        expect(stuck.err).toContain(
            `survivor pid 999999 ppid 1 pgid ${stuck.root} stat E — planted-survivor --never-dies`
        );

        // The same wrapped `ps`, nothing planted: survivors are named exactly
        // when the teardown went unconfirmed — which a machine loaded past
        // the teardown's own bound can still make it, and then says so.
        rmSync(planted);
        const calm = await teardown(false);
        expect(calm.err).not.toContain("999999");
        expect(calm.err.includes("survivor")).toBe(
            calm.err.includes("could NOT confirm")
        );
    }, 60_000);

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

describe("gate.ts — a gate whose cwd is removed under it (issue #4974)", () => {
    /**
     * `land` deletes its own worktree when it merges, and that worktree is the
     * cwd of the `gate.ts heavy` holding the mutex. Bun cannot spawn from a
     * cwd that no longer exists, so every `ps` after the removal failed: the
     * teardown fell back to its blind group signal and printed `could NOT
     * confirm` on every `land`, and the heartbeat read the subtree as
     * unmeasurable — which never stalls.
     */
    function holderIn(dir: string, command: string, extraEnv = {}) {
        const gate = spawn("bun", [GATE, "heavy", command], {
            cwd: dir,
            env: env(extraEnv),
            stdio: ["ignore", "ignore", "pipe"],
        });
        const out = { err: "" };
        gate.stderr.on("data", (c: Buffer) => (out.err += c.toString()));
        strays.push(gate.pid!);
        return { gate, out };
    }

    it("the exit-path teardown still walks and verifies the tree", async () => {
        const dir = join(lockRoot, "worktree");
        mkdirSync(dir);
        const pidFile = join(lockRoot, "sleeper.pid");
        // The sleeper stays in the child's group after the shell exits — the
        // shape of a worker outliving its command. Its stdio is detached so
        // the gate's stderr closes when the gate exits, not when it does.
        const { gate, out } = holderIn(
            dir,
            `sleep 120 >/dev/null 2>&1 & echo $! >'${pidFile}'; rm -rf "$PWD"`
        );
        await new Promise<void>((r) => gate.on("close", () => r()));
        const sleeper = Number(readFileSync(pidFile, "utf8").trim());
        strays.push(sleeper);
        expect(existsSync(dir)).toBe(false);
        expect(out.err).not.toContain("could NOT confirm");
        // Verified gone before exit: the very first look finds it dead.
        expect(alive(sleeper)).toBe(false);
    }, 60_000);

    it("the heartbeat still measures the subtree — a silent command is declared STALLED", async () => {
        const dir = join(lockRoot, "worktree");
        mkdirSync(dir);
        const { gate, out } = holderIn(dir, `rm -rf "$PWD"; sleep 60`, {
            TOLARIA_GATE_HEARTBEAT_MS: "150",
            TOLARIA_GATE_STALL_BEATS: "2",
        });
        try {
            expect(await waitFor(() => out.err.includes("STALLED"))).toBe(true);
        } finally {
            // SIGTERM, not SIGKILL: the gate's own teardown takes the sleeper.
            gate.kill("SIGTERM");
        }
        await exited(gate);
    }, 60_000);
});

describe("gate-liveness — the admission order, pure (issue #4965)", () => {
    const NOW = 100 * AGE_STEP_MS;

    function waiter(over: Partial<GateWaiter> = {}): GateWaiter {
        return {
            pid: 4242,
            role: "",
            tier: "heavy",
            label: "bun run test",
            cwd: "/repo",
            since: NOW,
            ...over,
        };
    }

    const land = (pid: number, queuedMs = 0) =>
        waiter({ pid, role: "land", since: NOW - queuedMs });
    const job = (pid: number, queuedMs = 0) =>
        waiter({ pid, tier: "job", since: NOW - queuedMs });
    const heavy = (pid: number, queuedMs = 0) =>
        waiter({ pid, since: NOW - queuedMs });
    const health = (pid: number, queuedMs = 0) =>
        waiter({ pid, role: "health", tier: "yield", since: NOW - queuedMs });
    const pids = (ws: GateWaiter[], now = NOW) =>
        admissionOrder(ws, now).map((w) => w.pid);

    it("a waiter's `since` is the caller's when it names a past one, and never the future (issue #4988)", () => {
        const since = (v?: string) =>
            waiterSince(v === undefined ? {} : { [WAITER_SINCE_ENV]: v }, NOW);
        expect(since()).toBe(NOW);
        expect(since(String(NOW - 115_000))).toBe(NOW - 115_000);
        // Ahead of the clock it would sort behind waiters arriving later.
        expect(since(String(NOW + 60_000))).toBe(NOW);
        for (const junk of ["", "0", "-5", "soon"])
            expect(since(junk), junk).toBe(NOW);
    });

    it("land > job > heavy > health, whatever order they arrived in", () => {
        // Arrival order is the exact reverse of the admission order.
        expect(
            pids([health(1, 4000), heavy(2, 3000), job(3, 2000), land(4, 1000)])
        ).toEqual([4, 3, 2, 1]);
    });

    it("inside one class the longest-queued goes first, and a tie falls to the pid", () => {
        expect(pids([land(7, 100), land(8, 900), land(9, 500)])).toEqual([
            8, 9, 7,
        ]);
        expect(pids([land(31), land(30)])).toEqual([30, 31]);
    });

    it("the order is a property of the registry, not of who reads it", () => {
        const a = [health(1, 9000), land(2, 10), land(3, 20)];
        expect(pids(a)).toEqual(pids([...a].reverse()));
        expect(pids(a)).toEqual([3, 2, 1]);
    });

    it("the health class is the role OR the `yield` spelling; a land is a land under any tier", () => {
        expect(describeClass(waiter({ role: "health" }), NOW)).toBe("health");
        expect(describeClass(waiter({ tier: "yield" }), NOW)).toBe("health");
        expect(describeClass(waiter({ role: "land", tier: "job" }), NOW)).toBe(
            "land"
        );
        expect(describeClass(waiter({ tier: "job" }), NOW)).toBe("job");
        // An entry written by a gate that predates `tier` is a plain heavy.
        expect(describeClass(waiter({ tier: undefined }), NOW)).toBe("heavy");
    });

    it("AGEING: a waiter rises one class per 30 min queued — health cannot starve", () => {
        const lands = [land(2, 1000), land(3, 500)];
        // Under one step health is still last; each step lifts it one class.
        expect(pids([health(1, AGE_STEP_MS - 1), ...lands])).toEqual([2, 3, 1]);
        expect(pids([health(1, AGE_STEP_MS), heavy(4), job(5)])).toEqual([
            5, 1, 4,
        ]);
        expect(pids([health(1, 2 * AGE_STEP_MS), heavy(4), job(5)])).toEqual([
            1, 5, 4,
        ]);
        // Three steps: a land's equal — and older than every land queued.
        expect(pids([...lands, health(1, 3 * AGE_STEP_MS)])).toEqual([1, 2, 3]);
        expect(describeClass(health(1, 3 * AGE_STEP_MS), NOW)).toBe(
            "health, aged to land"
        );
    });

    it("ageing stops at the best class: a land that waited longer still goes first", () => {
        expect(
            pids([health(1, 5 * AGE_STEP_MS), land(2, 6 * AGE_STEP_MS)])
        ).toEqual([2, 1]);
    });

    it("a waiter is queued while its pid lives AND it keeps polling — not by how long it has queued", () => {
        const stale = 60_000;
        const w = { since: NOW - 2 * AGE_STEP_MS, seen: NOW - 1000 };
        // An hour in the queue is a legitimate wait under ageing.
        expect(waiterLive(w, true, NOW, stale)).toBe(true);
        expect(waiterLive(w, false, NOW, stale)).toBe(false);
        // A reused pid, or a stopped process: alive, and silent.
        expect(
            waiterLive({ ...w, seen: NOW - stale - 1 }, true, NOW, stale)
        ).toBe(false);
        // An entry with no `seen` (an older gate's) is judged on `since`.
        expect(waiterLive({ since: NOW - 1000 }, true, NOW, stale)).toBe(true);
        expect(waiterLive({ since: NOW - stale - 1 }, true, NOW, stale)).toBe(
            false
        );
    });
});

describe("gate-liveness — the tree a teardown kills, pure (issue #4965)", () => {
    // pid ppid pgid stat — the observed shape: a holder (50) whose child (60)
    // runs a NESTED gate (62) that detached its own child (70) into group 70.
    const PS = [
        "    1     0     1 Ss",
        "   50     1    50 S", //   the holder gate, in the session's group
        "   60    50    60 Ss", //  its child `sh` — leader of group 60
        "   61    60    60 S", //   bun run test
        "   62    61    60 S", //   the nested gate
        "   70    62    70 Ss", //  the nested gate's child — leader of group 70
        "   71    70    70 R", //   a vitest worker
        "   90    50    50 R", //   the holder's own `ps`
        "  200     1   200 S", //   another session entirely
        "garbage",
    ].join("\n");

    it("parses pid, ppid, pgid, the state and the command line; garbage is no row, nothing is null", () => {
        const rows = parsePsRows(
            [
                PS,
                "   99    50    60 Z+   <defunct>",
                "   72    70    70 R+   node /a b/vitest.mjs run  ",
            ].join("\n")
        )!;
        expect(rows).toHaveLength(11);
        // A row with no command column is still a row.
        expect(rows.find((r) => r.pid === 71)).toEqual({
            pid: 71,
            ppid: 70,
            pgid: 70,
            zombie: false,
            stat: "R",
            command: "",
        });
        // The command keeps its inner spaces — it is the last column.
        expect(rows.find((r) => r.pid === 72)).toMatchObject({
            stat: "R+",
            command: "node /a b/vitest.mjs run",
        });
        expect(rows.find((r) => r.pid === 99)).toMatchObject({
            zombie: true,
            stat: "Z+",
        });
        expect(parsePsRows("no rows here")).toBeNull();
    });

    it("names a survivor by pid, parentage, group, state and command; a long command is cut, a missing pass is said (issue #4976)", () => {
        const rows = parsePsRows(
            [
                "   71     1    70 E    (bun)",
                `   72     1    70 U    ${"x".repeat(400)}`,
                "   73     1    70 R",
            ].join("\n")
        )!;
        const lines = survivorLines(rows);
        expect(lines).toHaveLength(3);
        expect(lines[0]).toBe(
            "[gate]   survivor pid 71 ppid 1 pgid 70 stat E — (bun)"
        );
        expect(lines[1]).toBe(
            `[gate]   survivor pid 72 ppid 1 pgid 70 stat U — ${"x".repeat(160)}…`
        );
        expect(lines[2]).toContain("stat R — (no command)");
        expect(survivorLines(null)).toEqual([
            "[gate]   no survivor can be named — `ps` gave no rows",
        ]);
    });

    it("walks into the nested gate's group — the one the outer group signal never reached", () => {
        const tree = new TrackedTree(60, new Set([50]));
        const live = tree.absorb(parsePsRows(PS)!);
        expect(live.map((r) => r.pid).sort()).toEqual([60, 61, 62, 70, 71]);
        expect([...tree.groups].sort()).toEqual([60, 70]);
    });

    it("keeps hold of a group once the parents the walk went through are dead", () => {
        const tree = new TrackedTree(60, new Set([50]));
        tree.absorb(parsePsRows(PS)!);
        // The signal landed: 60–62 and 70 are gone, the worker was reparented
        // to pid 1. No parent link leads to it any more; its group does.
        const after = ["   50     1    50 S", "   71     1    70 R"].join("\n");
        expect(tree.absorb(parsePsRows(after)!).map((r) => r.pid)).toEqual([
            71,
        ]);
        expect(tree.absorb(parsePsRows("   50     1    50 S")!)).toEqual([]);
    });

    it("a root that already exited is still reached through the group it led", () => {
        // The normal-exit path: `sh` is gone, a backgrounded child lives on.
        const tree = new TrackedTree(60);
        const rows = parsePsRows("   65     1    60 S\n  200     1   200 S")!;
        expect(tree.absorb(rows).map((r) => r.pid)).toEqual([65]);
    });

    it("a zombie is not a survivor — a holder blocked in its teardown cannot reap its own child", () => {
        const tree = new TrackedTree(60);
        expect(tree.absorb(parsePsRows("   60    50    60 Z")!)).toEqual([]);
    });

    it("never adopts a protected group: the signaller's own is not a target", () => {
        // A descendant that stayed in the holder's group (50) is reached by
        // pid; group 50 — the gate, its session — is never signalled whole.
        const rows = parsePsRows(
            [
                "   50     1    50 S",
                "   60    50    60 S",
                "   63    60    50 S",
            ].join("\n")
        )!;
        const tree = new TrackedTree(60, new Set([50]));
        expect(
            tree
                .absorb(rows)
                .map((r) => r.pid)
                .sort()
        ).toEqual([60, 63]);
        expect([...tree.groups]).toEqual([60]);
    });
});

describe("gate.ts — the queue: ordered admission (issue #4965)", () => {
    const waitersDir = () => join(lockRoot, "gate.waiters");
    const waiterPath = (pid: number) => join(waitersDir(), `${pid}.json`);

    /** A hand-written queue entry. `seen` sits an hour in the future, so it
     *  never reads as a waiter that stopped polling — the suite, not a
     *  clock, decides when it leaves. */
    function seedWaiter(over: Partial<GateWaiter> & { pid: number }) {
        mkdirSync(waitersDir(), { recursive: true });
        const entry: GateWaiter = {
            role: "",
            tier: "heavy",
            label: "seeded by the suite",
            cwd: "/repo",
            since: Date.now(),
            seen: Date.now() + 3_600_000,
            ...over,
        };
        writeFileSync(waiterPath(over.pid), JSON.stringify(entry));
        return waiterPath(over.pid);
    }

    function readWaiter(pid: number): GateWaiter | null {
        try {
            return JSON.parse(
                readFileSync(waiterPath(pid), "utf8")
            ) as GateWaiter;
        } catch {
            return null;
        }
    }

    /**
     * True once `pid` has gone round its poll loop TWICE after `after` and is
     * still queued. One stamp past `after` says a poll BEGAN on the state the
     * test set up; the second says that poll ended without taking the mutex
     * (a waiter that acquires removes its entry). This is the suite's
     * condition for "it looked at a free mutex and did not take it" — an
     * event, where "nothing happened for N ms" would be a race.
     */
    async function polledTwiceSince(pid: number, after: number) {
        const stamps = new Set<number>();
        return waitFor(() => {
            const seen = readWaiter(pid)?.seen;
            if (seen !== undefined && seen > after) stamps.add(seen);
            return stamps.size >= 2;
        });
    }

    /** A real queued gate that appends its name to `order.log` when it runs.
     *  `queuedAgoMs` is the injected clock: when it ENTERED the queue. */
    function queue(
        name: string,
        tier: "heavy" | "yield" | "job",
        role: string,
        queuedAgoMs: number
    ) {
        const child = spawn(
            "bun",
            [GATE, tier, `echo ${name} >> ${join(lockRoot, "order.log")}`],
            {
                cwd: lockRoot,
                env: env({
                    TOLARIA_GATE_ROLE: role,
                    TOLARIA_GATE_WAITER_SINCE: String(Date.now() - queuedAgoMs),
                    // A SIGSTOPped waiter stops stamping; it must stay in
                    // the queue for as long as the test keeps it frozen.
                    TOLARIA_GATE_WAITER_STALE_MS: "3600000",
                    // Poll rounds are what these tests wait for; the period
                    // changes how long that takes, never what is decided.
                    TOLARIA_GATE_POLL_MS: "100",
                }),
                stdio: "ignore",
            }
        );
        strays.push(child.pid!);
        return child;
    }

    function spawnHolder() {
        const holder = spawn("bun", [GATE, "heavy", "sleep 60"], {
            cwd: lockRoot,
            env: env(),
            stdio: "ignore",
        });
        strays.push(holder.pid!);
        return holder;
    }

    const ranOrder = () =>
        readFileSync(join(lockRoot, "order.log"), "utf8").trim().split("\n");
    const nothingRan = () => !existsSync(join(lockRoot, "order.log"));

    it("three waiters behind a holder acquire land, land, health — even when health is the only one polling a free mutex", async () => {
        const holder = spawnHolder();
        await waitForLock();
        // Health entered the queue FIRST: any first-come order runs it first.
        const health = queue("health", "yield", "health", 30_000);
        const landA = queue("landA", "heavy", "land", 20_000);
        const landB = queue("landB", "heavy", "land", 10_000);
        const all = [health, landA, landB];
        expect(
            await waitFor(() => all.every((w) => readWaiter(w.pid!) !== null))
        ).toBe(true);

        // The WORST poll timing there is: both lands frozen, so the lowest
        // class is the only waiter that polls when the mutex comes free.
        process.kill(landA.pid!, "SIGSTOP");
        process.kill(landB.pid!, "SIGSTOP");
        holder.kill("SIGTERM");
        await exited(holder);
        expect(await polledTwiceSince(health.pid!, Date.now())).toBe(true);
        expect(nothingRan()).toBe(true);

        // The younger land thaws alone: it is not the head either.
        process.kill(landB.pid!, "SIGCONT");
        expect(await polledTwiceSince(landB.pid!, Date.now())).toBe(true);
        expect(nothingRan()).toBe(true);

        process.kill(landA.pid!, "SIGCONT");
        await Promise.all(all.map(exited));
        expect(ranOrder()).toEqual(["landA", "landB", "health"]);
    }, 90_000);

    it("with ageing injected, health goes first — the lands poll a free mutex and leave it", async () => {
        const holder = spawnHolder();
        await waitForLock();
        // 91 min queued: three classes of ageing, a land's equal and older.
        const health = queue(
            "health",
            "yield",
            "health",
            3 * AGE_STEP_MS + 60_000
        );
        const landA = queue("landA", "heavy", "land", 20_000);
        const landB = queue("landB", "heavy", "land", 10_000);
        const all = [health, landA, landB];
        expect(
            await waitFor(() => all.every((w) => readWaiter(w.pid!) !== null))
        ).toBe(true);

        process.kill(health.pid!, "SIGSTOP");
        holder.kill("SIGTERM");
        await exited(holder);
        const freed = Date.now();
        expect(await polledTwiceSince(landA.pid!, freed)).toBe(true);
        expect(await polledTwiceSince(landB.pid!, freed)).toBe(true);
        expect(nothingRan()).toBe(true);

        process.kill(health.pid!, "SIGCONT");
        await Promise.all(all.map(exited));
        expect(ranOrder()).toEqual(["health", "landA", "landB"]);
    }, 90_000);

    it("a queued gate registers its role and tier, restamps itself, and leaves nothing behind", async () => {
        const holder = spawnHolder();
        await waitForLock();

        const queued = spawn("bun", [GATE, "job", "true"], {
            cwd: lockRoot,
            env: env({
                TOLARIA_GATE_ROLE: "land",
                TOLARIA_GATE_POLL_MS: "100",
            }),
            stdio: "ignore",
        });
        strays.push(queued.pid!);
        expect(await waitFor(() => readWaiter(queued.pid!) !== null)).toBe(
            true
        );
        const entry = readWaiter(queued.pid!)!;
        expect(entry.role).toBe("land");
        expect(entry.tier).toBe("job");
        // The stamp is what keeps it in the queue: it moves on every poll.
        expect(await polledTwiceSince(queued.pid!, entry.seen!)).toBe(true);

        holder.kill("SIGTERM");
        await exited(queued);
        expect(existsSync(waiterPath(queued.pid!))).toBe(false);
    }, 60_000);

    it("a free mutex is not an invitation: a health gate waits behind a queued land, and says for whom", async () => {
        const seeded = seedWaiter({ pid: process.pid, role: "land" });
        const queued = spawn("bun", [GATE, "yield", "echo RAN"], {
            cwd: lockRoot,
            env: env({ TOLARIA_GATE_ROLE: "health" }),
            stdio: ["ignore", "pipe", "pipe"],
        });
        strays.push(queued.pid!);
        let out = "";
        let err = "";
        queued.stdout.on("data", (c: Buffer) => (out += c.toString()));
        queued.stderr.on("data", (c: Buffer) => (err += c.toString()));

        // The LINE is the event — not a window in which nothing happened.
        expect(
            await waitFor(() => err.includes("free, but queue position 2/2"))
        ).toBe(true);
        expect(err).toContain(`next is pid ${process.pid} [land]`);
        expect(out).not.toContain("RAN");
        expect(existsSync(join(lockRoot, "gate.lock"))).toBe(false);

        rmSync(seeded, { force: true });
        await exited(queued);
        expect(out).toContain("RAN");
    }, 60_000);

    it("ageing gets health through a land that never leaves the queue", () => {
        // The seeded land is THIS process: it never acquires and never goes
        // away. `run`'s timeout turns a starved gate into a failed assertion
        // rather than a wedged worker.
        seedWaiter({ pid: process.pid, role: "land" });
        const r = run(["yield", "echo RAN"], {
            env: env({
                TOLARIA_GATE_ROLE: "health",
                TOLARIA_GATE_WAITER_SINCE: String(
                    Date.now() - 3 * AGE_STEP_MS - 60_000
                ),
            }),
            timeout: 20_000,
        });
        expect(r.status, `signal=${r.signal} stderr=${r.stderr}`).toBe(0);
        expect(r.stdout).toContain("RAN");
    });

    it("a land queues by the time it was ISSUED, not the time it registered: ahead of a land that reached the queue first (issue #4988)", () => {
        // The seeded land is THIS process and never leaves the queue: it
        // registered a minute ago, while the other land was still in its
        // preflight. That one was issued two minutes ago and registers NOW,
        // with exactly the environment `land.ts` hands its gate.
        // A health gate queued meanwhile too: behind both, by class.
        const now = Date.now();
        seedWaiter({ pid: process.pid, role: "land", since: now - 60_000 });
        seedWaiter({
            pid: process.ppid,
            role: "health",
            tier: "yield",
            since: now - 110_000,
        });
        const r = run(["heavy", "echo RAN"], {
            env: lockedEnv(env(), now - 120_000),
            timeout: 20_000,
        });
        expect(r.status, `signal=${r.signal} stderr=${r.stderr}`).toBe(0);
        expect(r.stdout).toContain("RAN");
    });

    it("the queue-entry time is this gate's alone: never handed on to its command", () => {
        // `land` detaches the batch health run from inside its hold; with
        // the variable inherited, that run would queue as if it had waited
        // since the land was issued.
        const r = run(["heavy", "echo since=[$TOLARIA_GATE_WAITER_SINCE]"], {
            env: env({
                TOLARIA_GATE_WAITER_SINCE: String(Date.now() - 60_000),
            }),
        });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain("since=[]");
    });

    it("a land goes ahead of a hand-run heavy gate that queued before it", () => {
        seedWaiter({ pid: process.pid, since: Date.now() - 60_000 });
        const r = run(["heavy", "echo RAN"], {
            env: env({ TOLARIA_GATE_ROLE: "land" }),
            timeout: 20_000,
        });
        expect(r.status, `signal=${r.signal} stderr=${r.stderr}`).toBe(0);
        expect(r.stdout).toContain("RAN");
    });

    it("prunes a waiter whose pid is gone — a killed session holds no place in the queue", () => {
        const dead = spawnSync("sh", ["-c", "exit 0"]);
        const file = seedWaiter({ pid: dead.pid!, role: "land" });
        const r = run(["yield", "echo RAN"], { timeout: 20_000 });
        expect(r.status, `signal=${r.signal} stderr=${r.stderr}`).toBe(0);
        expect(r.stdout).toContain("RAN");
        expect(existsSync(file)).toBe(false);
    });

    it("prunes a waiter that stopped polling — a live pid at the head must not block the queue for ever", () => {
        // A reused pid, or a stopped session: the pid answers, nothing polls.
        const file = seedWaiter({
            pid: process.pid,
            role: "land",
            seen: Date.now() - 10 * 60_000,
        });
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

    it("`who` prints the queue in ACQUISITION order, not in arrival order", async () => {
        const holder = spawnHolder();
        await waitForLock();
        // Five live pids to hang entries on; none of them is a gate.
        const sleepers = [0, 1, 2].map(() => spawn("sleep", ["60"]));
        strays.push(...sleepers.map((c) => c.pid!));
        const [s1, s2, s3] = sleepers.map((c) => c.pid!);
        const now = Date.now();
        // Seeded oldest-first — the reverse of how they must print.
        seedWaiter({
            pid: s1,
            role: "health",
            tier: "yield",
            since: now - 50_000,
        });
        seedWaiter({ pid: process.ppid, since: now - 40_000 });
        seedWaiter({ pid: s2, tier: "job", since: now - 30_000 });
        seedWaiter({ pid: s3, role: "land", since: now - 20_000 });
        seedWaiter({ pid: process.pid, role: "land", since: now - 10_000 });

        const queued = run(["who"])
            .stdout.split("\n")
            .filter((l) => l.includes("queued #"))
            .map((l) =>
                /queued #(\d+) — pid (\d+) \[([^\]]+)\]/.exec(l)?.slice(1)
            );
        expect(queued).toEqual([
            ["1", String(s3), "land"],
            ["2", String(process.pid), "land"],
            ["3", String(s2), "job"],
            ["4", String(process.ppid), "heavy"],
            ["5", String(s1), "health"],
        ]);
        holder.kill("SIGTERM");
        await exited(holder);
    }, 60_000);

    it("`who` says what ageing did to a waiter's class", () => {
        seedWaiter({
            pid: process.pid,
            role: "health",
            tier: "yield",
            since: Date.now() - 3 * AGE_STEP_MS - 60_000,
        });
        const out = run(["who"]).stdout;
        expect(out).toContain("heavy mutex is free");
        expect(out).toMatch(/queued #1 — pid \d+ \[health, aged to land\]/);
    });
});

describe("gate.ts — the job tier and the jobs it admits (issue #4941)", () => {
    const REPO = resolve(__dirname, "..", "..");

    /** A heavy holder for the duration of a test; SIGTERM so the gate reaps
     *  its own `sleep` group on the way out. */
    async function holdMutex() {
        const holder = spawn("bun", [GATE, "heavy", "sleep 60"], {
            cwd: lockRoot,
            env: env(),
            stdio: "ignore",
        });
        await waitForLock();
        return async () => {
            holder.kill("SIGTERM");
            await new Promise((r) => holder.on("exit", r));
        };
    }

    /**
     * Start `cmd` in its own process group and collect stderr until `done`
     * holds, then kill the WHOLE group: a correctly admitted job is blocked
     * by design and never exits on its own, and an unadmitted one is the real
     * job — a sweep, a search — which must not outlive the test.
     */
    async function stderrUntil(
        cmd: string[],
        done: (err: string) => boolean,
        extraEnv: Record<string, string> = {}
    ): Promise<string> {
        const p = spawn(cmd[0], cmd.slice(1), {
            cwd: REPO,
            env: env(extraEnv),
            stdio: ["ignore", "ignore", "pipe"],
            detached: true,
        });
        let err = "";
        p.stderr!.on("data", (d) => (err += d));
        try {
            await waitFor(() => done(err), 30_000);
        } finally {
            try {
                process.kill(-p.pid!, "SIGKILL");
            } catch {
                /* already gone */
            }
        }
        return err;
    }

    const WAITING = /\[gate\] waiting \S+ for the heavy mutex/;
    const LOCKFILE = join(REPO, "data", "oracle-compiled.json");

    it("the job tier queues behind a heavy holder like any heavy gate", async () => {
        const release = await holdMutex();
        try {
            const err = await stderrUntil(
                ["bun", GATE, "job", "echo SHOULD-WAIT >&2"],
                (e) => WAITING.test(e) || e.includes("SHOULD-WAIT")
            );
            expect(err).toMatch(WAITING);
            expect(err).not.toContain("SHOULD-WAIT");
        } finally {
            await release();
        }
    }, 40_000);

    it("the job tier runs in an issue worktree — the jobs ARE the session's work", () => {
        const d = join(lockRoot, "tolaria-issue-4242");
        mkdirSync(d, { recursive: true });
        const r = run(
            [
                "job",
                "echo JOB-OK held=[$TOLARIA_GATE_HELD] w=[$TOLARIA_VITEST_WORKERS]",
            ],
            { cwd: d }
        );
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain("JOB-OK held=[1]");
        expect(r.stdout).toMatch(/w=\[[2-9]\d*\]/);
        expect(existsSync(join(lockRoot, "gate.lock"))).toBe(false);
    });

    it("a nested job under a hold passes straight through — land and health-main never self-deadlock", async () => {
        const release = await holdMutex();
        try {
            const r = run(["job", "echo NESTED-OK"], {
                env: env({ TOLARIA_GATE_HELD: "1" }),
                timeout: 20_000,
            });
            expect(r.status, r.stderr).toBe(0);
            expect(r.stdout).toContain("NESTED-OK");
            expect(r.stderr).not.toMatch(WAITING);
        } finally {
            await release();
        }
    }, 40_000);

    // The wiring itself: each script, spelled as an agent types it, waits.
    for (const [name, cmd] of [
        ["bot:reach", ["bun", "run", "bot:reach"]],
        ["verdicts:search", ["bun", "run", "verdicts:search"]],
        ["oracle:compile (the sweep)", ["bun", "scripts/oracle-compile.ts"]],
    ] as const) {
        it(`\`${name}\` waits for the heavy mutex instead of starting`, async () => {
            // An UNadmitted run is the real job, and a sweep whose verdicts are
            // all cached writes the committed lockfile within seconds: a red
            // here must not leave the checkout dirty.
            const before = readFileSync(LOCKFILE);
            const release = await holdMutex();
            try {
                const err = await stderrUntil([...cmd], (e) => WAITING.test(e));
                expect(err).toMatch(WAITING);
            } finally {
                await release();
                const after = readFileSync(LOCKFILE);
                if (!after.equals(before)) writeFileSync(LOCKFILE, before);
                expect(after.equals(before)).toBe(true);
            }
        }, 60_000);
    }
});
