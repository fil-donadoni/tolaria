// Merge-queue churn (issue #6171): how many restarts a merged PR costs.
// Pure: raw runs + comments in, metrics out. `scripts/queue-churn.ts` is the
// GitHub I/O. Every slice of issue #6164 reports before/after against it.

export interface ChurnWindow {
    /** ISO instant, inclusive. */
    from: string;
    /** ISO instant, exclusive. */
    to: string;
}

export interface WorkflowRun {
    /** `queue-lane`'s title reads `Merge of #<PR>`. */
    displayTitle: string;
    /** `""` while the run is still going. */
    conclusion: string;
    createdAt: string;
}

export interface QueueComment {
    createdAt: string;
    body: string;
}

export interface ChurnFacts {
    window: ChurnWindow;
    /** PRs merged into the base inside the window. */
    mergedPrs: readonly number[];
    queueLaneRuns: readonly WorkflowRun[];
    prRefreshRuns: readonly WorkflowRun[];
    /** Every PR comment posted inside the window; Mergify's are picked here. */
    comments: readonly QueueComment[];
}

export type DequeueCause =
    | "checks-failed"
    | "checks-timeout"
    | "conflict"
    | "ready-to-land-gone"
    | "manually-updated"
    | "interrupted"
    | "other";

export const DEQUEUE_CAUSES: readonly DequeueCause[] = [
    "checks-failed",
    "checks-timeout",
    "conflict",
    "ready-to-land-gone",
    "manually-updated",
    "interrupted",
    "other",
];

/** The conclusion shown for a run still going. */
export const RUNNING = "running";

export interface Churn {
    merges: number;
    queueLane: {
        runs: number;
        byConclusion: Record<string, number>;
        perMerge: number | null;
    };
    prRefresh: { runs: number; perMerge: number | null };
    dequeues: {
        total: number;
        byCause: Record<DequeueCause, number>;
        perMerge: number | null;
    };
}

function inWindow(at: string, w: ChurnWindow): boolean {
    const t = Date.parse(at);
    return t >= Date.parse(w.from) && t < Date.parse(w.to);
}

function ratio(n: number, merges: number): number | null {
    return merges === 0 ? null : n / merges;
}

/** Only the `## Reason` section says why; the status header above it names
 *  the state of every dequeue alike. Comments before 2026-10-22 carry no
 *  `dequeue_reason`, and the issue #6164 baseline window reads them. */
function legacyReasonText(body: string): string {
    const at = body.indexOf("## Reason");
    return at === -1 ? "" : body.slice(at);
}

/** `dequeue_reason.code` from the Mergify Payload, when the comment has one. */
function dequeueReasonCode(body: string): string | null {
    const payload =
        /-\*- Mergify Payload -\*-\s*([\s\S]*?)\s*-\*- Mergify Payload End/.exec(
            body
        );
    if (!payload) return null;
    try {
        const parsed = JSON.parse(payload[1]) as {
            dequeue_reason?: { code?: unknown };
        };
        const code = parsed.dequeue_reason?.code;
        return typeof code === "string" ? code : null;
    } catch {
        return null;
    }
}

/** Queue conditions Mergify left unticked: the block-quoted checklist only, as
 *  the plain list further down names unmet MERGE conditions instead. */
function unmetQueueConditions(body: string): Set<string> {
    return new Set(
        [...body.matchAll(/^>\s*- \[ \] `([^`]+)`/gm)].map((m) => m[1])
    );
}

/** `PR_DEQUEUED` says only "Queue conditions are not satisfied". A conflict
 *  outranks the label: a PR can show both, and the conflict is what it must fix. */
function queueConditionsCause(body: string): DequeueCause {
    const unmet = unmetQueueConditions(body);
    if (unmet.has("-conflict")) return "conflict";
    if (unmet.has("label=ready-to-land")) return "ready-to-land-gone";
    return "other";
}

/** Only codes seen on real comments; any other reads `other`, never a guess. */
const CAUSE_BY_CODE: Readonly<Record<string, DequeueCause>> = {
    CHECKS_FAILED: "checks-failed",
    CHECKS_TIMEOUT: "checks-timeout",
    CHECKS_INTERRUPTED: "interrupted",
    CONFLICT_WITH_BASE_BRANCH: "conflict",
    PULL_REQUEST_UPDATED: "manually-updated",
};

export function isDequeueComment(body: string): boolean {
    return (
        body.includes("-*- Mergify Payload -*-") &&
        /"state":\s*"dequeued"/.test(body)
    );
}

/** The cause a Mergify "dequeued" comment gives: its payload's
 *  `dequeue_reason.code`, or the text of a comment that predates the code. */
export function dequeueCause(body: string): DequeueCause {
    const code = dequeueReasonCode(body);
    if (code === "PR_DEQUEUED") return queueConditionsCause(body);
    if (code !== null) return CAUSE_BY_CODE[code] ?? "other";
    const reason = legacyReasonText(body);
    if (/failing checks|checks? (has|have) failed/i.test(reason))
        return "checks-failed";
    if (/conflicts? with the base/i.test(reason)) return "conflict";
    if (/manually updated|manual update/i.test(reason))
        return "manually-updated";
    if (/interrupted/i.test(reason)) return "interrupted";
    return queueConditionsCause(reason);
}

export function queueChurn(f: ChurnFacts): Churn {
    const merges = new Set(f.mergedPrs).size;

    const lane = f.queueLaneRuns.filter((r) => inWindow(r.createdAt, f.window));
    const byConclusion: Record<string, number> = {};
    for (const r of lane) {
        const c = r.conclusion || RUNNING;
        byConclusion[c] = (byConclusion[c] ?? 0) + 1;
    }

    const refresh = f.prRefreshRuns.filter((r) =>
        inWindow(r.createdAt, f.window)
    );

    const byCause = Object.fromEntries(
        DEQUEUE_CAUSES.map((c) => [c, 0])
    ) as Record<DequeueCause, number>;
    let total = 0;
    for (const c of f.comments) {
        if (!inWindow(c.createdAt, f.window) || !isDequeueComment(c.body))
            continue;
        byCause[dequeueCause(c.body)]++;
        total++;
    }

    return {
        merges,
        queueLane: {
            runs: lane.length,
            byConclusion,
            perMerge: ratio(lane.length, merges),
        },
        prRefresh: {
            runs: refresh.length,
            perMerge: ratio(refresh.length, merges),
        },
        dequeues: { total, byCause, perMerge: ratio(total, merges) },
    };
}

function fixed(x: number | null): string {
    return x === null ? "n/a" : x.toFixed(2);
}

export function churnMarkdown(c: Churn, w: ChurnWindow): string {
    const conclusions = Object.entries(c.queueLane.byConclusion)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, n]) => `${n} ${k}`)
        .join(", ");
    const causes = DEQUEUE_CAUSES.map(
        (k) => `${k} ${c.dequeues.byCause[k]}`
    ).join(", ");
    return [
        `queue:churn ${w.from} .. ${w.to}`,
        `merges: ${c.merges}`,
        `queue-lane runs: ${c.queueLane.runs} (${conclusions || "none"}) = ${fixed(c.queueLane.perMerge)} per merge`,
        `pr-refresh runs: ${c.prRefresh.runs} = ${fixed(c.prRefresh.perMerge)} per merge`,
        `dequeues: ${c.dequeues.total} (${causes}) = ${fixed(c.dequeues.perMerge)} per merge`,
    ].join("\n");
}
