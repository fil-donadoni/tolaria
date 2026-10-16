#!/usr/bin/env bun
/**
 * `bun run land:runner` — the ONE merger (issue #5469, ADR 0154 topology B').
 *
 * A session ends at push + `bun run land:ready <PR#>`; this loop, on the
 * MacBook only, lands the oldest `ready-to-land` PR with the existing `land`
 * pipeline — rebase → lane → merge → scenario seed, under the heavy mutex —
 * one at a time, so the base branch has exactly one writer and no session
 * spends its context polling its own landing.
 *
 * One tick:
 *
 *   1. list `ready-to-land` PRs (`--state all`): a closed/merged one, or one
 *      whose branch is gone from origin, is STALE — unlabelled and logged;
 *   2. read the health lineage through the verdict store: under RED only a
 *      PR closing a recorded `/health-fix` issue lands, the rest stay queued
 *      (AMBER/GREEN resumes them) — `planTick`;
 *   3. land the oldest — exactly what origin holds — in the worktree already
 *      holding its branch (reset hard to origin; a dirty one is refused) or a
 *      fresh one: `bun scripts/land.ts <PR#>` with `TOLARIA_LAND_RUNNER=1`,
 *      the hatch `deny-guard.sh` § 8 admits, output to
 *      `.claude/telemetry/land-runner/land-<PR#>.log`;
 *   4. exit 0 (or a red exit on a PR that is MERGED all the same) → unlabel,
 *      comment `land`'s lane receipt, `seed:preset --all` when a card set
 *      changed, close the issue if the merge did not, release its claim
 *      (label, assignee, journal row), remove the worktree; 77, a signal or
 *      a worktree that could not be prepared (network, disk) → stays queued;
 *      anything else → `land-failed` + a comment carrying the lane excerpt,
 *      which `queue:plan` turns into a repair pick. A `gh` write that fails
 *      is logged, never thrown, so one PR cannot stall the queue.
 *
 * The runner does not reload its own code: a merged change to it takes
 * effect at its next start (`loop:afk --disarm`, then `--start`).
 *
 * Flags: `--once` (one tick, then exit — cron/launchd-friendly), `--dry-run`
 * (print the tick's plan, touch nothing), `--interval <s>` (between ticks;
 * default `landRunner.intervalS`), `--host-check` (exit 0 iff this machine
 * runs the runner — `loop-handoff.sh` asks it, one authority). Refuses (exit 0, so a supervisor does not
 * respawn it) on a machine whose platform is not `landRunner.platform`.
 * SIGTERM/SIGINT stop it AFTER the landing in flight — a `land` killed
 * mid-merge is a worse state than a late stop. The lock file holds the pid;
 * `loop:afk --disarm` signals it.
 *
 * Every decision is `lib/land-runner.ts`, tested in
 * `__tests__/land-runner.test.ts`; this file is plumbing.
 */
import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { CONFIG_PATH } from "./lib/branches";
import { gh, netEnv } from "./lib/gh";
import {
    lineageBlocks,
    readVerdictLineage,
    verdictStore,
} from "./lib/health-verdict-store";
import { issueOfBranch } from "./lib/issue-worktree";
import {
    describeLandFailures,
    failureComment,
    failureReason,
    type LandFailure,
    labelArgs,
    mergedComment,
    outcomeOf,
    owesPresetSeed,
    parseLandRunnerConfig,
    pinLandRunnerPlatform,
    planTick,
    READY_LABEL,
    SHADOW_LABEL,
    RUNNER_ENV,
    runsHere,
    worktreeOfBranch,
    type LandOutcome,
    type QueuedPr,
} from "./lib/land-runner";
import { notifyOwner } from "./lib/notify-owner";
import { primaryCheckout } from "./lib/primary-checkout";
import { performRelease } from "./lib/queue-claim";
import { readRepairIssues } from "./land";
import { claimLedgerPath } from "./loop-doctor";

/** Where the runner keeps its lock (= pid file), log and per-PR land logs,
 *  relative to the primary checkout. `loop-handoff.sh` reads the lock. */
export const RUNNER_DIR_REL = join(".claude", "telemetry", "land-runner");

/** A live process that IS a land-runner — a stale lock whose pid the OS has
 *  recycled names some other program, and must not keep the runner out. */
function runnerAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
    }
    const ps = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
    });
    return (ps.stdout ?? "").includes("land-runner");
}

function takeLock(path: string): boolean {
    for (let i = 0; i < 2; i++) {
        try {
            const fd = openSync(path, "wx");
            writeFileSync(fd, String(process.pid));
            closeSync(fd);
            return true;
        } catch {
            let pid = Number.NaN;
            try {
                pid = Number(readFileSync(path, "utf8").trim());
            } catch {
                /* released between the two calls — try again */
            }
            if (Number.isInteger(pid) && pid > 0 && runnerAlive(pid))
                return false;
            rmSync(path, { force: true });
        }
    }
    return false;
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
    const r = spawnSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        env: netEnv(process.env),
    });
    return {
        ok: r.status === 0,
        out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),
    };
}

function listQueued(): QueuedPr[] {
    return JSON.parse(
        gh([
            "pr",
            "list",
            "--label",
            READY_LABEL,
            // A merged shadow PR keeps `ready-to-land`; left in, they would
            // fill the 50 rows. `planTick` skips any that slip through.
            "--search",
            `-label:${SHADOW_LABEL}`,
            "--state",
            "all",
            "--limit",
            "50",
            "--json",
            "number,state,headRefName,createdAt,body,labels",
        ])
    ) as QueuedPr[];
}

function remoteBranches(primary: string): Set<string> {
    const r = git(primary, ["ls-remote", "--heads", "origin"]);
    if (!r.ok) throw new Error(`git ls-remote failed: ${r.out.split("\n")[0]}`);
    return new Set(
        r.out
            .split("\n")
            .map((l) => (l.split("\t")[1] ?? "").replace(/^refs\/heads\//, ""))
            .filter(Boolean)
    );
}

/** A worktree the runner could not prepare. `requeue` = an infrastructure
 *  failure (network, disk): the PR stays queued, never `land-failed`. */
class PrepError extends Error {
    readonly requeue: boolean;
    constructor(message: string, requeue: boolean) {
        super(message);
        this.requeue = requeue;
    }
}

/**
 * The worktree `land` runs in, holding EXACTLY what origin has — the runner
 * lands the pushed PR, never a local leftover: the worktree already holding
 * the branch (a session's own, or the one a previous red `land` rebased
 * locally and never pushed) reset hard to origin, or a fresh one beside the
 * primary checkout, bootstrapped. A DIRTY holder is somebody's uncommitted
 * work: refused as `land-failed`, never reset. Whichever it is, the runner
 * removes it once the PR merges (`land` tears down only the
 * `<primary>-issue-N` path).
 */
function prepareWorktree(
    primary: string,
    pr: number,
    branch: string,
    log: (line: string) => void
): { dir: string; created: boolean } {
    const fetch = git(primary, ["fetch", "origin", branch]);
    if (!fetch.ok)
        throw new PrepError(`git fetch origin ${branch}: ${fetch.out}`, true);
    const list = git(primary, ["worktree", "list", "--porcelain"]);
    const existing = list.ok ? worktreeOfBranch(list.out, branch) : null;
    if (existing !== null && existsSync(existing)) {
        const status = git(existing, ["status", "--porcelain"]);
        if (!status.ok || status.out !== "")
            throw new PrepError(
                `worktree ${existing} holds ${branch} with uncommitted changes — commit and push them (or clean the tree), then \`bun run land:ready ${pr}\``,
                false
            );
        const reset = git(existing, ["reset", "--hard", `origin/${branch}`]);
        if (!reset.ok)
            throw new PrepError(
                `could not reset ${existing} to origin/${branch}: ${reset.out}`,
                true
            );
        return { dir: existing, created: false };
    }
    git(primary, ["worktree", "prune"]);
    const dir = join(dirname(primary), `${basename(primary)}-land-${pr}`);
    if (existsSync(dir)) git(primary, ["worktree", "remove", "--force", dir]);
    const add = git(primary, [
        "worktree",
        "add",
        "-B",
        branch,
        dir,
        `origin/${branch}`,
    ]);
    if (!add.ok)
        throw new PrepError(`git worktree add ${dir}: ${add.out}`, true);
    log(`PR #${pr}: worktree ${dir} — bootstrapping`);
    const init = spawnSync("bun", ["run", "worktree:init"], {
        cwd: dir,
        stdio: "ignore",
        env: netEnv(process.env),
    });
    if (init.status !== 0) {
        dropWorktree(primary, dir, branch);
        throw new PrepError(
            `worktree:init failed in ${dir} (exit ${init.status})`,
            true
        );
    }
    return { dir, created: true };
}

function dropWorktree(primary: string, dir: string, branch: string): void {
    git(primary, ["worktree", "remove", "--force", dir]);
    git(primary, ["worktree", "prune"]);
    git(primary, ["branch", "-D", branch]);
}

/** A `gh` call whose failure is logged, never thrown: one failing label
 *  write must not stall the queue behind it. */
function tryGh(args: string[], log: (line: string) => void): boolean {
    try {
        gh(args);
        return true;
    } catch (err) {
        log(
            `gh ${args.slice(0, 3).join(" ")} failed (${(err as Error).message.split("\n")[0]})`
        );
        return false;
    }
}

function prState(pr: number): string | null {
    try {
        return gh([
            "pr",
            "view",
            String(pr),
            "--json",
            "state",
            "--jq",
            ".state",
        ]).trim();
    } catch {
        return null;
    }
}

/** The issue a merged PR named, closed if the merge did not close it — the
 *  step a session took after `land`, which it no longer sees. */
function closeIssueIfOpen(
    issue: number,
    pr: number,
    log: (line: string) => void
): void {
    let state: string;
    try {
        state = gh([
            "issue",
            "view",
            String(issue),
            "--json",
            "state",
            "--jq",
            ".state",
        ]).trim();
    } catch {
        log(`PR #${pr}: could not read issue #${issue}'s state`);
        return;
    }
    if (state !== "OPEN") return;
    if (
        tryGh(
            [
                "issue",
                "close",
                String(issue),
                "--comment",
                `Landed by PR #${pr} (land-runner, issue #5469).`,
            ],
            log
        )
    )
        log(`PR #${pr}: issue #${issue} closed`);
}

/** `seed:preset --all` after a merge that touched a card set — idempotent,
 *  and a failure costs a preset deck, never the landing: logged only. */
function seedPresetsIfOwed(
    pr: number,
    primary: string,
    log: (line: string) => void
): void {
    let paths: string[];
    try {
        paths = gh([
            "pr",
            "view",
            String(pr),
            "--json",
            "files",
            "--jq",
            ".files[].path",
        ])
            .split("\n")
            .filter(Boolean);
    } catch {
        log(`PR #${pr}: could not list its files — seed:preset not checked`);
        return;
    }
    if (!owesPresetSeed(paths)) return;
    const r = spawnSync("bun", ["run", "seed:preset", "--all"], {
        cwd: primary,
        stdio: "ignore",
        env: netEnv(process.env),
    });
    log(`PR #${pr}: seed:preset --all exited ${r.status ?? "on a signal"}`);
}

function applyOutcome(input: {
    pr: QueuedPr;
    outcome: LandOutcome;
    status: number | null;
    logPath: string;
    /** `land`'s output — the merged comment quotes its lane receipt. */
    output: string;
    primary: string;
    log: (line: string) => void;
}): LandFailure | null {
    const { pr, outcome, log } = input;
    if (outcome.action === "merged") {
        log(`PR #${pr.number}: landed`);
        tryGh(labelArgs.unqueue(pr.number), log);
        tryGh(
            [
                "pr",
                "comment",
                String(pr.number),
                "--body",
                mergedComment(input.output),
            ],
            log
        );
        seedPresetsIfOwed(pr.number, input.primary, log);
        const issue = issueOfBranch(pr.headRefName);
        if (issue === null) return null;
        closeIssueIfOpen(issue, pr.number, log);
        const ledger = claimLedgerPath(input.primary);
        try {
            performRelease({
                issue,
                session: "",
                now: Math.floor(Date.now() / 1000),
                by: "land-runner",
                gh: (args) => void gh(args),
                appendRow: (row) => {
                    mkdirSync(dirname(ledger), { recursive: true });
                    appendFileSync(ledger, JSON.stringify(row) + "\n");
                },
            });
            log(`PR #${pr.number}: issue #${issue}'s claim released`);
        } catch (err) {
            // `housekeeping` releases it within the hour (issue #5457).
            log(
                `PR #${pr.number}: claim release for issue #${issue} failed (${(err as Error).message.split("\n")[0]}) — housekeeping retries it`
            );
        }
        return null;
    }
    if (outcome.action === "requeue") {
        log(`PR #${pr.number}: stays queued — ${outcome.reason}`);
        return null;
    }
    log(
        `PR #${pr.number}: land exited ${input.status ?? "on a signal"} — labelling land-failed`
    );
    tryGh(labelArgs.failed(pr.number), log);
    tryGh(
        [
            "pr",
            "comment",
            String(pr.number),
            "--body",
            failureComment({
                status: input.status,
                excerpt: outcome.excerpt,
                logPath: input.logPath,
                repairable: issueOfBranch(pr.headRefName) !== null,
            }),
        ],
        log
    );
    return {
        pr: pr.number,
        reason: failureReason(outcome.excerpt),
        logPath: input.logPath,
    };
}

/** One tick. Returns whether a landing was attempted. */
function tick(opts: {
    primary: string;
    dir: string;
    dryRun: boolean;
    log: (line: string) => void;
    /** Each `land-failed` relabel — the loop notifies the owner once per burst. */
    onFailed: (failure: LandFailure) => void;
}): boolean {
    const { primary, dryRun, log } = opts;
    const queued = listQueued();
    if (queued.length === 0) {
        if (dryRun) log(`no \`${READY_LABEL}\` PR — nothing to land`);
        return false;
    }
    const lineage = readVerdictLineage(() => verdictStore(primary));
    if (lineage.error)
        log(
            `verdict store unreadable (${lineage.error}) — landing as if no RED stands`
        );
    const red = lineageBlocks(lineage.kind);
    const plan = planTick(queued, {
        remoteBranches: remoteBranches(primary),
        red,
        repairIssues: red ? readRepairIssues(primary) : [],
    });
    for (const s of plan.stale) {
        log(`PR #${s.pr}: stale (${s.reason}) — unlabelled`);
        if (!dryRun) tryGh(labelArgs.unqueue(s.pr), log);
    }
    for (const h of plan.held) log(`PR #${h.pr}: held — ${h.reason}`);
    for (const s of plan.shadowed)
        if (dryRun) log(`PR #${s.pr}: skipped — ${s.reason}`);
    const pr = plan.next;
    if (pr === null) return false;
    if (dryRun) {
        log(`would land PR #${pr.number} (${pr.headRefName})`);
        return false;
    }

    const logPath = join(opts.dir, `land-${pr.number}.log`);
    writeFileSync(logPath, "");
    let wt: { dir: string; created: boolean };
    try {
        wt = prepareWorktree(primary, pr.number, pr.headRefName, log);
    } catch (err) {
        const message = (err as Error).message;
        appendFileSync(logPath, `${message}\n`);
        const failure = applyOutcome({
            pr,
            outcome:
                err instanceof PrepError && err.requeue
                    ? { action: "requeue", reason: message }
                    : { action: "failed", excerpt: message },
            status: 1,
            logPath,
            output: message,
            primary,
            log,
        });
        if (failure) opts.onFailed(failure);
        return true;
    }
    log(`PR #${pr.number}: land in ${wt.dir} (log ${logPath})`);
    const runLand = (cwd: string): number | null => {
        const fd = openSync(logPath, "a");
        const r = spawnSync("bun", ["scripts/land.ts", String(pr.number)], {
            cwd,
            env: { ...netEnv(process.env), [RUNNER_ENV]: "1" },
            stdio: ["ignore", fd, fd],
        });
        closeSync(fd);
        return r.status;
    };
    let status = runLand(wt.dir);
    // `land` can exit red AFTER its merge (a post-merge check, a teardown
    // step): a MERGED PR is never `land-failed`. Re-run it — on a merged PR
    // `land` does only its housekeeping — and read the result as a merge.
    if (status !== 0 && status !== null && prState(pr.number) === "MERGED") {
        log(
            `PR #${pr.number}: land exited ${status} but the PR is MERGED — re-running its housekeeping`
        );
        runLand(existsSync(wt.dir) ? wt.dir : primary);
        status = 0;
    }
    const output = readFileSync(logPath, "utf8");
    const outcome = outcomeOf(status, output);
    // `land` tears down only the `<primary>-issue-N` worktree: the runner's
    // own, a `docs/` lane's, or one that survived goes here.
    if (
        existsSync(wt.dir) &&
        (outcome.action === "merged" ||
            (outcome.action === "failed" && wt.created))
    )
        dropWorktree(primary, wt.dir, pr.headRefName);
    const failure = applyOutcome({
        pr,
        outcome,
        status,
        logPath,
        output,
        primary,
        log,
    });
    if (failure) opts.onFailed(failure);
    return true;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const once = args.includes("--once");
    const dryRun = args.includes("--dry-run");
    const intervalAt = args.indexOf("--interval");
    const config = pinLandRunnerPlatform(
        parseLandRunnerConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")))
    );
    let intervalS = config.intervalS;
    if (intervalAt !== -1) {
        intervalS = Number(args[intervalAt + 1]);
        if (!Number.isInteger(intervalS) || intervalS <= 0) {
            console.error(
                "usage: bun run land:runner [--once] [--dry-run] [--interval <seconds>]"
            );
            process.exit(2);
        }
    }
    if (!runsHere(config, process.platform)) {
        console.log(
            `land:runner: this machine is \`${process.platform}\`; the runner runs on \`${config.platform}\` only (tolaria.config.json landRunner.platform) — nothing to do`
        );
        process.exit(args.includes("--host-check") ? 1 : 0);
    }
    if (args.includes("--host-check")) return;

    const primary = primaryCheckout();
    const dir = join(primary, RUNNER_DIR_REL);
    mkdirSync(dir, { recursive: true });
    const runnerLog = join(dir, "runner.log");
    const log = (line: string): void => {
        const stamped = `${new Date().toISOString()} land-runner: ${line}`;
        console.log(stamped);
        if (!dryRun) appendFileSync(runnerLog, `${stamped}\n`);
    };

    const lockPath = join(dir, "runner.lock");
    if (!dryRun && !takeLock(lockPath)) {
        log("another runner holds the lock — exiting");
        return;
    }
    let stopping = false;
    const stop = (): void => {
        stopping = true;
        log("stop requested — exiting after the landing in flight");
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);

    // Failures of a burst of back-to-back ticks leave as ONE notification
    // (issue #5599), flushed when the queue goes quiet or the loop ends.
    let burst: LandFailure[] = [];
    let lastReason: string | null = null;
    const flushBurst = (): void => {
        const message = describeLandFailures(burst, lastReason);
        if (message === null) return;
        lastReason = burst.at(-1)!.reason;
        burst = [];
        log(`notifying the owner: ${message}`);
        notifyOwner(message, "Tolaria land-runner");
    };
    try {
        do {
            let busy = false;
            try {
                busy = tick({
                    primary,
                    dir,
                    dryRun,
                    log,
                    onFailed: (f) => burst.push(f),
                });
            } catch (err) {
                log(`tick failed: ${(err as Error).message.split("\n")[0]}`);
            }
            if (!busy || once || stopping) flushBurst();
            if (once || stopping) break;
            // Straight on to the next PR after a landing; a quiet queue waits.
            if (!busy) {
                for (let s = 0; s < intervalS && !stopping; s++)
                    await Bun.sleep(1000);
            }
        } while (!stopping);
    } finally {
        if (!dryRun) rmSync(lockPath, { force: true });
    }
}

if (import.meta.main) {
    await main();
}
