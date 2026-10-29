import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TrackedTree, parsePsRows, survivorLines } from "../lib/process-tree";

/**
 * The gate runner (scripts/gate.ts) — see CLAUDE.md § Quality gates. The mutex
 * and the machine admission are retired (issue #7488); what is asserted here
 * is what stays: tier → worker env, the issue-worktree guard, the command's
 * real exit code, and the tree that dies with the gate. Each goes through a
 * subprocess running the script rather than re-implementing its logic.
 */
const GATE = resolve(__dirname, "..", "gate.ts");

let scratch: string;

function env(extra: Record<string, string> = {}) {
    const base = { ...process.env };
    // Strip everything gate.ts itself sets: this suite may well be running
    // UNDER a heavy gate (`bun run test`), which exports these to its whole
    // process tree.
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
        // A BOUND, not a measurement: only a gate that never returns reaches it.
        timeout: opts.timeout ?? 60_000,
        // The neutral temp dir, NOT the checkout this suite runs in: that may
        // be an issue worktree, which would trip the guard under test.
        cwd: opts.cwd ?? scratch,
        env: opts.env ?? env(),
    });
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

/** Poll `done` until it holds or a generous deadline passes. Every subprocess
 *  test waits for an EVENT through this — a bound sized so only a hang, never
 *  a loaded machine, can exhaust it. */
async function waitFor(done: () => boolean, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (!done() && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 50));
    return done();
}

function ps(args: string[]): string {
    const r = spawnSync("ps", args, { encoding: "utf8" });
    if (r.error || r.status !== 0)
        throw new Error(
            `ps ${args.join(" ")} failed (status ${r.status}, signal ${r.signal}): ${r.error?.message ?? r.stderr}`
        );
    return r.stdout;
}

/**
 * Every descendant of `root`, by walking `ps` — not by matching a command
 * line. The processes under test are plain `sleep`s, indistinguishable from
 * any other session's on this shared machine; parentage is the only thing
 * that identifies them, and it is also exactly what the fix is about.
 */
function descendants(root: number): number[] {
    const kids = new Map<number, number[]>();
    for (const line of ps(["-Ao", "pid,ppid"]).split("\n").slice(1)) {
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

/** `ps -o comm` prints a bare name or a full path, depending on how it ran. */
function isComm(comm: string, name: string): boolean {
    return comm === name || comm.endsWith(`/${name}`);
}

function procs(): Proc[] {
    const out: Proc[] = [];
    for (const line of ps(["-Ao", "pid=,ppid=,pgid=,stat=,comm="]).split(
        "\n"
    )) {
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

beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "gate-test-"));
});

afterEach(() => {
    for (const pid of strays) {
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            /* gone */
        }
    }
    strays = [];
    rmSync(scratch, { recursive: true, force: true });
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

describe("gate.ts — issue-worktree guard", () => {
    /** A non-repo dir whose path matches the issue-worktree naming convention. */
    function issueWorktree() {
        const d = join(scratch, "tolaria-issue-4242");
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
        const r = run(["heavy", "echo MAIN-OK"], { cwd: scratch });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("MAIN-OK");
    });
});

describe("gate.ts — the job tier (issue #4941)", () => {
    it("the job tier runs in an issue worktree — the jobs ARE the session's work", () => {
        const d = join(scratch, "tolaria-issue-4242");
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

        strays = [gatePid];
        let tree: number[] = [];
        // Both sleeps, counted by name — anything less and the assertion
        // below would pass on a tree that never got built. A count of pids
        // would not do: the gate's own `sysctl`/`vm_stat` probes are its
        // children too, and can fill the count before a sleep exists (issue
        // #5874).
        const sleeps = () => {
            const ids = new Set((tree = descendants(gatePid)));
            return procs().filter(
                (p) => ids.has(p.pid) && isComm(p.comm, "sleep")
            ).length;
        };
        await waitFor(() => sleeps() >= 2);
        strays.push(...tree);
        expect(sleeps()).toBeGreaterThanOrEqual(2);

        // The signal a session teardown sends: the gate's pid alone. A Ctrl-C
        // would reach the whole foreground group and hide the defect entirely.
        process.kill(gatePid, "SIGTERM");

        const reaped = await waitFor(() => tree.every((pid) => !alive(pid)));
        expect(reaped, `survivors: ${tree.filter(alive).join(", ")}`).toBe(
            true
        );
    });

    it("a SIGTERMed gate reaps a NESTED gate's tree — a second process group — (issue #4965)", async () => {
        // The observed orphan: `land` holds the mutex and runs `bun run test`,
        // i.e. a nested `gate.ts heavy`, which detaches ITS child into a new
        // process group. The holder signalled its one group, released, and a
        // vitest with four workers ran on under the next holder.
        const gate = spawn(
            "bun",
            [GATE, "heavy", `bun ${GATE} heavy 'sleep 120'`],
            { cwd: scratch, env: env(), stdio: ["ignore", "ignore", "pipe"] }
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
    }, 60_000);
});

describe("process-tree — the tree a teardown kills, pure (issue #4965)", () => {
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
