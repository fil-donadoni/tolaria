#!/usr/bin/env bun
/**
 * `bun run housekeeping` — the GitHub-bound post-merge steps `land` used to
 * run inside the mutex (ADR 0154 §5, issue #5457), as an hourly cron.
 *
 * Nobody in a session waits for them, and a GitHub 502 inside `land` cost the
 * session a landing that looked failed on a PR that had merged. Here a 502
 * costs the cron a retry. `land` keeps what the session needs at once: the
 * landing record, the primary fast-forward, the scenario seed, telemetry
 * ingest, the health detach and the teardown.
 *
 * One run walks the PRs merged into the base branch since its WATERMARK
 * (`.claude/telemetry/housekeeping/state.json` in the primary checkout):
 *
 *   1. `git fetch` + fast-forward the primary checkout — `gaps:sync` reads
 *      the merged lockfile from disk and pushes its allowlist write to the
 *      base branch, so a checkout off the base branch or behind it stops the
 *      run (nothing processed, watermark kept);
 *   2. `gaps:sync` ONCE for the batch — it reconciles the whole allowlist, so
 *      a run per PR would file nothing more. `--band P0` when any PR of the
 *      batch closed P0 work (issue #4158: only P0 changes what is filed);
 *   3. per PR, oldest merge first: `grammar:residue` (issue #5222), the
 *      `in-progress` claim release (issue #3130), `umbrella:detach <issue>`
 *      (issue #4235) — for a branch naming an issue; none otherwise;
 *   4. `umbrella:detach --sweep` once (issue #5081).
 *
 * Every step is idempotent (the reasons are in each script's header), so a
 * re-run is safe. A PR whose steps fail is kept in the state's `retry` list
 * and re-run next hour, dropped loudly after `MAX_ATTEMPTS`; a failure of
 * steps 1–2 keeps the whole batch for the next run. The watermark moves past
 * every PR the run saw, so a second run with nothing new merged is a no-op.
 *
 * Cron-friendly: one invocation, exit 0 when there is nothing to do or every
 * step passed, 1 when something is left to retry, 2 on a usage error. The
 * child scripts' output goes to `housekeeping.log` beside the state; stdout
 * carries one line per decision. Runs in the PRIMARY checkout whatever the
 * cwd. Flags: `--dry-run` (print the plan, run and write nothing),
 * `--since <ISO>` (move the watermark back, for a backfill).
 *
 * Every DECISION is a pure function below, tested in
 * `__tests__/housekeeping.test.ts`; `main` is plumbing.
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
import { join } from "node:path";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import type { BoardPriority } from "./lib/board-priority";
import { gh, netEnv } from "./lib/gh";
import { issueOfBranch } from "./lib/issue-worktree";
import {
    LIVE_ORIGIN_BAND_DEPS,
    originBandOfIssue,
    type OriginBand,
    type OriginBandDeps,
} from "./lib/origin-band";
import { primaryCheckout } from "./lib/primary-checkout";

/** A merged PR, as `gh pr list --json number,headRefName,mergedAt` gives it. */
export interface MergedPr {
    number: number;
    headRefName: string;
    mergedAt: string;
}

export interface RetryEntry extends MergedPr {
    attempts: number;
}

export interface HousekeepingState {
    /** ISO time of the newest merge a run has seen; strictly-later merges
     *  are new. */
    since: string;
    /** PRs whose steps failed, kept whole so a PR that fell off the merged
     *  list is still retried. */
    retry: RetryEntry[];
}

/** One step: what it is called in the log, and the argv it runs. */
export interface Step {
    label: string;
    argv: string[];
}

/** Hourly cron × 24 = a day of retries before a PR is given up on. */
export const MAX_ATTEMPTS = 24;

/** No state yet: look back a day. The steps are idempotent, so a PR whose
 *  steps `land` already ran is re-run harmlessly. */
export const FIRST_RUN_LOOKBACK_MS = 24 * 3600_000;

/** `gh pr list` is ordered by creation, not merge; at 10 PRs an hour, 200
 *  covers far more than an hour of merges. */
const MERGED_LIST_LIMIT = 200;

/** The state file's contents, or a first-run state `lookbackMs` before `now`.
 *  A corrupt file is a first run, never a throw: the steps are idempotent. */
export function parseState(
    raw: string | null,
    now: number,
    lookbackMs: number = FIRST_RUN_LOOKBACK_MS
): HousekeepingState {
    const fresh = {
        since: new Date(now - lookbackMs).toISOString(),
        retry: [],
    };
    if (raw === null) return fresh;
    try {
        const s = JSON.parse(raw) as Partial<HousekeepingState>;
        if (typeof s.since !== "string" || Number.isNaN(Date.parse(s.since)))
            return fresh;
        return { since: s.since, retry: Array.isArray(s.retry) ? s.retry : [] };
    } catch {
        return fresh;
    }
}

const byMerge = (a: MergedPr, b: MergedPr): number =>
    Date.parse(a.mergedAt) - Date.parse(b.mergedAt) || a.number - b.number;

/**
 * What this run processes: every PR merged strictly after the watermark, plus
 * every PR left to retry — once each, oldest merge first.
 */
export function pendingPrs(
    merged: MergedPr[],
    state: HousekeepingState
): MergedPr[] {
    const since = Date.parse(state.since);
    const out = new Map<number, MergedPr>();
    for (const r of state.retry)
        out.set(r.number, {
            number: r.number,
            headRefName: r.headRefName,
            mergedAt: r.mergedAt,
        });
    for (const pr of merged)
        if (Date.parse(pr.mergedAt) > since) out.set(pr.number, pr);
    return [...out.values()].sort(byMerge);
}

/**
 * The state after a run that processed `pending` and saw `failed` among them:
 * the watermark moves past every PR seen; a failure is retried until
 * `MAX_ATTEMPTS`, then `dropped` (the caller says so loudly).
 */
export function nextState(
    state: HousekeepingState,
    pending: MergedPr[],
    failed: ReadonlySet<number>
): { state: HousekeepingState; dropped: RetryEntry[] } {
    let since = state.since;
    for (const pr of pending)
        if (Date.parse(pr.mergedAt) > Date.parse(since)) since = pr.mergedAt;
    const prior = new Map(state.retry.map((r) => [r.number, r.attempts]));
    const retry: RetryEntry[] = [];
    const dropped: RetryEntry[] = [];
    for (const pr of pending) {
        if (!failed.has(pr.number)) continue;
        const entry = { ...pr, attempts: (prior.get(pr.number) ?? 0) + 1 };
        (entry.attempts >= MAX_ATTEMPTS ? dropped : retry).push(entry);
    }
    return { state: { since, retry }, dropped };
}

/** `gaps:sync --band` for the batch: only P0 changes what it files
 *  (`gaps-sync.ts` § `--band`), so any P0 origin makes the batch P0. */
export function batchBand(
    bands: ReadonlyArray<BoardPriority | null>
): BoardPriority | null {
    return bands.includes("P0") ? "P0" : null;
}

/** The band of the issue `branch` names, by `queue:plan`'s rule (issue
 *  #4158); null plus a reason, never a throw. */
export function originBandForBranch(
    branch: string,
    deps: OriginBandDeps = LIVE_ORIGIN_BAND_DEPS
): OriginBand {
    const issue = issueOfBranch(branch);
    if (issue === null)
        return { band: null, reason: `branch ${branch} names no issue` };
    return originBandOfIssue(issue, deps);
}

/** Step 2: the one `gaps:sync` of the batch. Files Bot Gaps too (issue
 *  #5301): never `--no-file-bot`. */
export function gapsSyncStep(band: BoardPriority | null): Step {
    return {
        label: `gaps:sync${band === null ? "" : ` --band ${band}`}`,
        argv: [
            "bun",
            "scripts/gaps-sync.ts",
            ...(band === null ? [] : ["--band", band]),
        ],
    };
}

/**
 * Step 3, for one PR: the residue ledger AFTER `gaps:sync` (it reads the
 * claims that step wrote, issue #5222), the claim release, then the umbrella
 * detach — the issue is closed by now, which is what the detach requires.
 * Empty for a branch that names no issue.
 */
export function prSteps(pr: MergedPr, band: BoardPriority | null): Step[] {
    const issue = issueOfBranch(pr.headRefName);
    if (issue === null) return [];
    const n = String(issue);
    return [
        {
            label: `grammar:residue ${n} --pr ${pr.number}`,
            argv: [
                "bun",
                "scripts/grammar-residue.ts",
                n,
                "--pr",
                String(pr.number),
                ...(band === null ? [] : ["--band", band]),
            ],
        },
        {
            label: `release claim on issue #${n}`,
            argv: [
                "gh",
                "issue",
                "edit",
                n,
                "--remove-label",
                "in-progress",
                "--remove-assignee",
                "@me",
            ],
        },
        {
            label: `umbrella:detach ${n}`,
            argv: ["bun", "scripts/umbrella-detach.ts", n],
        },
    ];
}

/** Step 4: every other closed child of every censused umbrella. */
export const SWEEP_STEP: Step = {
    label: "umbrella:detach --sweep",
    argv: ["bun", "scripts/umbrella-detach.ts", "--sweep"],
};

// ─────────────────────────────────────────────────────────────────────────
// main — plumbing
// ─────────────────────────────────────────────────────────────────────────

function flag(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : (process.argv[i + 1] ?? null);
}

function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** One run at a time; a lock whose pid is dead is taken over. */
function takeLock(path: string): boolean {
    for (let i = 0; i < 2; i++) {
        try {
            const fd = openSync(path, "wx");
            writeFileSync(fd, String(process.pid));
            closeSync(fd);
            return true;
        } catch {
            const pid = Number(readFileSync(path, "utf8").trim());
            if (Number.isInteger(pid) && pid > 0 && pidAlive(pid)) return false;
            rmSync(path, { force: true });
        }
    }
    return false;
}

function main(): void {
    const dryRun = process.argv.includes("--dry-run");
    const sinceArg = flag("--since");
    if (sinceArg !== null && Number.isNaN(Date.parse(sinceArg))) {
        console.error(
            "usage: bun run housekeeping [--dry-run] [--since <ISO time>]"
        );
        process.exit(2);
    }

    const primary = primaryCheckout();
    const dir = join(primary, ".claude", "telemetry", "housekeeping");
    mkdirSync(dir, { recursive: true });
    const statePath = join(dir, "state.json");
    const logPath = join(dir, "housekeeping.log");
    const say = (line: string): void => {
        const stamped = `${new Date().toISOString()} housekeeping: ${line}`;
        console.log(stamped);
        appendFileSync(logPath, `${stamped}\n`);
    };

    const lockPath = join(dir, "housekeeping.lock");
    if (!dryRun && !takeLock(lockPath)) {
        say("another run holds the lock — nothing to do");
        return;
    }
    const exit = (code: number): never => {
        if (!dryRun) rmSync(lockPath, { force: true });
        process.exit(code);
    };

    let state = parseState(
        existsSync(statePath) ? readFileSync(statePath, "utf8") : null,
        Date.now()
    );
    if (sinceArg !== null)
        state = { ...state, since: new Date(sinceArg).toISOString() };

    let merged: MergedPr[];
    try {
        merged = JSON.parse(
            gh([
                "pr",
                "list",
                "--state",
                "merged",
                "--base",
                BASE_BRANCH,
                "--limit",
                String(MERGED_LIST_LIMIT),
                "--json",
                "number,headRefName,mergedAt",
            ])
        ) as MergedPr[];
    } catch (err) {
        say(
            `could not list merged PRs (${(err as Error).message.split("\n")[0]}) — retry next run`
        );
        return exit(1);
    }

    const pending = pendingPrs(merged, state);
    if (pending.length === 0) {
        say(`nothing merged since ${state.since}`);
        if (!dryRun) writeFileSync(statePath, JSON.stringify(state, null, 2));
        return exit(0);
    }
    say(
        `${pending.length} PR(s) since ${state.since}: ${pending.map((p) => `#${p.number}`).join(" ")}`
    );

    // Read BEFORE any detach: the parent edge is part of the band.
    const bands = new Map<number, BoardPriority | null>();
    for (const pr of pending) {
        const origin = originBandForBranch(pr.headRefName);
        if (origin.reason !== undefined && issueOfBranch(pr.headRefName))
            say(`PR #${pr.number}: no --band (${origin.reason})`);
        bands.set(pr.number, origin.band);
    }
    const band = batchBand([...bands.values()]);

    if (dryRun) {
        for (const step of [
            gapsSyncStep(band),
            ...pending.flatMap((pr) => prSteps(pr, bands.get(pr.number)!)),
            SWEEP_STEP,
        ])
            say(`would run: ${step.argv.join(" ")}`);
        return exit(0);
    }

    const log = openSync(logPath, "a");
    const env = netEnv(process.env);
    const run = (step: Step): boolean => {
        appendFileSync(logPath, `── ${step.label}\n`);
        const r = spawnSync(step.argv[0]!, step.argv.slice(1), {
            cwd: primary,
            env,
            stdio: ["ignore", log, log],
        });
        const ok = r.status === 0;
        if (!ok)
            say(`${step.label} failed (exit ${r.status ?? r.signal ?? "?"})`);
        return ok;
    };

    // Step 1: the merged tree on disk, on the base branch.
    const head = spawnSync(
        "git",
        ["-C", primary, "symbolic-ref", "--quiet", "--short", "HEAD"],
        { encoding: "utf8" }
    ).stdout.trim();
    if (head !== BASE_BRANCH) {
        say(
            `${primary} is on ${head || "a detached HEAD"}, not ${BASE_BRANCH} — gaps:sync would push from the wrong branch; nothing processed`
        );
        return exit(1);
    }
    if (
        !run({
            label: `git fetch origin ${BASE_BRANCH}`,
            argv: ["git", "fetch", "origin", BASE_BRANCH, "-q"],
        }) ||
        !run({
            label: `fast-forward ${BASE_BRANCH}`,
            argv: ["git", "merge", "--ff-only", "-q", ORIGIN_BASE],
        })
    ) {
        say(
            "the primary checkout is not on the merged tip — nothing processed"
        );
        return exit(1);
    }

    // Step 2: one sync for the batch; a failure keeps the batch.
    if (!run(gapsSyncStep(band))) return exit(1);

    // Step 3: per PR.
    const failed = new Set<number>();
    for (const pr of pending) {
        let ok = true;
        for (const step of prSteps(pr, bands.get(pr.number)!))
            ok = run(step) && ok;
        if (!ok) failed.add(pr.number);
        say(`PR #${pr.number} (${pr.headRefName}): ${ok ? "done" : "retry"}`);
    }

    // Step 4: the sweep; it always exits 0 on a readable outcome.
    run(SWEEP_STEP);
    closeSync(log);

    const next = nextState(state, pending, failed);
    for (const d of next.dropped)
        say(
            `GIVING UP on PR #${d.number} after ${d.attempts} attempts — run its steps by hand (see ${logPath})`
        );
    writeFileSync(statePath, JSON.stringify(next.state, null, 2));
    return exit(failed.size === 0 ? 0 : 1);
}

if (import.meta.main) main();
