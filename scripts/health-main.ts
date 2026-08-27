#!/usr/bin/env bun
/**
 * Post-merge health gate for `main` (ADR 0110).
 *
 * `land` runs the LANE gate synchronously and detaches this script after a
 * successful merge. It runs the FULL offline gate (`check:all` + all three
 * test suites) against the merged tip, in a throwaway worktree, and leaves a
 * durable verdict in `.claude/telemetry/health/`:
 *
 *   - `last.json`  — { sha, status: running|green|red, startedAt, finishedAt, log }
 *   - `RED`        — marker file, present iff the last completed run was red.
 *                    `land` warns when it exists; `bun run health:status`
 *                    prints the details. Fix-forward, then the next green run
 *                    removes it.
 *
 * Deduplicated by sha: a tip that is already green, or already being gated
 * (a `running` record younger than 90 minutes), is not re-gated — so N
 * quick successive lands cost ONE health run on the final tip.
 *
 * The gate runs in its own worktree at the tip, never in the primary
 * checkout's working tree (which may hold anything), and with
 * TOLARIA_GATE_HELD scrubbed so it queues on the machine mutex like any
 * other heavy gate instead of inheriting `land`'s already-released hold.
 *
 * `--status` prints the last verdict plus a stale-worktree report (worktrees
 * whose branch is merged into origin/main — the corpses policy of ADR 0110).
 *
 * Zero imports beyond node builtins — same constraint as bootstrap-worktree.
 */
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const HEALTH_DIR = ".claude/telemetry/health";
const STALE_RUNNING_MS = 90 * 60 * 1000;

interface LastRun {
    sha: string;
    status: "running" | "green" | "red";
    startedAt: string;
    finishedAt?: string;
    failedStep?: string;
    log?: string;
}

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

/** Primary checkout dir, or null when cwd already is it (same test as
 *  bootstrap-worktree.ts: `--git-common-dir` is relative in the primary). */
function primaryCheckout(cwd: string): string | null {
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    if (!common.startsWith("/")) return null;
    return dirname(resolve(common));
}

function readLast(dir: string): LastRun | null {
    try {
        return JSON.parse(
            readFileSync(join(dir, "last.json"), "utf8")
        ) as LastRun;
    } catch {
        return null;
    }
}

function writeLast(dir: string, run: LastRun): void {
    writeFileSync(join(dir, "last.json"), JSON.stringify(run, null, 2));
}

/** Worktrees whose checked-out branch is already merged into origin/main —
 *  the corpses `land`'s teardown missed (killed passes, abandoned batches). */
function staleWorktrees(cwd: string): string[] {
    const out = git(["worktree", "list", "--porcelain"], cwd);
    const stale: string[] = [];
    let path = "";
    for (const line of out.split("\n")) {
        if (line.startsWith("worktree ")) path = line.slice(9);
        if (line.startsWith("branch refs/heads/")) {
            const branch = line.slice(18);
            if (branch === "main") continue;
            // A freshly-created branch still AT the main tip is trivially an
            // ancestor — that is "not yet worked", not a corpse.
            let atTip = false;
            try {
                atTip =
                    git(["rev-parse", branch], cwd) ===
                    git(["rev-parse", "origin/main"], cwd);
            } catch {
                // unreadable ref — fall through to the ancestor check
            }
            if (atTip) continue;
            const merged =
                spawnSync(
                    "git",
                    ["merge-base", "--is-ancestor", branch, "origin/main"],
                    { cwd }
                ).status === 0;
            if (merged) stale.push(`${path} [${branch}]`);
        }
    }
    return stale;
}

function status(root: string): never {
    const dir = join(root, HEALTH_DIR);
    const last = readLast(dir);
    const red = existsSync(join(dir, "RED"));
    console.log("health:status —", root);
    if (!last) console.log("  no health run recorded yet");
    else
        console.log(
            `  last: ${last.status.toUpperCase()} @ ${last.sha.slice(0, 8)} (started ${last.startedAt}${last.finishedAt ? `, finished ${last.finishedAt}` : ""})${last.failedStep ? ` — failed at ${last.failedStep}` : ""}${last.log ? `\n  log:  ${last.log}` : ""}`
        );
    const stale = staleWorktrees(root);
    if (stale.length > 0) {
        console.log(
            `  stale worktrees (branch merged — remove with 'bun run wt:gc'):`
        );
        for (const s of stale) console.log(`    · ${s}`);
    }
    process.exit(red ? 1 : 0);
}

function main(): void {
    const cwd = process.cwd();
    const primary = primaryCheckout(cwd);
    const root = primary ?? cwd;

    if (process.argv.includes("--status")) status(root);

    if (primary !== null) {
        console.error(
            "health-main: run from the primary checkout (land detaches it there)"
        );
        process.exit(2);
    }

    const dir = join(root, HEALTH_DIR);
    mkdirSync(dir, { recursive: true });

    git(["fetch", "origin", "main", "-q"], root);
    const tip = git(["rev-parse", "origin/main"], root);

    const last = readLast(dir);
    if (last?.sha === tip) {
        if (last.status === "green") {
            console.log(`health-main: tip ${tip.slice(0, 8)} already green`);
            return;
        }
        if (
            last.status === "running" &&
            Date.now() - Date.parse(last.startedAt) < STALE_RUNNING_MS
        ) {
            console.log(
                `health-main: tip ${tip.slice(0, 8)} already being gated`
            );
            return;
        }
    }

    const startedAt = new Date().toISOString();
    writeLast(dir, { sha: tip, status: "running", startedAt });

    const wt = join(root, "..", `tolaria-health-${process.pid}`);
    const logPath = join(dir, `${tip.slice(0, 12)}.log`);
    // The health gate must queue on the machine mutex like any other heavy
    // gate — scrub the hold `land`'s locked shell exported.
    const env = { ...process.env };
    delete env.TOLARIA_GATE_HELD;
    delete env.TOLARIA_ALLOW_FULL_SUITE;

    const step = (cmd: string, args: string[], stepCwd: string): boolean => {
        const r = spawnSync(cmd, args, { encoding: "utf8", cwd: stepCwd, env });
        writeFileSync(
            logPath,
            `\n===== ${cmd} ${args.join(" ")} (exit ${r.status}) =====\n${r.stdout ?? ""}${r.stderr ?? ""}`,
            { flag: "a" }
        );
        return r.status === 0;
    };

    let failedStep: string | undefined;
    try {
        git(["worktree", "add", "--detach", wt, tip], root);
        if (!step("bun", ["run", "worktree:init"], wt))
            failedStep = "worktree:init";
        else if (!step("bun", ["run", "check:all"], wt))
            failedStep = "check:all";
        else if (!step("bun", ["run", "test"], wt)) failedStep = "test";
    } finally {
        spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: root });
    }

    if (failedStep) {
        writeLast(dir, {
            sha: tip,
            status: "red",
            startedAt,
            finishedAt: new Date().toISOString(),
            failedStep,
            log: logPath,
        });
        writeFileSync(
            join(dir, "RED"),
            `main @ ${tip} red at ${failedStep} — log: ${logPath}\n`
        );
        console.error(
            `health-main: RED @ ${tip.slice(0, 8)} (${failedStep}) — ${logPath}`
        );
        process.exit(1);
    }

    writeLast(dir, {
        sha: tip,
        status: "green",
        startedAt,
        finishedAt: new Date().toISOString(),
        log: logPath,
    });
    rmSync(join(dir, "RED"), { force: true });
    // The health gate IS the authoritative green record now (ADR 0110).
    writeFileSync(join(root, ".claude/telemetry/green-sha"), `${tip}\n`);
    console.log(`health-main: GREEN @ ${tip.slice(0, 8)}`);
}

main();
