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
 *      run (nothing processed, watermark kept). The one divergence it repairs
 *      is its own: a `gaps:sync` commit whose push lost a race with a merge
 *      (`strandedAllowlistOnly`) is dropped with `reset --keep` — the next
 *      sync re-derives every number it carried;
 *   2. `gaps:sync` ONCE for the batch — it reconciles the whole allowlist, so
 *      a run per PR would file nothing more. `--band P0` when any PR of the
 *      batch closed P0 work (issue #4158: only P0 changes what is filed; the
 *      accepted cost is that a non-P0 PR's gaps in a P0 hour file under P0).
 *      A failure here does not stop the per-PR steps; it marks every PR of
 *      the batch for retry;
 *   3. per PR, oldest merge first: `grammar:residue` (issue #5222), the
 *      `in-progress` claim release (issue #3130), `umbrella:detach <issue>`
 *      (issue #4235) — for a branch naming an issue; none otherwise;
 *   4. `umbrella:detach --sweep` once (issue #5081).
 *
 * Before any of them, EVERY run — merged PRs or none — releases the claim
 * labels left on closed issues (`claims:sweep-closed`, issue #5572): an issue
 * closed outside step 3's path kept `in-progress` / `pr-open` for good, and
 * this run is a fresh process, so it applies the current release whatever
 * code the long-lived land-runner holds.
 *
 * Every step is idempotent (the reasons are in each script's header), so a
 * re-run is safe. A PR whose steps fail is kept in the state's `retry` list
 * (with the band read on its first attempt — the detach removes the parent
 * edge the band is read from) and re-run next hour, dropped loudly after
 * `MAX_ATTEMPTS`; a failure of step 1 keeps the whole batch for the next run.
 * `grammar:residue`'s `HOLES_EXIT` is a finding, reported and never retried.
 * The watermark moves past every PR the run saw, so a second run with nothing
 * new merged is a no-op.
 *
 * The merged PRs are listed by `updatedAt`, newest first, paging until a PR
 * last updated before the watermark — a merge updates a PR, so nothing merged
 * after the watermark can sit past that page (`gh pr list` orders by
 * creation, and a long-lived PR fell off its window).
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
import { ALLOWLIST_PATH } from "./check-gaps";
import { ALLOWLIST_COMMIT_SUBJECT } from "./gaps-sync";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import type { BoardPriority } from "./lib/board-priority";
import { releaseEditArgs } from "./lib/claim-labels";
import { gh, netEnv } from "./lib/gh";
import { HOLES_EXIT } from "./lib/grammar-residue";
import { issueOfBranch } from "./lib/issue-worktree";
import {
    LIVE_ORIGIN_BAND_DEPS,
    originBandOfIssue,
    type OriginBand,
    type OriginBandDeps,
} from "./lib/origin-band";
import { primaryCheckout } from "./lib/primary-checkout";

/** A merged PR into the base branch. */
export interface MergedPr {
    number: number;
    headRefName: string;
    mergedAt: string;
}

export interface RetryEntry extends MergedPr {
    attempts: number;
    /** The origin band read on the first attempt (issue #4158). */
    band: BoardPriority | null;
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
    /** `grammar:residue`: its `HOLES_EXIT` is a reported finding, not a
     *  failure to retry. */
    holesExit?: boolean;
}

/** Hourly cron × 24 = a day of retries before a PR is given up on. */
export const MAX_ATTEMPTS = 24;

/** No state yet: look back a day. The steps are idempotent, so a PR whose
 *  steps `land` already ran is re-run harmlessly. */
export const FIRST_RUN_LOOKBACK_MS = 24 * 3600_000;

/** 100 PRs a page; 30 pages is weeks of merges at 10 an hour. */
const MAX_PAGES = 30;

/** One page of merged PRs, newest `updatedAt` first. */
export interface MergedPage {
    nodes: (MergedPr & { updatedAt: string })[];
    hasNextPage: boolean;
}

/** Whether a PR merged after `since` can still be on a later page: only if
 *  this page's oldest update is not before it (`updatedAt` ≥ `mergedAt`). */
export function needsNextPage(page: MergedPage, since: string): boolean {
    const last = page.nodes.at(-1);
    return (
        page.hasNextPage &&
        last !== undefined &&
        Date.parse(last.updatedAt) >= Date.parse(since)
    );
}

/**
 * The local commits a fast-forward refused on, when every one of them is a
 * `gaps:sync` allowlist write whose push lost a race — the one divergence
 * this script repairs (by dropping them: the next sync re-derives them).
 * Anything else, or nothing, is false.
 */
export function strandedAllowlistOnly(
    commits: ReadonlyArray<{ subject: string; files: string[] }>
): boolean {
    return (
        commits.length > 0 &&
        commits.every(
            (c) =>
                c.subject === ALLOWLIST_COMMIT_SUBJECT &&
                c.files.length === 1 &&
                c.files[0] === ALLOWLIST_PATH
        )
    );
}

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
        const retry = Array.isArray(s.retry)
            ? s.retry.map((r) => ({ ...r, band: r.band ?? null }))
            : [];
        return { since: s.since, retry };
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
 * the watermark moves past every PR seen; a failure is retried, with the band
 * it ran with, until `MAX_ATTEMPTS`, then `dropped` (the caller says so
 * loudly).
 */
export function nextState(
    state: HousekeepingState,
    pending: MergedPr[],
    failed: ReadonlySet<number>,
    bands: ReadonlyMap<number, BoardPriority | null> = new Map()
): { state: HousekeepingState; dropped: RetryEntry[] } {
    let since = state.since;
    for (const pr of pending)
        if (Date.parse(pr.mergedAt) > Date.parse(since)) since = pr.mergedAt;
    const prior = new Map(state.retry.map((r) => [r.number, r.attempts]));
    const retry: RetryEntry[] = [];
    const dropped: RetryEntry[] = [];
    for (const pr of pending) {
        if (!failed.has(pr.number)) continue;
        const entry: RetryEntry = {
            number: pr.number,
            headRefName: pr.headRefName,
            mergedAt: pr.mergedAt,
            attempts: (prior.get(pr.number) ?? 0) + 1,
            band: bands.get(pr.number) ?? null,
        };
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
            holesExit: true,
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
            argv: ["gh", ...releaseEditArgs(issue)],
        },
        {
            label: `umbrella:detach ${n}`,
            argv: ["bun", "scripts/umbrella-detach.ts", n],
        },
    ];
}

/** Step 0, every run (issue #5572): the claim labels left on closed issues.
 *  A failure is logged and retried by the next run; it holds nothing back. */
export const CLOSED_CLAIMS_STEP: Step = {
    label: "claims:sweep-closed",
    argv: ["bun", "scripts/claims-sweep-closed.ts"],
};

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
            let pid = NaN;
            try {
                pid = Number(readFileSync(path, "utf8").trim());
            } catch {
                /* released between the two calls — try again */
            }
            if (Number.isInteger(pid) && pid > 0 && pidAlive(pid)) return false;
            rmSync(path, { force: true });
        }
    }
    return false;
}

/** Every merged PR updated at or after `since`, paged newest-first. */
function listMergedSince(since: string): MergedPr[] {
    const query = `query($owner: String!, $repo: String!, $base: String!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: MERGED, baseRefName: $base, first: 100, after: $after,
                 orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { number headRefName mergedAt updatedAt }
    }
  }
}`;
    const out: MergedPr[] = [];
    let after: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
        const raw = JSON.parse(
            gh([
                "api",
                "graphql",
                "-f",
                `query=${query}`,
                "-F",
                "owner={owner}",
                "-F",
                "repo={repo}",
                "-f",
                `base=${BASE_BRANCH}`,
                ...(after === null ? [] : ["-f", `after=${after}`]),
            ])
        ) as {
            data: {
                repository: {
                    pullRequests: {
                        pageInfo: { hasNextPage: boolean; endCursor: string };
                        nodes: MergedPage["nodes"];
                    };
                };
            };
        };
        const prs = raw.data.repository.pullRequests;
        const page = {
            nodes: prs.nodes,
            hasNextPage: prs.pageInfo.hasNextPage,
        };
        for (const { number, headRefName, mergedAt } of page.nodes)
            out.push({ number, headRefName, mergedAt });
        if (!needsNextPage(page, since)) return out;
        after = prs.pageInfo.endCursor;
    }
    throw new Error(
        `more than ${MAX_PAGES} pages of merged PRs since ${since} — pass a later --since`
    );
}

/** The primary checkout's commits not on `origin/<base>`, with their files. */
function localCommits(primary: string): { subject: string; files: string[] }[] {
    const git = (args: string[]) =>
        spawnSync("git", ["-C", primary, ...args], {
            encoding: "utf8",
        }).stdout.trim();
    const shas = git(["rev-list", `${ORIGIN_BASE}..HEAD`]);
    return shas === ""
        ? []
        : shas.split("\n").map((sha) => ({
              subject: git(["log", "-1", "--format=%s", sha]),
              files: git([
                  "diff-tree",
                  "--no-commit-id",
                  "--name-only",
                  "-r",
                  sha,
              ]).split("\n"),
          }));
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

    // Step 0: not tied to any merged PR, so it runs before the early returns.
    if (dryRun) {
        say(`would run: ${CLOSED_CLAIMS_STEP.argv.join(" ")}`);
    } else {
        appendFileSync(logPath, `── ${CLOSED_CLAIMS_STEP.label}\n`);
        const swept = spawnSync(
            CLOSED_CLAIMS_STEP.argv[0]!,
            CLOSED_CLAIMS_STEP.argv.slice(1),
            { cwd: primary, env: netEnv(process.env), encoding: "utf8" }
        );
        appendFileSync(logPath, `${swept.stdout ?? ""}${swept.stderr ?? ""}`);
        if (swept.status !== 0)
            say(
                `${CLOSED_CLAIMS_STEP.label} failed (exit ${swept.status ?? swept.signal ?? "?"}) — the next run retries it`
            );
    }

    let state = parseState(
        existsSync(statePath) ? readFileSync(statePath, "utf8") : null,
        Date.now()
    );
    if (sinceArg !== null)
        state = { ...state, since: new Date(sinceArg).toISOString() };

    let merged: MergedPr[];
    try {
        merged = listMergedSince(state.since);
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

    // Read BEFORE any detach: the parent edge is part of the band. A retry
    // reuses the band its first attempt read — that attempt's detach may
    // have removed the edge since.
    const retried = new Map(state.retry.map((r) => [r.number, r.band]));
    const bands = new Map<number, BoardPriority | null>();
    // The board is one ~20 s read: once per run, not once per PR.
    let board: Record<number, BoardPriority> | null = null;
    const bandDeps: OriginBandDeps = {
        readParent: LIVE_ORIGIN_BAND_DEPS.readParent,
        readBoard: () => (board ??= LIVE_ORIGIN_BAND_DEPS.readBoard()),
    };
    for (const pr of pending) {
        if (retried.has(pr.number)) {
            bands.set(pr.number, retried.get(pr.number)!);
            continue;
        }
        const origin = originBandForBranch(pr.headRefName, bandDeps);
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
        if (step.holesExit && r.status === HOLES_EXIT) {
            say(
                `${step.label}: residual gaps with NO open issue — file them by hand (/create-ticket); see ${logPath}`
            );
            return true;
        }
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
    const ff: Step = {
        label: `fast-forward ${BASE_BRANCH}`,
        argv: ["git", "merge", "--ff-only", "-q", ORIGIN_BASE],
    };
    if (
        !run({
            label: `git fetch origin ${BASE_BRANCH}`,
            argv: ["git", "fetch", "origin", BASE_BRANCH, "-q"],
        }) ||
        !(
            run(ff) ||
            (strandedAllowlistOnly(localCommits(primary)) &&
                run({
                    label: `drop a stranded gaps:sync commit (reset --keep ${ORIGIN_BASE})`,
                    argv: ["git", "reset", "--keep", "-q", ORIGIN_BASE],
                }))
        )
    ) {
        say(
            "the primary checkout is not on the merged tip — nothing processed"
        );
        return exit(1);
    }

    // Step 2: one sync for the batch. A failure does not hold back the claim
    // releases and detaches below, but every PR is retried for it.
    const synced = run(gapsSyncStep(band));

    // Step 3: per PR.
    const failed = new Set<number>();
    for (const pr of pending) {
        let ok = synced;
        for (const step of prSteps(pr, bands.get(pr.number)!))
            ok = run(step) && ok;
        if (!ok) failed.add(pr.number);
        say(`PR #${pr.number} (${pr.headRefName}): ${ok ? "done" : "retry"}`);
    }

    // Step 4: the sweep; it always exits 0 on a readable outcome.
    run(SWEEP_STEP);
    closeSync(log);

    const next = nextState(state, pending, failed, bands);
    for (const d of next.dropped)
        say(
            `GIVING UP on PR #${d.number} after ${d.attempts} attempts — run its steps by hand (see ${logPath})`
        );
    writeFileSync(statePath, JSON.stringify(next.state, null, 2));
    return exit(failed.size === 0 ? 0 : 1);
}

if (import.meta.main) main();
