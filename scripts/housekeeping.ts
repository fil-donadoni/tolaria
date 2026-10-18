#!/usr/bin/env bun
/**
 * `bun run housekeeping` — the GitHub-bound post-merge steps `land` used to
 * run inside the mutex (ADR 0154 §5, issue #5457), as an hourly job of
 * `post-merge.yml` on ANY lane runner (issue #5873).
 *
 * Nobody in a session waits for them, and a GitHub 502 inside `land` cost the
 * session a landing that looked failed on a PR that had merged. Here a 502
 * costs the run a retry. `land` keeps what the session needs at once: the
 * landing record, the primary fast-forward, the scenario seed, telemetry
 * ingest, the health detach and the teardown.
 *
 * NOTHING HERE IS MACHINE-LOCAL (issue #5873). The run used to fast-forward
 * the primary checkout and work in it, with its watermark in a file beside
 * it — so the job was pinned to one host, a diverged primary failed every
 * run, and no other machine could resume the batch. Now:
 *
 *   - the WATERMARK and the retry list are shared state (`lib/shared-state.ts`,
 *     the `housekeeping` key of `refs/tolaria/state` on origin), read at the
 *     start and written back with a compare-and-swap: a run on machine B
 *     resumes exactly where a run on machine A stopped, and two runs that
 *     raced each other cannot both move the watermark (the loser exits 1 and
 *     the next hour re-reads). A local `state.json` from before this is read
 *     once, as the first shared state, when the ref does not exist yet;
 *   - the WORK happens in a throwaway worktree of `origin/<base>` beside the
 *     primary checkout (`<primary>-housekeeping-<pid>`), bootstrapped by
 *     `worktree:init`, removed when the run ends. `gaps:sync` reads the
 *     merged lockfile and allowlist from that tree and pushes its allowlist
 *     commit from it. A push that loses a race with a merge is rebuilt once
 *     on the fetched tip; one that loses twice, or misses its deadline, is a
 *     failed sync (`gaps:sync` exits 1 on it, issues #5871, #5933): the batch
 *     is retried, the owner told, the worktree goes and the next run reclaims
 *     by title. The
 *     primary checkout's branch, divergence or dirt never enters the
 *     picture;
 *   - the RED is visible: a run that leaves a PR to retry, drops one, or
 *     cannot read or write its state notifies the owner (`lib/notify-owner.ts`,
 *     the channel a RED uses) — once per distinct notice, so the hourly
 *     retry of one failure is one message, not twenty-four. The notice of a
 *     run that processed PRs is remembered in the shared state (either
 *     machine dedupes it); the notice of a run that could not start (no
 *     state, no workspace, no PR list) in this machine's marker file.
 *
 * One run walks the PRs merged into the base branch since the watermark:
 *
 *   1. the workspace: `git fetch` into the primary's object store, the
 *      throwaway worktree at `origin/<base>`, `worktree:init` there;
 *   2. `gaps:sync` ONCE for the batch — it reconciles the whole allowlist, so
 *      a run per PR would file nothing more. Never `--band`: a gap's parent
 *      is its computed Target umbrella, whatever band the PRs of the batch
 *      closed (issue #5871 retired issue #4158's origin band, which filed a
 *      whole batch's gaps under P0 for one P0 PR). A failure here — a lost
 *      allowlist write-back included, `gaps:sync` exits 1 on it — does not
 *      stop the per-PR steps; it marks every PR of the batch for retry;
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
 * and re-run next hour, dropped loudly after `MAX_ATTEMPTS`; a failure of
 * step 1 keeps the whole batch for the next run.
 * `grammar:residue`'s `HOLES_EXIT` is a finding, reported and never retried.
 * The watermark moves past every PR the run saw, so a second run with nothing
 * new merged is a no-op — and writes nothing.
 *
 * The merged PRs are listed by `updatedAt`, newest first, paging until a PR
 * last updated before the watermark — a merge updates a PR, so nothing merged
 * after the watermark can sit past that page (`gh pr list` orders by
 * creation, and a long-lived PR fell off its window).
 *
 * Cron-friendly: one invocation, exit 0 when there is nothing to do or every
 * step passed, 1 when something is left to retry, 2 on a usage error. The
 * child scripts' output goes to `housekeeping.log` under the primary
 * checkout's `.claude/telemetry/housekeeping/` (a log, not state); stdout
 * carries one line per decision. Flags: `--dry-run` (print the plan, run and
 * write nothing), `--since <ISO>` (move the watermark back, for a backfill).
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
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { GIT_NET_TIMEOUT_MS } from "./gaps-sync";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { releaseEditArgs } from "./lib/claim-labels";
import { gh, netEnv } from "./lib/gh";
import { HOLES_EXIT } from "./lib/grammar-residue";
import { issueOfBranch } from "./lib/issue-worktree";
import { forgetNotice, notifyOnce, notifyOwner } from "./lib/notify-owner";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    SharedStateConflict,
    readSharedState,
    writeSharedState,
} from "./lib/shared-state";

/** A merged PR into the base branch. */
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
    /** The last notice sent to the owner (issue #5873); the same text is not
     *  sent twice in a row. Absent until a run went red. */
    lastNotice?: string;
}

/** One step: what it is called in the log, and the argv it runs. */
export interface Step {
    label: string;
    argv: string[];
    /** `grammar:residue`: its `HOLES_EXIT` is a reported finding, not a
     *  failure to retry. */
    holesExit?: boolean;
    /** Killed past this: a failure the batch retries, never a stall that
     *  only the job's `timeout-minutes` ends (issue #5933). */
    timeoutMs?: number;
}

/** The shared-state key of the watermark and retry list (issue #5873). */
export const STATE_KEY = "housekeeping";

/** A network-bound git step (`fetch`): the same deadline as `gaps:sync`'s
 *  own push (issue #5933). */
export const GIT_STEP_TIMEOUT_MS = GIT_NET_TIMEOUT_MS;

/** `gaps:sync`'s ceiling: about 3× its slowest measured healthy run on the
 *  Huawei (~10 min filing 20 gaps), and well inside the job's 50 minutes, so
 *  housekeeping itself reports the failure and keeps the batch in `retry`.
 *  Killing it is safe: its write-back never leaves the checkout ahead of the
 *  remote (issue #5933). */
export const GAPS_SYNC_TIMEOUT_MS = 30 * 60_000;

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
        // `band` — a state written before issue #5871 — is dropped: no
        // step reads it any more.
        const retry = Array.isArray(s.retry)
            ? s.retry.map(({ number, headRefName, mergedAt, attempts }) => ({
                  number,
                  headRefName,
                  mergedAt,
                  attempts,
              }))
            : [];
        return {
            since: s.since,
            retry,
            ...(typeof s.lastNotice === "string"
                ? { lastNotice: s.lastNotice }
                : {}),
        };
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
        const entry: RetryEntry = {
            number: pr.number,
            headRefName: pr.headRefName,
            mergedAt: pr.mergedAt,
            attempts: (prior.get(pr.number) ?? 0) + 1,
        };
        (entry.attempts >= MAX_ATTEMPTS ? dropped : retry).push(entry);
    }
    return { state: { since, retry }, dropped };
}

/**
 * The owner's notice for a run that went red (issue #5873): what is left to
 * retry, what was dropped, or the reason nothing ran. `null` for a green
 * run. Pure.
 */
export function redSummary(input: {
    retry: readonly RetryEntry[];
    dropped: readonly RetryEntry[];
    reason?: string;
    /** The shared-state write failed: the watermark did not move. */
    writeFailed?: string;
}): string | null {
    if (input.reason !== undefined) return `housekeeping: ${input.reason}`;
    const parts: string[] = [];
    if (input.writeFailed !== undefined)
        parts.push(`state not written (${input.writeFailed})`);
    if (input.retry.length > 0)
        parts.push(
            `${input.retry.length} PR(s) left to retry: ${input.retry.map((r) => `#${r.number}`).join(" ")}`
        );
    if (input.dropped.length > 0)
        parts.push(
            `GAVE UP on ${input.dropped.map((d) => `#${d.number}`).join(" ")} after ${MAX_ATTEMPTS} attempts`
        );
    return parts.length === 0 ? null : `housekeeping: ${parts.join("; ")}`;
}

/** Whether `summary` is sent: a red that reads like the last one sent is
 *  not re-sent (the hourly retry of one failure is one notice). Pure. */
export function noticeDue(
    summary: string | null,
    lastNotice: string | undefined
): boolean {
    return summary !== null && summary !== lastNotice;
}

/** The state carried to the next run: a red run's summary, so the next red
 *  compares against it; a green run clears it, so the same failure after a
 *  green gap is news again. Pure. */
export function withNotice(
    state: HousekeepingState,
    summary: string | null
): HousekeepingState {
    const rest: HousekeepingState = { since: state.since, retry: state.retry };
    return summary === null ? rest : { ...rest, lastNotice: summary };
}

/** Step 2: the one `gaps:sync` of the batch. Files Bot Gaps too (issue
 *  #5301): never `--no-file-bot`; never `--band` (issue #5871). */
export const GAPS_SYNC_STEP: Step = {
    label: "gaps:sync",
    argv: ["bun", "scripts/gaps-sync.ts"],
    timeoutMs: GAPS_SYNC_TIMEOUT_MS,
};

/** Whether a PR's steps left it for retry: the batch's `gaps:sync` failed
 *  (a lost allowlist write-back included, issue #5871), or one of its own
 *  steps did. `done` only when both held. */
export function prRetried(synced: boolean, ownStepsOk: boolean): boolean {
    return !(synced && ownStepsOk);
}

/**
 * Step 3, for one PR: the residue ledger AFTER `gaps:sync` (it reads the
 * claims that step wrote, issue #5222), the claim release, then the umbrella
 * detach — the issue is closed by now, which is what the detach requires.
 * Empty for a branch that names no issue.
 */
export function prSteps(pr: MergedPr): Step[] {
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
// The workspace — a throwaway worktree of origin/<base> (issue #5873)
// ─────────────────────────────────────────────────────────────────────────

/** `<primary>-housekeeping-<pid>`: beside the primary, like an issue
 *  worktree, never inside it. */
export function workspacePath(primary: string, pid: number): string {
    return `${primary}-housekeeping-${pid}`;
}

/** The workspaces killed runs left registered — every worktree at a path
 *  `workspacePath` would produce for this primary. Pure over
 *  `git worktree list --porcelain`. */
export function staleWorkspaces(porcelain: string, primary: string): string[] {
    const prefix = `worktree ${primary}-housekeeping-`;
    return porcelain
        .split("\n")
        .filter((l) => l.startsWith(prefix) && /-\d+$/.test(l))
        .map((l) => l.slice("worktree ".length));
}

function gitIn(
    cwd: string,
    args: string[],
    timeoutMs?: number
): { ok: boolean; err: string } {
    const r = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
    });
    const timedOut =
        r.error !== undefined &&
        (r.error as { code?: string }).code === "ETIMEDOUT";
    return {
        ok: r.status === 0,
        err: timedOut
            ? `no answer within ${(timeoutMs ?? 0) / 1000}s`
            : (r.stderr ?? "").trim(),
    };
}

/**
 * Create the workspace: fetch the base into the primary's object store,
 * forget the workspaces of killed runs, add a detached worktree at
 * `origin/<base>`, and (unless `bootstrap` is false — tests) run
 * `worktree:init` in it. Touches the primary's `.git` only, never its tree,
 * branch or index — a diverged or dirty primary is no obstacle. Throws with
 * the failing step named.
 */
export function prepareWorkspace(
    primary: string,
    opts: { pid?: number; bootstrap?: boolean } = {}
): string {
    // `git worktree list` prints resolved paths (macOS: /var → /private/var).
    primary = realpathSync(primary);
    const wt = workspacePath(primary, opts.pid ?? process.pid);
    const step = (what: string, r: { ok: boolean; err: string }): void => {
        if (!r.ok) throw new Error(`${what} failed: ${r.err}`);
    };
    step(
        `git fetch origin ${BASE_BRANCH}`,
        gitIn(
            primary,
            [
                "fetch",
                "--no-tags",
                "--no-write-fetch-head",
                "--quiet",
                "origin",
                BASE_BRANCH,
            ],
            GIT_STEP_TIMEOUT_MS
        )
    );
    const listed = spawnSync("git", ["worktree", "list", "--porcelain"], {
        cwd: primary,
        encoding: "utf8",
    }).stdout;
    for (const stale of staleWorkspaces(listed ?? "", primary))
        gitIn(primary, ["worktree", "remove", "--force", "--force", stale]);
    gitIn(primary, ["worktree", "prune"]);
    rmSync(wt, { recursive: true, force: true });
    step(
        `git worktree add ${wt}`,
        gitIn(primary, [
            "worktree",
            "add",
            "--detach",
            "--quiet",
            wt,
            ORIGIN_BASE,
        ])
    );
    if (opts.bootstrap !== false) {
        const boot = spawnSync("bun", ["run", "worktree:init"], {
            cwd: wt,
            encoding: "utf8",
            timeout: 600_000,
        });
        if (boot.status !== 0) {
            removeWorkspace(primary, wt);
            throw new Error(
                `worktree:init failed in ${wt}: ${(boot.stderr ?? "").trim().split("\n").at(-1) ?? ""}`
            );
        }
    }
    return wt;
}

/** Remove the workspace; a failure here is logged by the caller, never fatal. */
export function removeWorkspace(primary: string, wt: string): boolean {
    const r = gitIn(primary, ["worktree", "remove", "--force", "--force", wt]);
    gitIn(primary, ["worktree", "prune"]);
    rmSync(wt, { recursive: true, force: true });
    return r.ok;
}

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

/** One run at a time on this machine; a lock whose pid is dead is taken
 *  over. Across machines the job's concurrency group serialises, and the
 *  state write's lease catches what slips through. */
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
    const legacyStatePath = join(dir, "state.json");
    const logPath = join(dir, "housekeeping.log");
    const say = (line: string): void => {
        const stamped = `${new Date().toISOString()} housekeeping: ${line}`;
        console.log(stamped);
        appendFileSync(logPath, `${stamped}\n`);
    };

    const lockPath = join(dir, "housekeeping.lock");
    if (!dryRun && !takeLock(lockPath)) {
        say("another run holds the lock on this machine — nothing to do");
        return;
    }
    let workspace: string | null = null;
    const exit = (code: number): never => {
        if (workspace !== null && !removeWorkspace(primary, workspace))
            say(`could not remove the workspace ${workspace}`);
        if (!dryRun) rmSync(lockPath, { force: true });
        process.exit(code);
    };
    /** A red that ran nothing: say it, tell the owner (once per distinct
     *  reason on this machine — no shared state to remember it in), exit 1. */
    const noticeMarker = join(dir, "notice.json");
    const bail = (reason: string): never => {
        say(reason);
        if (!dryRun) {
            const message = redSummary({ retry: [], dropped: [], reason })!;
            // The reason minus what changes every run (a pid, a path).
            const key = message.replace(
                /-housekeeping-\d+/g,
                "-housekeeping-N"
            );
            if (notifyOnce(noticeMarker, key, message, "Tolaria housekeeping"))
                say(`notifying the owner: ${message}`);
        }
        return exit(1);
    };

    // The shared state first: nothing runs on a watermark this run cannot
    // write back.
    let shared: { sha: string | null; raw: string | null };
    try {
        shared = readSharedState(primary, STATE_KEY);
    } catch (err) {
        return bail(
            `could not read the shared state (${(err as Error).message.split("\n")[0]}) — nothing processed`
        );
    }
    let raw = shared.raw;
    if (raw === null && existsSync(legacyStatePath)) {
        raw = readFileSync(legacyStatePath, "utf8");
        say(
            `no shared state yet — starting from this machine's ${legacyStatePath}`
        );
    }
    let state = parseState(raw, Date.now());
    const previousNotice = state.lastNotice;
    if (sinceArg !== null)
        state = { ...state, since: new Date(sinceArg).toISOString() };
    /** null = written; else why not (said, and part of the notice). */
    const writeState = (next: HousekeepingState): string | null => {
        if (dryRun) return null;
        try {
            writeSharedState(
                primary,
                STATE_KEY,
                JSON.stringify(next, null, 2),
                shared.sha
            );
            return null;
        } catch (err) {
            const why =
                err instanceof SharedStateConflict
                    ? "another run moved the shared state meanwhile — this run's watermark is dropped; the next run re-reads (every step is idempotent)"
                    : `could not write the shared state: ${(err as Error).message.split("\n")[0]}`;
            say(why);
            return why;
        }
    };

    // Step 0: not tied to any merged PR, so it runs before the early returns.
    if (dryRun) {
        say(`would run: ${CLOSED_CLAIMS_STEP.argv.join(" ")}`);
    } else {
        appendFileSync(logPath, `── ${CLOSED_CLAIMS_STEP.label}\n`);
        const swept = spawnSync(
            CLOSED_CLAIMS_STEP.argv[0]!,
            CLOSED_CLAIMS_STEP.argv.slice(1),
            {
                cwd: primary,
                env: netEnv(process.env),
                encoding: "utf8",
                // A hung `gh` must not hold the lock past this run.
                timeout: 300_000,
            }
        );
        appendFileSync(logPath, `${swept.stdout ?? ""}${swept.stderr ?? ""}`);
        if (swept.status !== 0)
            say(
                `${CLOSED_CLAIMS_STEP.label} failed (exit ${swept.status ?? swept.signal ?? "?"}) — the next run retries it`
            );
    }

    let merged: MergedPr[];
    try {
        merged = listMergedSince(state.since);
    } catch (err) {
        return bail(
            `could not list merged PRs (${(err as Error).message.split("\n")[0]}) — retry next run`
        );
    }

    const pending = pendingPrs(merged, state);
    if (pending.length === 0) {
        say(`nothing merged since ${state.since}`);
        // Nothing changed: no write — except the first shared state (a
        // migration or a first run) and an explicit `--since`.
        if (shared.raw === null || sinceArg !== null) {
            const why = writeState(state);
            if (why !== null)
                return bail(
                    `${why} — nothing to do, but the first shared state is not written`
                );
        }
        forgetNotice(noticeMarker);
        return exit(0);
    }
    say(
        `${pending.length} PR(s) since ${state.since}: ${pending.map((p) => `#${p.number}`).join(" ")}`
    );

    if (dryRun) {
        say(
            `would create the workspace ${workspacePath(primary, process.pid)} at ${ORIGIN_BASE}`
        );
        for (const step of [
            GAPS_SYNC_STEP,
            ...pending.flatMap((pr) => prSteps(pr)),
            SWEEP_STEP,
        ])
            say(`would run: ${step.argv.join(" ")}`);
        return exit(0);
    }

    // Step 1: the merged tree, in a worktree of our own (issue #5873).
    try {
        workspace = prepareWorkspace(primary);
        say(`workspace ${workspace} at ${ORIGIN_BASE}`);
    } catch (err) {
        return bail(
            `could not prepare the workspace (${(err as Error).message.split("\n")[0]}) — nothing processed`
        );
    }

    const log = openSync(logPath, "a");
    const env = netEnv(process.env);
    const run = (step: Step): boolean => {
        appendFileSync(logPath, `── ${step.label}\n`);
        const r = spawnSync(step.argv[0]!, step.argv.slice(1), {
            cwd: workspace!,
            env,
            stdio: ["ignore", log, log],
            timeout: step.timeoutMs,
            killSignal: "SIGKILL",
        });
        if (step.holesExit && r.status === HOLES_EXIT) {
            say(
                `${step.label}: residual gaps with NO open issue — file them by hand (/create-ticket); see ${logPath}`
            );
            return true;
        }
        const ok = r.status === 0;
        if (!ok)
            say(
                r.error !== undefined &&
                    (r.error as { code?: string }).code === "ETIMEDOUT"
                    ? `${step.label} killed after ${(step.timeoutMs ?? 0) / 1000}s without finishing`
                    : `${step.label} failed (exit ${r.status ?? r.signal ?? "?"})`
            );
        return ok;
    };

    // Step 2: one sync for the batch. A failure does not hold back the claim
    // releases and detaches below, but every PR is retried for it.
    const synced = run(GAPS_SYNC_STEP);

    // Step 3: per PR.
    const failed = new Set<number>();
    for (const pr of pending) {
        let own = true;
        for (const step of prSteps(pr)) own = run(step) && own;
        const retry = prRetried(synced, own);
        if (retry) failed.add(pr.number);
        say(
            `PR #${pr.number} (${pr.headRefName}): ${retry ? "retry" : "done"}`
        );
    }

    // Step 4: the sweep; it always exits 0 on a readable outcome.
    run(SWEEP_STEP);
    closeSync(log);

    const next = nextState(state, pending, failed);
    for (const d of next.dropped)
        say(
            `GIVING UP on PR #${d.number} after ${d.attempts} attempts — run its steps by hand (see ${logPath})`
        );
    const summary = redSummary({
        retry: next.state.retry,
        dropped: next.dropped,
    });
    const writeFailed = writeState(withNotice(next.state, summary));
    // A failed write is part of the red — and leaves nothing to dedupe by,
    // so that notice is remembered in this machine's marker instead.
    const full =
        writeFailed === null
            ? summary
            : redSummary({
                  retry: next.state.retry,
                  dropped: next.dropped,
                  writeFailed: writeFailed.split(" — ")[0]!,
              });
    if (writeFailed !== null) {
        if (notifyOnce(noticeMarker, full!, full!, "Tolaria housekeeping"))
            say(`notifying the owner: ${full}`);
    } else if (noticeDue(summary, previousNotice)) {
        say(`notifying the owner: ${summary}`);
        notifyOwner(summary!, "Tolaria housekeeping");
        forgetNotice(noticeMarker);
    } else if (summary === null) forgetNotice(noticeMarker);
    return exit(writeFailed === null && failed.size === 0 ? 0 : 1);
}

if (import.meta.main) main();
