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
 * skipped, and the run exits 1. Off RED, or under RED for a declared
 * repair (issue #7140), a PR labelled `queue:held` gets
 * `@mergifyio requeue` once per hold, and loses the label once it is
 * `queued` again or the requeue did not take within its grace
 * (`heldPrAction`, issues #6110, #6957); an unlabelled PR whose `base-health` turns green after being held
 * gets the requeue alone. A queue PR about to get `base-health` `failure`
 * is labelled `queue:held` first (`holdsBeforeRed`, issue #6986), so a RED
 * that clears before Mergify judges the dequeue is still a hold. An unreadable verdict store posts
 * `base-health` `pending` and exits 1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evidenceFiles, failingFiles } from "./lib/health-evidence";
import { FAILED_LABEL, HELD_LABEL, READY_LABEL } from "./lib/land-labels";
import { lastRequeueSince, type PrComment } from "./lib/land-requeue";
import { pivotRepairIssues } from "./lib/health-pivot";
import {
    githubEvidenceStore,
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
    heldPrAction,
    holdsBeforeRed,
    LANE_CHECK_NAME,
    stripLogTimestamps,
    MERGIFY_QUEUED_LABEL,
    needsRequeue,
    ownRedAction,
    redOwnership,
    REQUEUE_COMMENT,
    parseTrustedAuthors,
    PR_FILES_JQ,
    prFilesApiPath,
    queuedPrs,
    TRUSTED_AUTHOR_CONTEXT,
    trustedAuthorStatus,
    type GateState,
    type GateStatus,
    type HeldAction,
    type RestPr,
} from "./lib/pr-gate";

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

/** The PR's conversation comments, in `PrComment`'s shape. */
function prComments(run: GhRunner, repo: string, pr: number): PrComment[] {
    return ghLines<PrComment>(
        run,
        `repos/${repo}/issues/${pr}/comments?per_page=100`,
        ".[] | {author: {login: .user.login}, body, createdAt: .created_at} | tojson"
    );
}

/** When the PR was last labelled `queue:held`, or null. */
function heldSince(run: GhRunner, repo: string, pr: number): string | null {
    const stamps = ghLines<string>(
        run,
        `repos/${repo}/issues/${pr}/events?per_page=100`,
        `.[] | select(.event == "labeled" and .label.name == "${HELD_LABEL}") | .created_at | tojson`
    );
    return stamps.sort().at(-1) ?? null;
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

/** The standing RED's failing test files, from the health EVIDENCE (the
 *  commit comment): the verdict's own `tests` rides a 140-character status
 *  description and may be cut. No evidence → none (ownership `unknown`). */
const redFilesCache = new Map<string, string[]>();
function redFailingFiles(
    run: GhRunner,
    repo: string,
    sha: string | undefined
): string[] {
    if (!sha) return [];
    let files = redFilesCache.get(sha);
    if (!files) {
        const body = githubEvidenceStore({ repo, run }).read(sha);
        files = body === null ? [] : evidenceFiles(body);
        redFilesCache.set(sha, files);
    }
    return files;
}

/** The PR head's advisory lane: whether it failed and, if so, the test files
 *  its log names. An unreadable log is a failed lane with no files (the
 *  ownership then reads `unknown` and the hold stays). */
function laneReading(
    run: GhRunner,
    repo: string,
    sha: string
): { failed: boolean; files: string[] } {
    const [id] = ghLines<number>(
        run,
        `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
        `.check_runs[] | select(.name == "${LANE_CHECK_NAME}" and .conclusion == "failure") | .id | tojson`
    );
    if (id === undefined) return { failed: false, files: [] };
    try {
        return {
            failed: true,
            files: failingFiles(
                stripLogTimestamps(
                    gh(run, ["api", `repos/${repo}/actions/jobs/${id}/logs`])
                )
            ),
        };
    } catch {
        return { failed: true, files: [] };
    }
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
        // `trusted-author` first: `holdsBeforeRed` reads it.
        const decide: Array<() => GateStatus> = [
            () =>
                trustedAuthorStatus(
                    gatePrOf(raw, prFiles(run, repo, raw.number)),
                    trusted
                ),
            () =>
                baseHealthStatus({
                    lineage,
                    pr: gatePrOf(raw, []),
                    repairIssues,
                }),
        ];
        const labels = (raw.labels ?? []).map((l) => l.name);
        const edit = (args: string[]): void => {
            if (dryRun) return;
            try {
                gh(run, args);
            } catch (e) {
                failed++;
                console.error(`PR #${raw.number}: ${(e as Error).message}`);
            }
        };
        const posted = new Map<string, GateState>();
        let prior: GateState | undefined;
        for (const status of decide) {
            try {
                const s = status();
                show(raw.number, raw.head.sha, s);
                if (s.context === BASE_HEALTH_CONTEXT)
                    prior = priorBaseHealth(run, repo, raw.head.sha);
                // The hold is labelled before the failure that dequeues the
                // PR (issue #6986): a label that failed still lets the
                // failure post, since holding the queue comes first.
                if (
                    s.context === BASE_HEALTH_CONTEXT &&
                    holdsBeforeRed({
                        labels,
                        baseHealth: s.state,
                        trustedAuthor: posted.get(TRUSTED_AUTHOR_CONTEXT),
                    })
                ) {
                    console.log(
                        `PR #${raw.number}: base-health failure — labelling ${HELD_LABEL} first`
                    );
                    edit([
                        "pr",
                        "edit",
                        String(raw.number),
                        "--repo",
                        repo,
                        "--add-label",
                        HELD_LABEL,
                    ]);
                }
                if (!dryRun) post(run, repo, raw.head.sha, s, targetUrl);
                posted.set(s.context, s.state);
            } catch (e) {
                failed++;
                console.error(`PR #${raw.number}: ${(e as Error).message}`);
            }
        }
        // A RED hides a PR's own red (issue #6652): `.mergify.yml` holds the
        // PR instead of labelling it, so the label comes from here when the
        // lane's failing files are disjoint from the RED's. The reads are
        // lazy (a PR off the queue pays nothing) and a failed read is a
        // failed PR, never a dead run.
        if (lineageBlocks(lineage.kind)) {
            try {
                let lane: { failed: boolean; files: string[] } | undefined;
                const ownRed = ownRedAction({
                    labels,
                    baseHealth: posted.get(BASE_HEALTH_CONTEXT),
                    laneFailed: () =>
                        (lane ??= laneReading(run, repo, raw.head.sha)).failed,
                    ownership: () =>
                        redOwnership(
                            lane?.files ?? [],
                            redFailingFiles(run, repo, lineage.verdict?.sha)
                        ),
                });
                if (ownRed) {
                    console.log(
                        `PR #${raw.number}: own lane red, disjoint from the RED — labelling ${FAILED_LABEL}`
                    );
                    const before = failed;
                    edit([
                        "pr",
                        "edit",
                        String(raw.number),
                        "--repo",
                        repo,
                        "--add-label",
                        FAILED_LABEL,
                        "--remove-label",
                        `${READY_LABEL},${HELD_LABEL}`,
                    ]);
                    // Only after the label took: a failed edit retried by the
                    // next sweep must not repeat the comment.
                    if (failed === before)
                        edit([
                            "pr",
                            "comment",
                            String(raw.number),
                            "--repo",
                            repo,
                            "--body",
                            `**pr-gate: the base is RED, and this PR's own lane is red on files the RED does not fail** (${(lane?.files ?? []).map((f) => `\`${f}\``).join(", ")}) — labelled \`${FAILED_LABEL}\`; a repair may start now. Fix the PR, then \`bun run land:ready <PR#>\`.`,
                        ]);
                    continue;
                }
            } catch (e) {
                failed++;
                console.error(`PR #${raw.number}: ${(e as Error).message}`);
            }
        }
        // The GREEN that releases a held PR requeues it: Mergify does not.
        // Keyed on the `queue:held` label (issue #6957), the base-health
        // transition only for a PR the RED held without labelling it.
        const next = posted.get(BASE_HEALTH_CONTEXT);
        const trustedState = posted.get(TRUSTED_AUTHOR_CONTEXT);
        const requeue = () =>
            edit([
                "pr",
                "comment",
                String(raw.number),
                "--repo",
                repo,
                "--body",
                REQUEUE_COMMENT,
            ]);
        let action: HeldAction;
        try {
            action = heldPrAction({
                labels,
                lineage,
                baseHealth: next,
                trustedAuthor: trustedState,
                lastRequeueAt: () =>
                    lastRequeueSince(
                        prComments(run, repo, raw.number),
                        heldSince(run, repo, raw.number)
                    ),
                now: Date.now(),
            });
        } catch (e) {
            failed++;
            console.error(`PR #${raw.number}: ${(e as Error).message}`);
            continue;
        }
        if (action === "requeue") {
            console.log(
                `PR #${raw.number}: ${REQUEUE_COMMENT} (${HELD_LABEL} kept until it is ${MERGIFY_QUEUED_LABEL})`
            );
            requeue();
        } else if (action === "release") {
            console.log(
                `PR #${raw.number}: hold over — removing ${HELD_LABEL}`
            );
            edit([
                "pr",
                "edit",
                String(raw.number),
                "--repo",
                repo,
                "--remove-label",
                HELD_LABEL,
            ]);
        } else if (
            next &&
            trustedState &&
            !labels.includes(HELD_LABEL) &&
            needsRequeue({
                labels,
                prior,
                next,
                trustedAuthor: trustedState,
            })
        ) {
            console.log(`PR #${raw.number}: ${REQUEUE_COMMENT}`);
            requeue();
        }
    }
    return failed === 0 ? 0 : 1;
}

process.exit(main());
