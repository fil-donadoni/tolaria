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
 * skipped, and the run exits 1. Off RED, a PR labelled `queue:held` gets
 * `@mergifyio requeue` once per hold, and loses the label once it is
 * `queued` again or the requeue did not take within its grace
 * (`heldPrAction`, issues #6110, #6957); an unlabelled PR whose `base-health` turns green after being held
 * gets the requeue alone. An unreadable verdict store posts
 * `base-health` `pending` and exits 1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HELD_LABEL } from "./lib/land-labels";
import { lastRequeueSince, type PrComment } from "./lib/land-requeue";
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
    heldPrAction,
    MERGIFY_QUEUED_LABEL,
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
        // Keyed on the `queue:held` label (issue #6957), the base-health
        // transition only for a PR the RED held without labelling it.
        const next = posted.get(BASE_HEALTH_CONTEXT);
        const trustedState = posted.get(TRUSTED_AUTHOR_CONTEXT);
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
