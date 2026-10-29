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
 *   1. list `ready-to-land` PRs (`--state all`): a row whose own labels are
 *      not `ready-to-land` without `land-failed` is the search index lagging
 *      a relabel — held; a closed/merged one, or one whose
 *      branch is gone from origin, is STALE — unlabelled and logged;
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
 *      any other red is classified (`classifyRed`) from the
 *      lane's sidecar JSON (`TOLARIA_LANE_JSON_OUT`) and `land`'s own
 *      output: `regenerable` → `pr:fixup run --in-place` in the worktree
 *      `land` rebased, the PR stays queued; `infra` → stays queued, retried
 *      after `INFRA_BACKOFF_S`; `needs-pass` → `land-failed` + a comment
 *      carrying the class and the lane excerpt, which `queue:plan` turns
 *      into a repair pick. A `gh` write that fails is logged, never thrown,
 *      so one PR cannot stall the queue.
 *
 * The runner does not reload its own code in place: before each tick it
 * reads `RUNNER_SOURCE_PATHS` at the primary's HEAD and, once they moved,
 * exits `RESTART_EXIT` when launchd supervises it
 * (`KeepAlive.SuccessfulExit = false` starts it on the new code), or says so
 * once when started by hand, whose next start does.
 *
 * Flags: `--once` (one tick, then exit — cron/launchd-friendly), `--dry-run`
 * (print the tick's plan, touch nothing), `--interval <s>` (between ticks;
 * default `landRunner.intervalS`), `--host-check` (exit 0 iff this machine
 * runs the runner — one authority). Refuses (exit 0, so a supervisor does not
 * respawn it) on a machine whose platform is not `landRunner.platform`.
 * SIGTERM/SIGINT stop it AFTER the landing in flight — a `land` killed
 * mid-merge is a worse state than a late stop. The lock file holds the pid.
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
import { LANE_JSON_OUT_ENV } from "./check-lane";
import { CONFIG_PATH } from "./lib/branches";
import { gh, netEnv } from "./lib/gh";
import {
    lineageBlocks,
    readVerdictLineage,
    verdictStore,
} from "./lib/health-verdict-store";
import { issueOfBranch } from "./lib/issue-worktree";
import {
    betweenTicks,
    describeLandFailures,
    failureComment,
    failureReason,
    INFRA_BACKOFF_S,
    type LandFailure,
    labelArgs,
    landExcerpt,
    launchdSupervised,
    mergedComment,
    outcomeOf,
    owesPresetSeed,
    parseLandRunnerConfig,
    pinLandRunnerPlatform,
    planTick,
    READY_LABEL,
    RESTART_EXIT,
    RUNNER_SOURCE_PATHS,
    MANUAL_LABEL,
    RUNNER_ENV,
    runsHere,
    checkSources,
    worktreeOfBranch,
    type LandOutcome,
    type QueuedPr,
} from "./lib/land-runner";
import { notifyOwner } from "./lib/notify-owner";
import { primaryCheckout } from "./lib/primary-checkout";
import { FIXUP_PUSHED_RE, type LaneJson } from "./pr-fixup";
import type { Deferral } from "./lib/land-runner";
import { performRelease } from "./lib/queue-claim";
import { readRepairIssues } from "./land";
import { claimLedgerPath } from "./lib/claim-verdict";

/** Where the runner keeps its lock (= pid file), log and per-PR land logs,
 *  relative to the primary checkout. */
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
            // A merged queue PR keeps `ready-to-land`; left in, they would
            // fill the 50 rows. `planTick` skips any that slip through.
            "--search",
            `label:"${MANUAL_LABEL}"`,
            "--state",
            "all",
            "--limit",
            "50",
            "--json",
            "number,state,headRefName,createdAt,body,labels",
        ])
    ) as QueuedPr[];
}

/** `RUNNER_SOURCE_PATHS`' ids at the primary's HEAD, one line each, or null
 *  when git cannot read them. Stdout only: a warning on stderr is no id. */
function sourceIdentity(primary: string): string | null {
    const r = spawnSync(
        "git",
        [
            "-C",
            primary,
            "rev-parse",
            ...RUNNER_SOURCE_PATHS.map((p) => `HEAD:${p}`),
        ],
        { encoding: "utf8" }
    );
    return r.status === 0 ? (r.stdout ?? "").trim() : null;
}

/** `scripts 1a2b3c4d, tolaria.config.json 5e6f7a8b` — a log's view of an
 *  identity. */
function shortIdentity(identity: string): string {
    return identity
        .split("\n")
        .map((id, i) => `${RUNNER_SOURCE_PATHS[i] ?? "?"} ${id.slice(0, 8)}`)
        .join(", ");
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
): { dir: string; created: boolean; head: string } {
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
        return {
            dir: existing,
            created: false,
            head: git(existing, ["rev-parse", "HEAD"]).out,
        };
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
    return { dir, created: true, head: git(dir, ["rev-parse", "HEAD"]).out };
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

/** The sidecar lane receipt `land`'s `check:lane` wrote for this landing
 *  (`TOLARIA_LANE_JSON_OUT`), or null when it wrote none — the lane was
 *  skipped as already gated, never reached, or died before its receipt. */
function readLaneJson(path: string): LaneJson | null {
    try {
        return JSON.parse(readFileSync(path, "utf8")) as LaneJson;
    } catch {
        return null;
    }
}

/** Subjects of the PR's commits, newest last — `classifyRed`'s fixup bound.
 *  Unreadable → `[]`: the bound then holds one landing later, inside
 *  `pr:fixup run`'s own refusal. */
function prSubjects(pr: number, log: (line: string) => void): string[] {
    try {
        return gh([
            "pr",
            "view",
            String(pr),
            "--json",
            "commits",
            "--jq",
            ".commits[].messageHeadline",
        ])
            .split("\n")
            .filter(Boolean);
    } catch {
        log(
            `PR #${pr}: could not read its commits — fixup bound not checked here`
        );
        return [];
    }
}

/**
 * A `regenerable` red (issue #5955): `pr:fixup run --in-place` in the
 * worktree `land` rebased — the same table, refusals and commit the
 * `pr-fixup` job uses — with the repository's `TRUSTED_AUTHORS`. The result
 * is read back as a `LandOutcome`: pushed → stays queued (the next tick
 * lands the fixed tip); anything else → `land-failed`, so a fixup that
 * cannot push never loops.
 */
function runFixup(input: {
    pr: number;
    fixes: readonly string[];
    cwd: string;
    /** The sha `prepareWorktree` reset the worktree to — the push's lease. */
    lease: string;
    logPath: string;
    log: (line: string) => void;
}): Exclude<LandOutcome, { action: "fixup" }> {
    const { pr, fixes, log } = input;
    let trusted = "";
    try {
        trusted = gh(["variable", "get", "TRUSTED_AUTHORS"]).trim();
    } catch {
        log(`PR #${pr}: TRUSTED_AUTHORS unreadable — fixup refused`);
    }
    const r = spawnSync(
        "bun",
        [
            "scripts/pr-fixup.ts",
            "run",
            "--pr",
            String(pr),
            "--fixes",
            fixes.join(","),
            "--in-place",
            "--lease",
            input.lease,
        ],
        {
            cwd: input.cwd,
            encoding: "utf8",
            env: { ...netEnv(process.env), TRUSTED_AUTHORS: trusted },
            maxBuffer: 64 << 20,
        }
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    appendFileSync(
        input.logPath,
        `\n--- pr:fixup run (${fixes.join(", ")}) ---\n${out}`
    );
    if (r.status === 0 && FIXUP_PUSHED_RE.test(out)) {
        log(
            `PR #${pr}: fixed up (${fixes.join(", ")}) and pushed — stays queued`
        );
        return {
            action: "requeue",
            reason: `fixed up (${fixes.join(", ")}) — the next tick lands the regenerated tip`,
        };
    }
    // A fixup that stopped short leaves regenerated files, or a commit the
    // lease refused: the worktree goes back to a clean tree, or the next
    // `land:ready` is refused on "uncommitted changes" that are nobody's.
    git(input.cwd, ["reset", "--hard"]);
    git(input.cwd, ["clean", "-fd"]);
    const last = out.trim().split("\n").at(-1) ?? `exit ${r.status}`;
    return {
        action: "failed",
        excerpt: landExcerpt(readFileSync(input.logPath, "utf8")),
        cause: `regenerable (${fixes.join(", ")}) but the fixup did not push: ${last.slice(0, 160)}`,
    };
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
    /** `fixup` is resolved by `tick` (`runFixup`) before it gets here. */
    outcome: Exclude<LandOutcome, { action: "fixup" }>;
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
                cause: outcome.cause,
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
    /** PR → its infra backoff (issue #5955). */
    deferred: Map<number, Deferral>;
}): boolean {
    const { primary, dryRun, log, deferred } = opts;
    const queued = listQueued();
    // A deferred PR that left the queue (merged by hand, closed, unlabelled)
    // takes its row with it.
    for (const n of [...deferred.keys()])
        if (!queued.some((q) => q.number === n)) deferred.delete(n);
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
        deferred,
        now: Date.now(),
    });
    for (const s of plan.stale) {
        log(`PR #${s.pr}: stale (${s.reason}) — unlabelled`);
        if (!dryRun) tryGh(labelArgs.unqueue(s.pr), log);
    }
    for (const h of plan.held) log(`PR #${h.pr}: held — ${h.reason}`);
    for (const s of plan.queued)
        if (dryRun) log(`PR #${s.pr}: skipped — ${s.reason}`);
    const pr = plan.next;
    if (pr === null) return false;
    if (dryRun) {
        log(`would land PR #${pr.number} (${pr.headRefName})`);
        return false;
    }

    const logPath = join(opts.dir, `land-${pr.number}.log`);
    writeFileSync(logPath, "");
    // The lane's sidecar receipt for THIS landing — a stale one from a
    // previous landing of the same PR would classify the wrong red.
    const laneJsonPath = join(opts.dir, `land-${pr.number}.lane.json`);
    rmSync(laneJsonPath, { force: true });
    let wt: { dir: string; created: boolean; head: string };
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
                    : {
                          action: "failed",
                          excerpt: message,
                          cause: "the worktree could not be prepared",
                      },
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
            env: {
                ...netEnv(process.env),
                [RUNNER_ENV]: "1",
                [LANE_JSON_OUT_ENV]: laneJsonPath,
            },
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
    const landed = outcomeOf(
        status,
        output,
        status === 0
            ? { lane: null, subjects: [] }
            : {
                  lane: readLaneJson(laneJsonPath),
                  subjects: prSubjects(pr.number, log),
                  infraStrikes: deferred.get(pr.number)?.strikes ?? 0,
              }
    );
    if (landed.action === "fixup")
        log(
            `PR #${pr.number}: red is regenerable (${landed.fixes.join(", ")}) — fixing up in ${wt.dir}`
        );
    const outcome =
        landed.action === "fixup"
            ? runFixup({
                  pr: pr.number,
                  fixes: landed.fixes,
                  cwd: wt.dir,
                  lease: wt.head,
                  logPath,
                  log,
              })
            : landed;
    if (outcome.action === "requeue" && outcome.backoffS !== undefined) {
        deferred.set(pr.number, {
            until: Date.now() + outcome.backoffS * 1000,
            strikes: (deferred.get(pr.number)?.strikes ?? 0) + 1,
        });
        log(
            `PR #${pr.number}: retried in ${outcome.backoffS}s (${INFRA_BACKOFF_S}s infra backoff)`
        );
    } else deferred.delete(pr.number);
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
    const deferred = new Map<number, Deferral>();
    const flushBurst = (): void => {
        const message = describeLandFailures(burst, lastReason);
        if (message === null) return;
        lastReason = burst.at(-1)!.reason;
        burst = [];
        log(`notifying the owner: ${message}`);
        notifyOwner(message, "Tolaria land-runner");
    };
    // The code this process loaded (issue #5941), checked at the top of every
    // iteration so a runner change merged during the sleep never runs one
    // more tick on the old code — `checkSources` decides. `--once` and
    // `--dry-run` end anyway.
    const supervised = launchdSupervised(process.env);
    const startedFrom = once || dryRun ? null : sourceIdentity(primary);
    if (!once && !dryRun && startedFrom === null)
        log(
            "cannot read the runner's own sources at the primary's HEAD — a runner change will not restart it"
        );
    let unreadable = false;
    let warned = false;
    let restart = false;
    try {
        do {
            const now = startedFrom === null ? null : sourceIdentity(primary);
            const check = checkSources(startedFrom, now, supervised);
            if (check === "unreadable" && !unreadable)
                log(
                    "cannot read the runner's own sources at the primary's HEAD — no restart check until it can"
                );
            unreadable = check === "unreadable";
            if (check === "restart") {
                log(
                    `runner sources changed (${shortIdentity(startedFrom!)} → ${shortIdentity(now!)}) — exiting ${RESTART_EXIT} for launchd to restart it on the new code`
                );
                flushBurst();
                restart = true;
                break;
            }
            if (check === "warn" && !warned) {
                log(
                    `runner sources changed (${shortIdentity(startedFrom!)} → ${shortIdentity(now!)}) under a runner launchd does not supervise — restart it (stop the pid in its lock, then \`bun run land:runner\`)`
                );
                warned = true;
            }
            let busy = false;
            try {
                busy = tick({
                    primary,
                    dir,
                    dryRun,
                    log,
                    onFailed: (f) => burst.push(f),
                    deferred,
                });
            } catch (err) {
                log(`tick failed: ${(err as Error).message.split("\n")[0]}`);
            }
            if (!busy || once || stopping) flushBurst();
            if (once || stopping) break;
            // Straight on to the next PR after a landing, past one event-loop
            // turn that serves a pending stop; a quiet queue waits.
            await betweenTicks(busy, intervalS, () => stopping, Bun.sleep);
        } while (!stopping);
    } finally {
        if (!dryRun) rmSync(lockPath, { force: true });
    }
    if (restart) process.exit(RESTART_EXIT);
}

if (import.meta.main) {
    await main();
}
