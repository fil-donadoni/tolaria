#!/usr/bin/env bun
/**
 * The gate runner: what every quality gate is wrapped in.
 *
 * It no longer rations the machine — the mutex, its waiters and the machine
 * admission are retired (ADR 0156 Amendment I, issue #7488): one `lane`
 * runner per machine serialises the heavy jobs by construction. What stays is
 * the contract a gate's command needs around it:
 *
 *   - the worker cap, as configuration: `TOLARIA_VITEST_WORKERS` is raised to
 *     `min(ncpu - 1, TOLARIA_HEAVY_WORKERS_CAP)` (default cap 4, RAM-bound) on
 *     the heavy tiers, unless the caller set it; the light tiers keep the
 *     vitest.config.ts default of 2;
 *   - `TOLARIA_VITEST_FS_CACHE=0` on EVERY tier (issue #4614);
 *   - the issue-worktree guard: the full gate runs in `land`'s queue, never in
 *     an issue worktree;
 *   - teardown: the command runs detached, and a signal to this process takes
 *     the whole tree down, seen to be gone (`lib/process-tree.ts`);
 *   - the command's REAL exit code is this process's exit code.
 *
 * Usage:
 *   bun scripts/gate.ts heavy '<shell command>'
 *   bun scripts/gate.ts yield '<shell command>'   # heavy, in the health class
 *   bun scripts/gate.ts job '<shell command>'     # heavy, allowed in a worktree
 *   bun scripts/gate.ts light '<shell command>'
 *
 * Env:
 *   TOLARIA_GATE_HELD=1        set for the child on the heavy tiers; a nested
 *                              heavy call skips the issue-worktree guard
 *   TOLARIA_ALLOW_FULL_SUITE=1 escape hatch for the issue-worktree guard
 *   TOLARIA_VITEST_WORKERS     worker cap read by vitest.config.ts
 *   TOLARIA_HEAVY_WORKERS_CAP  ceiling on the heavy tier's worker count
 *   TOLARIA_GATE_KILL_GRACE_MS TERM → KILL grace of a teardown (tests only)
 */
import { spawn, spawnSync } from "node:child_process";
import { cpus } from "node:os";
import {
    TrackedTree,
    parsePsRows,
    survivorLines,
    type PsRow,
} from "./lib/process-tree";
import { gateChildEnv } from "./lib/vitest-fs-cache";

const KILL_GRACE_MS = Number(process.env.TOLARIA_GATE_KILL_GRACE_MS ?? 2000);
const KILL_VERIFY_MS = 3000;
const TEARDOWN_POLL_MS = 50;
const SPAWN_CWD = "/";

/** Heavy-tier worker count: `min(ncpu - 1, cap)`, at least 2. */
const HEAVY_WORKERS_CAP = Number(process.env.TOLARIA_HEAVY_WORKERS_CAP ?? 4);
const HEAVY_WORKERS = Math.max(
    2,
    Math.min(cpus().length - 1, HEAVY_WORKERS_CAP)
);

const HEAVY_TIERS = ["heavy", "yield", "job"] as const;
const isHeavyTier = (t: string): boolean =>
    (HEAVY_TIERS as readonly string[]).includes(t);

const [, , tier, ...rest] = process.argv;
const command = rest.join(" ");

if ((!isHeavyTier(tier) && tier !== "light") || !command) {
    console.error(
        "usage: bun scripts/gate.ts <heavy|yield|job|light> '<shell command>'"
    );
    process.exit(2);
}

// ── issue-worktree guard ────────────────────────────────────────────────────
function currentBranch(): string {
    const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf8",
    });
    return r.status === 0 ? r.stdout.trim() : "";
}

function isIssueWorktree(): boolean {
    if (/^(feat|fix)\/issue-\d+$/.test(currentBranch())) return true;
    return /tolaria-issue-\d+/.test(process.cwd());
}

if (
    isHeavyTier(tier) &&
    tier !== "job" &&
    !process.env.TOLARIA_GATE_HELD &&
    !process.env.TOLARIA_ALLOW_FULL_SUITE &&
    isIssueWorktree()
) {
    console.error(
        [
            "",
            "  ✗ Full gate blocked: this is an issue worktree.",
            "",
            "    The full suite and `check:all` run once per landing tree in the",
            "    merge queue, on the rebased state that actually lands. Running",
            "    them here pays for a gate that is re-paid there.",
            "",
            "    Run the light pre-PR gate instead:",
            "      bunx vitest run <paths touched by the diff>",
            "",
            "    Genuinely need the full suite here? TOLARIA_ALLOW_FULL_SUITE=1 bun run test",
            "",
        ].join("\n")
    );
    process.exit(1);
}

// ── tree teardown ───────────────────────────────────────────────────────────
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
type TreeKill = { gone: true } | { gone: false; survivors: PsRow[] | null };

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
function killTree(
    root: number,
    signal: NodeJS.Signals,
    graceMs: number
): TreeKill {
    let rows = psRows();
    if (!rows) {
        // No `ps`: the group of the direct child is the only handle there is.
        signalQuietly(-root, signal);
        if (signal !== "SIGKILL") {
            Bun.sleepSync(graceMs);
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
        Bun.sleepSync(TEARDOWN_POLL_MS);
        rows = psRows();
        if (!rows) return { gone: false, survivors: null };
    }
}

// ── run ─────────────────────────────────────────────────────────────────────
let child: ReturnType<typeof spawn> | undefined;
let tornDown = false;

/** Kill the wrapped tree, once. */
function teardownChild(signal: NodeJS.Signals, graceMs: number) {
    const pid = child?.pid;
    if (pid === undefined || tornDown) return;
    tornDown = true;
    const kill = killTree(pid, signal, graceMs);
    if (!kill.gone)
        console.error(
            [
                `[gate] could NOT confirm the tree of pid ${pid} is gone (${signal}) — continuing`,
                ...survivorLines(kill.survivors),
            ].join("\n")
        );
}

/** Detaching the child removed it from the terminal's foreground process
 *  group, so a Ctrl-C no longer reaches it: the gate is the only route a
 *  signal has to the command it wraps. */
function installTeardown() {
    process.on("exit", () => teardownChild("SIGKILL", 0));
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.on(sig, () => {
            teardownChild(sig, KILL_GRACE_MS);
            process.exit(130);
        });
    }
}

function main() {
    const env = gateChildEnv(process.env, isHeavyTier(tier), HEAVY_WORKERS);
    child = spawn("sh", ["-c", command], {
        stdio: "inherit",
        env,
        detached: true,
    });
    installTeardown();
    child.on("exit", (code, signal) => {
        // The command is done; whatever it left running is not.
        teardownChild("SIGKILL", 0);
        process.exit(signal ? 128 : (code ?? 1));
    });
}

main();
