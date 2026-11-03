/**
 * Process-tree teardown for the gate runner (`scripts/gate.ts`, issue #4965):
 * what a wrapped command's tree is, and how a survivor is named. Also the
 * bounded synchronous spawn (`runBounded`, issue #7937) that `pr-refresh`
 * runs its prepare path through.
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";

/** One row of `ps -Ao pid=,ppid=,pgid=,stat=,args=`. */
export interface PsRow {
    pid: number;
    ppid: number;
    pgid: number;
    /** Exited, not yet reaped. It holds no CPU and cannot be signalled; a
     *  holder blocked in its own teardown cannot reap, so it must not count
     *  as a survivor. */
    zombie: boolean;
    /** The raw state column (`S`, `R+`, `E`, …) and the command line — what
     *  an unconfirmed teardown names its survivors by (issue #4976). The
     *  command is empty when `ps` printed none. */
    stat: string;
    command: string;
}

/** Null when the output carries no parseable row — "unmeasurable". */
export function parsePsRows(psOutput: string): PsRow[] | null {
    const rows: PsRow[] = [];
    for (const line of psOutput.split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*?))?\s*$/.exec(
            line
        );
        if (!m) continue;
        rows.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            pgid: Number(m[3]),
            zombie: m[4].startsWith("Z"),
            stat: m[4],
            command: m[5] ?? "",
        });
    }
    return rows.length ? rows : null;
}

/** How much of a survivor's command line its warning carries. */
const SURVIVOR_COMMAND_MAX = 160;

/**
 * What an unconfirmed teardown owes its log (issue #4976): one line per
 * process the LAST `ps` pass still listed as the tree's. The warning used to
 * name the root alone — dead by then — so the class of the survivor (2 of 3
 * `land`s printed it after PR #4973) could not be read back afterwards.
 * `null` is "no pass to read them from": `ps` gave no rows.
 */
export function survivorLines(survivors: readonly PsRow[] | null): string[] {
    if (!survivors)
        return ["[gate]   no survivor can be named — `ps` gave no rows"];
    return survivors.map((r) => {
        const command =
            r.command.length > SURVIVOR_COMMAND_MAX
                ? `${r.command.slice(0, SURVIVOR_COMMAND_MAX)}…`
                : r.command || "(no command)";
        return `[gate]   survivor pid ${r.pid} ppid ${r.ppid} pgid ${r.pgid} stat ${r.stat} — ${command}`;
    });
}

/**
 * Everything a wrapped command has ever been seen to own, across `ps`
 * snapshots: the pids of its tree and the process groups they lead or sit in.
 *
 * One group is not the tree. The gate spawns its child `detached` so the
 * child's group is a handle that survives reparenting — but a NESTED
 * `gate.ts` (every `bun run test` inside a locked `land`) does the same for
 * ITS child, which therefore sits in a second group the outer handle never
 * reaches. Observed 2026-10-02: the holder was SIGTERMed, signalled its one
 * group, released, and a `vitest run --project node-engine` in its own group
 * kept four workers burning, reparented to pid 1, under the next holder.
 *
 * So the tree is WALKED (parent links, while they still exist) and every
 * group met is remembered: the walk finds what is nested, the groups keep
 * hold of it once the signal has killed the parents the walk went through.
 */
export class TrackedTree {
    readonly pids = new Set<number>();
    readonly groups = new Set<number>();
    private readonly protectedGroups: ReadonlySet<number>;

    /**
     * `root` is the gate's own child — a group LEADER by construction, so its
     * pid is seeded as a group too: that is the one handle left when the root
     * exited by itself and its children were reparented. `protectedGroups` are
     * never signalled as groups — the signaller's own above all, where a
     * group signal would take down the gate and the session behind it.
     */
    constructor(
        root: number,
        protectedGroups: ReadonlySet<number> = new Set()
    ) {
        this.protectedGroups = protectedGroups;
        this.pids.add(root);
        this.addGroup(root);
    }

    private addGroup(pgid: number) {
        if (pgid > 1 && !this.protectedGroups.has(pgid)) this.groups.add(pgid);
    }

    /** Fold one snapshot in; the LIVE processes still owned by the tree. */
    absorb(rows: readonly PsRow[]): PsRow[] {
        const kids = new Map<number, PsRow[]>();
        for (const r of rows) {
            const bucket = kids.get(r.ppid);
            if (bucket) bucket.push(r);
            else kids.set(r.ppid, [r]);
        }
        // A fixpoint, not one pass: a process pulled in by its group can have
        // children outside it, and a child's group can hold strangers to the
        // parent chain (a reparented sibling).
        for (let grew = true; grew; ) {
            grew = false;
            for (const r of rows) {
                const owned =
                    this.pids.has(r.pid) ||
                    this.pids.has(r.ppid) ||
                    this.groups.has(r.pgid);
                if (!owned) continue;
                if (!this.pids.has(r.pid)) {
                    this.pids.add(r.pid);
                    grew = true;
                }
                if (!this.groups.has(r.pgid)) {
                    const before = this.groups.size;
                    this.addGroup(r.pgid);
                    if (this.groups.size !== before) grew = true;
                }
            }
        }
        return rows.filter(
            (r) =>
                !r.zombie && (this.pids.has(r.pid) || this.groups.has(r.pgid))
        );
    }
}

// ── teardown + bounded spawn ────────────────────────────────────────────────
const KILL_VERIFY_MS = 3000;
const TEARDOWN_POLL_MS = 50;
/** `ps` runs from a directory that cannot vanish under it. */
const SPAWN_CWD = "/";

/** Synchronous sleep that needs neither Bun nor a timer: teardown runs inside
 *  `exit` handlers and sync callers, where neither a promise nor a loop tick
 *  is available. */
function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function psRows(): PsRow[] | null {
    // `-ww`: off a terminal `ps` cuts a row at 79 columns, and the command is
    // what a survivor is diagnosed by.
    const r = spawnSync("ps", ["-ww", "-Ao", "pid=,ppid=,pgid=,stat=,args="], {
        encoding: "utf8",
        cwd: SPAWN_CWD,
        maxBuffer: 16 * 1024 * 1024,
    });
    if (r.status !== 0 || !r.stdout) return null;
    return parsePsRows(r.stdout);
}

/** What a teardown SAW. `survivors` is the last pass's — null when `ps` gave
 *  no pass to read them from. */
export type TreeKill =
    | { gone: true }
    | { gone: false; survivors: PsRow[] | null };

function signalQuietly(target: number, signal: NodeJS.Signals) {
    try {
        process.kill(target, signal);
    } catch {
        /* already gone — the outcome we wanted */
    }
}

/**
 * Kill the process tree rooted at `root` — every descendant, in every process
 * group — and report whether it was SEEN to be gone (issue #4965). `signal`
 * first, SIGKILL once `graceMs` has passed, then up to KILL_VERIFY_MS for `ps`
 * to show nothing left. SYNCHRONOUS on purpose: it runs inside signal and
 * `exit` handlers.
 */
export function killTree(
    root: number,
    signal: NodeJS.Signals,
    graceMs: number
): TreeKill {
    let rows = psRows();
    if (!rows) {
        // No `ps`: the group of the direct child is the only handle there is.
        signalQuietly(-root, signal);
        if (signal !== "SIGKILL") {
            sleepSync(graceMs);
            signalQuietly(-root, "SIGKILL");
        }
        return { gone: false, survivors: null };
    }
    const own = rows.find((r) => r.pid === process.pid)?.pgid;
    const tree = new TrackedTree(root, new Set(own === undefined ? [] : [own]));
    // Each target gets the polite signal ONCE: a second SIGTERM is, to more
    // than one tool, "stop cleaning up and die".
    const sent = new Set<number>();
    const send = (target: number, sig: NodeJS.Signals) => {
        if (sig !== "SIGKILL") {
            if (sent.has(target)) return;
            sent.add(target);
        }
        signalQuietly(target, sig);
    };
    const t0 = Date.now();
    for (;;) {
        const survivors = tree.absorb(rows);
        if (survivors.length === 0) return { gone: true };
        const elapsed = Date.now() - t0;
        if (elapsed > graceMs + KILL_VERIFY_MS)
            return { gone: false, survivors };
        const sig =
            signal === "SIGKILL" || elapsed >= graceMs ? "SIGKILL" : signal;
        for (const pgid of tree.groups) send(-pgid, sig);
        for (const r of survivors)
            if (!tree.groups.has(r.pgid)) send(r.pid, sig);
        sleepSync(TEARDOWN_POLL_MS);
        rows = psRows();
        if (!rows) return { gone: false, survivors: null };
    }
}

export interface BoundedResult {
    status: number | null;
    stdout: string;
    stderr: string;
    /** The deadline passed and the tree was killed. */
    timedOut: boolean;
}

/**
 * `spawnSync` that cannot outlive `timeoutMs` nor leave a tree behind (issue
 * #7937). The child leads its own process group, so when the
 * deadline passes — or the child exits leaving grandchildren — the whole tree
 * is killed and seen to be gone, the way the gate tears down its command.
 * `spawnSync` alone signals only the direct child: `bun run x` dying left its
 * `bun scripts/y.ts` spinning, reparented to pid 1.
 */
export function runBounded(
    cmd: string,
    args: string[],
    options: Pick<SpawnSyncOptions, "cwd" | "env"> & {
        timeoutMs: number;
        /** `ignore` discards output (the default captures it). */
        stdio?: "ignore" | "capture";
    }
): BoundedResult {
    const capture = options.stdio !== "ignore";
    // The child leads a group of its own, made by `perl` before it `exec`s the
    // command: Bun's `spawnSync` ignores `detached`, and a child left in the
    // caller's group is one `killTree` must protect, so nothing would be
    // killed (the runtime `pr-refresh` runs under). Same pid before and after
    // the `exec`, so `r.pid` is the group's leader on either runtime.
    const r = spawnSync(
        "perl",
        ["-e", "setpgrp(0,0); exec @ARGV or die qq(exec: $!\\n)", cmd, ...args],
        {
            cwd: options.cwd,
            env: options.env,
            encoding: "utf8",
            stdio: capture ? "pipe" : "ignore",
            timeout: options.timeoutMs,
            killSignal: "SIGKILL",
            maxBuffer: 64 * 1024 * 1024,
        }
    );
    // Whatever the child left running is not part of its result.
    if (r.pid) killTree(r.pid, "SIGKILL", 0);
    const timedOut =
        (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    return {
        status: timedOut ? null : r.status,
        stdout: capture ? String(r.stdout ?? "") : "",
        stderr: capture ? String(r.stderr ?? "") : "",
        timedOut,
    };
}
