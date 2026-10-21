#!/usr/bin/env bun
/**
 * `bun scripts/pr-gate.ts` — the I/O of `.github/workflows/pr-gate.yml`
 * (issue #5637, ADR 0156 §3): posts `trusted-author` and `base-health` on a
 * PR's head sha. The decisions are `lib/pr-gate.ts`; this file reads GitHub
 * and writes the two commit statuses, nothing else. It runs the BASE's code
 * and never fetches the PR's tree: the PR is data (author, body, file list).
 *
 * Which PRs:
 *  - `pull_request_target` — the event's PR (`GITHUB_EVENT_PATH`);
 *  - any other event (`status` of a `health` / `health-fix` write,
 *    the scheduled sweep, `workflow_dispatch`) — every open PR labelled `ready-to-land`, so a new
 *    RED holds the queue and a GREEN reopens it;
 *  - `--pr <N>` — that PR, whatever the event (a hand-run re-gate).
 *
 * Env: `GITHUB_REPOSITORY` (else the origin remote), `TRUSTED_AUTHORS` (the
 * repository variable), `GH_TOKEN` (statuses: write), and the run's
 * `GITHUB_SERVER_URL` / `GITHUB_RUN_ID` for each status's link.
 * `--dry-run` prints the statuses and posts nothing. Each status is decided
 * and posted on its own: one that cannot be read or written is reported and
 * skipped, and the run exits 1. A PR whose `base-health` turns green after
 * being held gets `@mergifyio requeue` (issue #6110), its red advisory lane
 * re-run first. An unreadable verdict store posts
 * `base-health` `pending` and exits 1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HELD_LABEL } from "./lib/land-labels";
import { pivotRepairIssues } from "./lib/health-pivot";
import {
    githubVerdictStore,
    lineageBlocks,
    originRepo,
    readVerdictLineage,
    realGh,
    type GhRunner,
} from "./lib/health-verdict-store";
import {
    BASE_HEALTH_CONTEXT,
    baseHealthStatus,
    gatePrOf,
    laneJobToRerun,
    needsRequeue,
    REQUEUE_COMMENT,
    parseTrustedAuthors,
    PR_FILES_JQ,
    prFilesApiPath,
    queuedPrs,
    TRUSTED_AUTHOR_CONTEXT,
    trustedAuthorStatus,
    type GateState,
    type GateStatus,
    type RestPr,
} from "./lib/pr-gate";
import type { CheckRunView } from "./lib/merge-manual";

const ROOT = join(import.meta.dir, "..");

function gh(run: GhRunner, args: string[]): string {
    const r = run(args);
    if (r.status !== 0)
        throw new Error(
            `gh ${args.slice(0, 3).join(" ")} failed (exit ${r.status}): ${r.stderr.trim()}`
        );
    return r.stdout;
}

/** NDJSON from a paginated `gh api … --jq '.[] | …'`. */
function ghLines<T>(run: GhRunner, path: string, jq: string): T[] {
    return gh(run, ["api", "--paginate", path, "--jq", jq])
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as T);
}

/** Every path the PR touches; a rename contributes its old name too. */
function prFiles(run: GhRunner, repo: string, pr: number): string[] {
    return ghLines<string>(run, prFilesApiPath(repo, pr), PR_FILES_JQ);
}

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function prsToGate(run: GhRunner, repo: string): RestPr[] {
    const one = argValue("--pr");
    if (one !== undefined) {
        if (!/^\d+$/.test(one)) throw new Error(`--pr wants a number: ${one}`);
        return [JSON.parse(gh(run, ["api", `repos/${repo}/pulls/${one}`]))];
    }
    if (process.env.GITHUB_EVENT_NAME === "pull_request_target") {
        const path = process.env.GITHUB_EVENT_PATH;
        if (!path) throw new Error("GITHUB_EVENT_PATH is unset");
        return [JSON.parse(readFileSync(path, "utf8")).pull_request];
    }
    return queuedPrs(
        ghLines<RestPr>(
            run,
            `repos/${repo}/pulls?state=open&per_page=100`,
            ".[] | tojson"
        )
    );
}

function post(
    run: GhRunner,
    repo: string,
    sha: string,
    s: GateStatus,
    targetUrl: string | null
): void {
    const args = [
        "api",
        "-X",
        "POST",
        `repos/${repo}/statuses/${sha}`,
        "-f",
        `state=${s.state}`,
        "-f",
        `context=${s.context}`,
        "-f",
        `description=${s.description}`,
    ];
    if (targetUrl) args.push("-f", `target_url=${targetUrl}`);
    gh(run, args);
}

/** The state of the PR head's newest `base-health` status, if any. */
function priorBaseHealth(
    run: GhRunner,
    repo: string,
    sha: string
): GateState | undefined {
    const [state] = ghLines<GateState>(
        run,
        `repos/${repo}/commits/${sha}/statuses?per_page=100`,
        `.[] | select(.context == "${BASE_HEALTH_CONTEXT}") | .state | tojson`
    );
    return state;
}

function main(): number {
    const run = realGh;
    const dryRun = process.argv.includes("--dry-run");
    const repo = process.env.GITHUB_REPOSITORY || originRepo(ROOT);
    const trusted = parseTrustedAuthors(process.env.TRUSTED_AUTHORS);
    const { GITHUB_SERVER_URL: server, GITHUB_RUN_ID: runId } = process.env;
    const targetUrl =
        server && runId ? `${server}/${repo}/actions/runs/${runId}` : null;

    const prs = prsToGate(run, repo);
    if (prs.length === 0) {
        console.log("pr-gate: no PR to gate");
        return 0;
    }
    // One health reading for every PR of the run: they share the base.
    const lineage = readVerdictLineage(() => githubVerdictStore({ repo, run }));
    if (lineage.error)
        console.log(`pr-gate: verdict store unreadable (${lineage.error})`);
    const repairIssues = lineageBlocks(lineage.kind)
        ? pivotRepairIssues(ROOT, { run })
        : [];
    console.log(
        `pr-gate: health lineage ${lineage.kind}${lineage.verdict ? ` @ ${lineage.verdict.sha.slice(0, 8)}` : ""}; ${trusted.length} trusted author(s); ${prs.length} PR(s)`
    );

    // A store that cannot be read posts `pending` and reds the run, so the
    // outage shows on the Actions tab; the scheduled sweep decides again.
    let failed = lineage.error ? 1 : 0;
    const show = (pr: number, sha: string, s: GateStatus) =>
        console.log(
            `PR #${pr} @ ${sha.slice(0, 8)}: ${s.context} ${s.state} — ${s.description}`
        );
    for (const raw of prs) {
        // Each status on its own: `base-health` needs no file list, and a
        // failed read of one must never leave the other's old green standing.
        const decide: Array<() => GateStatus> = [
            () =>
                baseHealthStatus({
                    lineage,
                    pr: gatePrOf(raw, []),
                    repairIssues,
                }),
            () =>
                trustedAuthorStatus(
                    gatePrOf(raw, prFiles(run, repo, raw.number)),
                    trusted
                ),
        ];
        const posted = new Map<string, GateState>();
        let prior: GateState | undefined;
        for (const status of decide) {
            try {
                const s = status();
                show(raw.number, raw.head.sha, s);
                if (s.context === BASE_HEALTH_CONTEXT)
                    prior = priorBaseHealth(run, repo, raw.head.sha);
                if (!dryRun) post(run, repo, raw.head.sha, s, targetUrl);
                posted.set(s.context, s.state);
            } catch (e) {
                failed++;
                console.error(`PR #${raw.number}: ${(e as Error).message}`);
            }
        }
        // The GREEN that releases a held PR requeues it: Mergify does not.
        const next = posted.get(BASE_HEALTH_CONTEXT);
        const trustedState = posted.get(TRUSTED_AUTHOR_CONTEXT);
        if (
            next &&
            trustedState &&
            needsRequeue({
                labels: (raw.labels ?? []).map((l) => l.name),
                prior,
                next,
                trustedAuthor: trustedState,
            })
        ) {
            console.log(`PR #${raw.number}: ${REQUEUE_COMMENT}`);
            if (!dryRun)
                try {
                    // The lane the RED redded runs again first (issue #6256):
                    // a re-run is pending, never a failure, so the PR enters.
                    const job = laneJobToRerun(
                        ghLines<CheckRunView>(
                            run,
                            `repos/${repo}/commits/${raw.head.sha}/check-runs?per_page=100`,
                            ".check_runs[] | {id, name, headSha: .head_sha, status, conclusion} | tojson"
                        ),
                        raw.head.sha
                    );
                    if (job !== null) {
                        console.log(
                            `PR #${raw.number}: re-running lane job ${job}`
                        );
                        gh(run, [
                            "api",
                            "-X",
                            "POST",
                            `repos/${repo}/actions/jobs/${job}/rerun`,
                        ]);
                    }
                    gh(run, [
                        "pr",
                        "edit",
                        String(raw.number),
                        "--repo",
                        repo,
                        "--remove-label",
                        HELD_LABEL,
                    ]);
                    gh(run, [
                        "pr",
                        "comment",
                        String(raw.number),
                        "--repo",
                        repo,
                        "--body",
                        REQUEUE_COMMENT,
                    ]);
                } catch (e) {
                    failed++;
                    console.error(`PR #${raw.number}: ${(e as Error).message}`);
                }
        }
    }
    return failed === 0 ? 0 : 1;
}

process.exit(main());
