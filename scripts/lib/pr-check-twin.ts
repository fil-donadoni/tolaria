/**
 * A `cancelled` twin of a `pr-check` job (issue #8291). Two `pull_request`
 * events a moment apart (a push and a body edit) make two runs on ONE head, and
 * the workflow's concurrency group cancels whichever joined it first. GitHub
 * does not always start them in the order it created them, so the run in the
 * HIGHER check suite can be the cancelled one.
 *
 * Mergify judges a check name by its twin in the highest check suite and reads
 * `cancelled` as `check-failure`. Observed, over the 80 newest merged PRs: 22
 * carried a cancelled lane twin in the LOWER suite and all 22 landed; the one
 * in the HIGHER suite (PR #8266) was refused, though its older-id green had
 * finished, and entered the queue 47 s after that cancelled run was re-run,
 * with the lane still in progress. Neither `started_at` nor the check-run id
 * tells the two apart: the suite does.
 *
 * The cure is the re-run: it goes back into the same suite, so that suite's
 * newest check stops being `cancelled`. It cancels a twin still in progress
 * through the same concurrency group, and that twin is now the lower suite's:
 * harmless, and the shape cannot loop. A `GITHUB_TOKEN` of `pr-gate` cannot do
 * it (`actions: read`), so the owner's credentials do: `land:ready` before it
 * labels, `housekeeping` on every base push and hourly. Pure, but for the
 * injected reads and writes.
 */
import { FAILED_LABEL, READY_LABEL } from "./land-labels";
import {
    checkRunsApiPath,
    LANE_CHECK_NAME,
    MERGIFY_QUEUED_LABEL,
} from "./pr-gate";

/** Every job `pr-check.yml` posts, the names `.mergify.yml` reads. */
export const PR_CHECK_JOB_NAMES: readonly string[] = [
    LANE_CHECK_NAME,
    "ui-receipt",
    "scenario",
    "retired-rows",
    "robustness-baseline",
    "repair-proof",
    "draft-audit",
];

/** One check run of a head, as `twinChecksArgs` reads it. */
export interface TwinCheckRun {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    suiteId: number;
    detailsUrl: string | null;
}

/** `gh` arguments for the head's check runs. The API's default `latest` filter
 *  keeps the newest run per suite, so a re-run hides what it replaced. */
export function twinChecksArgs(repo: string, sha: string): string[] {
    return [
        "api",
        "--paginate",
        checkRunsApiPath(repo, sha),
        "--jq",
        ".check_runs[] | {id, name, status, conclusion, suiteId: .check_suite.id, detailsUrl: .details_url} | tojson",
    ];
}

export function parseTwinCheckRuns(stdout: string): TwinCheckRun[] {
    return stdout
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as TwinCheckRun);
}

/** `gh` arguments re-running one workflow run. */
export function rerunArgs(repo: string, runId: number): string[] {
    return ["api", "-X", "POST", `repos/${repo}/actions/runs/${runId}/rerun`];
}

/** The workflow run a job's check run belongs to, or null off Actions. */
function workflowRunId(detailsUrl: string | null): number | null {
    const m = /\/actions\/runs\/(\d+)\//.exec(detailsUrl ?? "");
    return m ? Number(m[1]) : null;
}

/** A job's runs, the one Mergify judges (highest suite, newest) first. */
function byJudged(runs: readonly TwinCheckRun[], name: string): TwinCheckRun[] {
    return runs
        .filter((r) => r.name === name)
        .sort((a, b) => b.suiteId - a.suiteId || b.id - a.id);
}

/**
 * The workflow runs to re-run on one head: for a `pr-check` job, the run in
 * the highest suite is `cancelled` and a lower suite's twin is green or still
 * going. Nothing for a cancelled twin in a LOWER suite (the ordinary shape,
 * which the queue ignores) and nothing for a lower twin that FAILED: that red
 * is real, and a repair pick.
 */
export function cancelledTwinRuns(runs: readonly TwinCheckRun[]): number[] {
    const out = new Set<number>();
    for (const name of PR_CHECK_JOB_NAMES) {
        const [judged, ...rest] = byJudged(runs, name);
        if (judged?.conclusion !== "cancelled") continue;
        const superseded = rest.some(
            (r) =>
                r.suiteId < judged.suiteId &&
                (r.status !== "completed" || r.conclusion === "success")
        );
        const runId = workflowRunId(judged.detailsUrl);
        if (superseded && runId !== null) out.add(runId);
    }
    return [...out].sort((a, b) => a - b);
}

/** The `pr-check` jobs not green on a head, as Mergify judges them: what a PR
 *  the queue still refuses is told. A `skipped` job blocks nothing. */
export function nonGreenPrCheckJobs(runs: readonly TwinCheckRun[]): string[] {
    return PR_CHECK_JOB_NAMES.flatMap((name) => {
        const judged = byJudged(runs, name)[0];
        if (
            !judged ||
            judged.conclusion === "success" ||
            judged.conclusion === "skipped"
        )
            return [];
        return [`${name} (${judged.conclusion ?? judged.status})`];
    });
}

/** Whether a PR's twin is the sweep's to heal: one the queue is refusing or
 *  about to, never one it holds. */
export function twinHealable(labels: readonly string[]): boolean {
    return (
        labels.includes(READY_LABEL) &&
        !labels.includes(FAILED_LABEL) &&
        !labels.includes(MERGIFY_QUEUED_LABEL)
    );
}

/**
 * Re-run the cancelled twins of every open PR the queue would take. One PR's
 * failed read or re-run is said and passed over: this is a sweep the next base
 * push repeats, and a twin it missed costs a wait, never a red.
 */
export function healQueueTwins(input: {
    prs: readonly {
        number: number;
        headRefOid: string;
        labels: readonly string[];
    }[];
    read: (sha: string) => TwinCheckRun[];
    rerun: (runId: number) => void;
    say: (line: string) => void;
}): number[] {
    const healed: number[] = [];
    for (const pr of input.prs) {
        if (!twinHealable(pr.labels)) continue;
        try {
            const ids = cancelledTwinRuns(input.read(pr.headRefOid));
            for (const id of ids) {
                input.say(`PR #${pr.number}: re-running cancelled twin ${id}`);
                input.rerun(id);
            }
            if (ids.length > 0) healed.push(pr.number);
        } catch (e) {
            input.say(
                `PR #${pr.number}: twin not healed (${(e as Error).message.split("\n")[0]})`
            );
        }
    }
    return healed;
}

/** How long `land:ready` waits for a re-run to replace the cancelled check;
 *  PR #8266's took 4 s. */
export const TWIN_FLIP_TIMEOUT_MS = 60_000;
const TWIN_FLIP_POLL_MS = 3_000;

/**
 * Before a head is labelled `ready-to-land`: re-run its cancelled twins and
 * wait until none reads as cancelled. The wait is what makes the label safe:
 * with the old check still standing, the repair-pick rule would turn the label
 * into `land-failed` at once. `false` = the re-run did not show in time.
 */
export function healTwinBeforeLabel(input: {
    read: () => TwinCheckRun[];
    rerun: (runId: number) => void;
    sleep: (ms: number) => void;
    now: () => number;
    say: (line: string) => void;
}): boolean {
    const ids = cancelledTwinRuns(input.read());
    if (ids.length === 0) return true;
    for (const id of ids) {
        input.say(`re-running cancelled twin ${id} before labelling`);
        input.rerun(id);
    }
    const deadline = input.now() + TWIN_FLIP_TIMEOUT_MS;
    while (input.now() < deadline) {
        input.sleep(TWIN_FLIP_POLL_MS);
        if (cancelledTwinRuns(input.read()).length === 0) return true;
    }
    return false;
}

const twinHoldHeading = (headSha: string): string =>
    `**pr-gate: a cancelled \`pr-check\` twin on head \`${headSha.slice(0, 8)}\` keeps this PR out of the merge queue**`;

/** What a PR held by its twin says, once per head (`twinHoldSaid`). */
export function twinHoldComment(
    headSha: string,
    runIds: readonly number[]
): string {
    return [
        `${twinHoldHeading(headSha)} — \`queue:held\` stays on, so it never becomes \`land-failed\`.`,
        "",
        "Mergify reads the check in the highest suite, and there the run was cancelled by its twin; the green or running twin sits in a lower suite. Nothing is wrong with the PR.",
        "",
        `\`housekeeping\` re-runs it on the next base push or within the hour. Sooner: ${runIds.map((id) => `\`gh run rerun ${id}\``).join(", ")}.`,
    ].join("\n");
}

export function twinHoldSaid(
    comments: readonly { body: string }[],
    headSha: string
): boolean {
    const heading = twinHoldHeading(headSha);
    return comments.some((c) => c.body.startsWith(heading));
}

/** What a PR the queue still refuses after its requeue's grace says. */
export function requeueRefusedComment(input: {
    requeuedAt: string | null;
    graceMinutes: number;
    nonGreen: readonly string[] | null;
}): string {
    const checks =
        input.nonGreen === null
            ? "The head's `pr-check` jobs could not be read."
            : input.nonGreen.length === 0
              ? "Every `pr-check` job on the head is green or still running."
              : `Not green on the head: ${input.nonGreen.map((n) => `\`${n}\``).join(", ")}.`;
    return [
        `**pr-gate: \`@mergifyio requeue\` (${input.requeuedAt ?? "time unknown"}) did not take within ${input.graceMinutes} min** — \`queue:held\` removed; the repair-pick rules judge this PR from here.`,
        "",
        `${checks} Mergify's \`Summary\` check on the head names the unmet condition.`,
    ].join("\n");
}
