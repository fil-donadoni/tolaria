/**
 * Process-tree teardown for the gate runner (`scripts/gate.ts`, issue #4965):
 * what a wrapped command's tree is, and how a survivor is named.
 */

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
