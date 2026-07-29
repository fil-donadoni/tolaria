#!/usr/bin/env bun
/**
 * CPU admission control for the quality gates.
 *
 * WHY. This repo is worked by several concurrent Claude Code sessions/subagents,
 * each in its own git worktree. Every one of them runs vitest, `tsc -b` and
 * eslint. Vitest defaults to `ncpu - 1` workers per invocation, so on an 8-core
 * machine four concurrent subagents spawn ~28 test workers plus four type-checks
 * plus four lints — measured load average 45 on 8 cores. Telemetry
 * (.claude/telemetry/tool-events.jsonl, aggregated by scripts/agent-timing-report.ts):
 * 53.7h of foreground gate wall-clock, 22.7h of it contended, ~4.9h of pure
 * contention waste, `check:all` 67s solo vs 110s contended, targeted vitest 4s vs
 * 10s, and the bot suite blowing its 60s per-test ceiling under load — i.e.
 * FALSE REDS, whose debugging cost dwarfs the raw slowdown.
 *
 * MODEL. Two tiers:
 *
 *   heavy — the full suites and `check:all`. Hold a machine-wide exclusive
 *           mutex and get the full worker count. One at a time, but each runs
 *           at solo speed instead of N running at 1/N speed. Callers queue.
 *   light — targeted vitest, `check:ts`, `lint`. No lock, but vitest is capped
 *           at TOLARIA_VITEST_WORKERS (default 2, see vitest.config.ts), so
 *           four concurrent light jobs fit in ncpu.
 *
 * The lock lives OUTSIDE the repo ($HOME/.cache/tolaria) on purpose: worktrees
 * are separate directories, so an in-repo lock would not be shared between them.
 *
 * Usage:
 *   bun scripts/gate.ts heavy '<shell command>'
 *   bun scripts/gate.ts light '<shell command>'
 *
 * Env:
 *   TOLARIA_GATE_HELD=1        set by this script for the child; a nested heavy
 *                              call passes straight through (no self-deadlock)
 *   TOLARIA_ALLOW_FULL_SUITE=1 escape hatch for the issue-worktree guard
 *   TOLARIA_VITEST_WORKERS     worker cap read by vitest.config.ts
 *   TOLARIA_GATE_LOCK_ROOT     lock location override (tests only)
 */
import { spawn, spawnSync } from "node:child_process";
import {
    mkdirSync,
    rmSync,
    readFileSync,
    writeFileSync,
    appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, cpus } from "node:os";

// Overridable so the test suite can exercise the mutex against a temp dir
// instead of contending with (or blocking) a real gate run on this machine.
const LOCK_ROOT =
    process.env.TOLARIA_GATE_LOCK_ROOT ?? join(homedir(), ".cache", "tolaria");
const LOCK_DIR = join(LOCK_ROOT, "gate.lock");
const OWNER_FILE = join(LOCK_DIR, "owner.json");
/** A held lock older than this is assumed orphaned even if its pid still exists. */
const STALE_MS = 45 * 60 * 1000;
const POLL_MS = 2000;
const NCPU = cpus().length;
/** Full-speed worker count for the heavy tier — leave one core for the OS. */
const HEAVY_WORKERS = Math.max(2, NCPU - 1);

const [, , tier, ...rest] = process.argv;
const command = rest.join(" ");

if ((tier !== "heavy" && tier !== "light") || !command) {
    console.error("usage: bun scripts/gate.ts <heavy|light> '<shell command>'");
    process.exit(2);
}

// ── issue-worktree guard ────────────────────────────────────────────────────
// The merge-train is the only place the full gate runs (process-gh-issues §4).
// An implement-subagent working an issue branch must run targeted tests only.
// That rule used to live in prose and was measurably ignored — this makes it code.
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
    tier === "heavy" &&
    !process.env.TOLARIA_GATE_HELD &&
    !process.env.TOLARIA_ALLOW_FULL_SUITE &&
    isIssueWorktree()
) {
    console.error(
        [
            "",
            "  ✗ Full gate blocked: this is an issue worktree.",
            "",
            "    The full suite and `check:all` are orchestrator-owned — they run once",
            "    per landing tree in the merge-train, on the rebased state that actually",
            "    lands (process-gh-issues §4 step 4). Running them here pays for a gate",
            "    that is re-paid at the train, and saturates the CPU of every other",
            "    subagent working in parallel.",
            "",
            "    Run the light pre-PR gate instead:",
            "      bunx vitest run <paths touched by the diff>",
            "      bun run check:pr    # same checks as check:all, no mutex",
            "",
            "    Genuinely need the full suite here? TOLARIA_ALLOW_FULL_SUITE=1 bun run test",
            "",
        ].join("\n")
    );
    process.exit(1);
}

// ── lock ────────────────────────────────────────────────────────────────────
interface Owner {
    pid: number;
    label: string;
    cwd: string;
    ts: number;
}

function readOwner(): Owner | null {
    try {
        return JSON.parse(readFileSync(OWNER_FILE, "utf8")) as Owner;
    } catch {
        return null;
    }
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** Atomic: mkdir fails if the directory exists. Returns true when acquired. */
function tryAcquire(): boolean {
    try {
        mkdirSync(LOCK_DIR, { recursive: false });
    } catch {
        return false;
    }
    const owner: Owner = {
        pid: process.pid,
        label: command.slice(0, 120),
        cwd: process.cwd(),
        ts: Date.now(),
    };
    writeFileSync(OWNER_FILE, JSON.stringify(owner));
    return true;
}

function release() {
    const owner = readOwner();
    if (owner && owner.pid !== process.pid) return; // not ours — never steal on exit
    try {
        rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
}

/** Telemetry: how long callers actually queue, so the tier split can be tuned. */
function logWait(waitedMs: number) {
    if (!process.env.CLAUDE_PROJECT_DIR && waitedMs < 1000) return;
    const dir = join(
        process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
        ".claude",
        "telemetry"
    );
    try {
        mkdirSync(dir, { recursive: true });
        appendFileSync(
            join(dir, "gate-lock.jsonl"),
            JSON.stringify({
                ts: Math.floor(Date.now() / 1000),
                tier,
                waited_ms: waitedMs,
                cwd: process.cwd(),
                cmd: command.slice(0, 120),
            }) + "\n"
        );
    } catch {
        /* telemetry is never load-bearing */
    }
}

async function acquire() {
    mkdirSync(LOCK_ROOT, { recursive: true });
    const t0 = Date.now();
    let announced = false;
    for (;;) {
        if (tryAcquire()) {
            logWait(Date.now() - t0);
            return;
        }
        const owner = readOwner();
        // Prune a lock whose holder died, or one held implausibly long.
        if (!owner || !alive(owner.pid) || Date.now() - owner.ts > STALE_MS) {
            console.error(
                `[gate] pruning stale lock (pid ${owner?.pid ?? "?"}, held ${
                    owner ? Math.round((Date.now() - owner.ts) / 1000) : "?"
                }s)`
            );
            try {
                rmSync(LOCK_DIR, { recursive: true, force: true });
            } catch {
                /* another waiter pruned it first */
            }
            continue;
        }
        if (!announced) {
            console.error(
                `[gate] waiting — held by pid ${owner.pid} in ${owner.cwd}: ${owner.label}`
            );
            announced = true;
        }
        const waited = Math.round((Date.now() - t0) / 1000);
        if (waited > 0 && waited % 60 === 0)
            console.error(`[gate] still waiting (${waited}s)`);
        await new Promise((r) => setTimeout(r, POLL_MS + Math.random() * 500));
    }
}

// ── run ─────────────────────────────────────────────────────────────────────
async function main() {
    const nested = process.env.TOLARIA_GATE_HELD === "1";
    if (tier === "heavy" && !nested) {
        await acquire();
        process.on("exit", release);
        for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
            process.on(sig, () => {
                release();
                process.exit(130);
            });
        }
    }

    const env = {
        ...process.env,
        TOLARIA_GATE_HELD:
            tier === "heavy" ? "1" : process.env.TOLARIA_GATE_HELD,
        TOLARIA_VITEST_WORKERS:
            process.env.TOLARIA_VITEST_WORKERS ??
            (tier === "heavy" ? String(HEAVY_WORKERS) : undefined),
    } as NodeJS.ProcessEnv;

    const child = spawn("sh", ["-c", command], { stdio: "inherit", env });
    child.on("exit", (code, signal) => {
        release();
        process.exit(signal ? 128 : (code ?? 1));
    });
}

void main();
