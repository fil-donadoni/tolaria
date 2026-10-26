/**
 * The cap on repair rounds (issue #6649). A PR the queue labelled
 * `land-failed` is a repair pick; nothing bounded how often one PR came back.
 * In 2026-10-21 → 10-24, PR #6465 failed 8 times. After `REPAIR_ROUND_CAP`
 * repairs that failed again the PR leaves the loop: `ready-for-human`, no more
 * picks, one comment naming the failure classes seen.
 *
 * The count is the PR's `land-failed` label events (each failure applies the
 * label once): N failures = N − 1 repairs already tried, the Nth failure is
 * the one waiting for a pass. Pure here; `escalateCappedRepairs` is the I/O
 * the AFK dispatcher runs.
 */
import { gh } from "./gh";
import { FAILED_LABEL } from "./land-labels";

/** Repairs of one PR that may fail before a human is called (proposal N = 3). */
export const REPAIR_ROUND_CAP = 3;

/** The label that takes a PR out of the loop. */
export const HUMAN_LABEL = "ready-for-human";

/** Hidden marker: the escalation comment is posted once per PR. */
export const ESCALATION_MARKER = "<!-- repair-cap -->";

/** Repairs already tried, given how many times the PR was labelled failed. */
export function repairsTried(failures: number): number {
    return Math.max(0, failures - 1);
}

/** Whether the PR has used up its repair rounds. */
export function repairCapReached(
    failures: number,
    cap: number = REPAIR_ROUND_CAP
): boolean {
    return repairsTried(failures) >= cap;
}

/**
 * The failure classes the PR's comments name: Mergify's
 * "dequeued (`reason`)" and the land-runner's "Class: `x`". A failure naming
 * neither counts as `unclassified`.
 */
export function failureClasses(bodies: readonly string[]): string[] {
    const seen = new Set<string>();
    for (const body of bodies) {
        if (!body.includes(`\`${FAILED_LABEL}\``)) continue;
        const reason =
            /dequeued \(`([^`]+)`\)/.exec(body)?.[1] ??
            /Class: `([^`]+)`/.exec(body)?.[1] ??
            "unclassified";
        seen.add(reason);
    }
    return [...seen].sort();
}

/** The single comment that hands the PR to its human. */
export function escalationComment(input: {
    failures: number;
    classes: readonly string[];
}): string {
    const tried = repairsTried(input.failures);
    return [
        ESCALATION_MARKER,
        `**repair cap reached** — ${tried} repair round(s) failed again (${input.failures} \`${FAILED_LABEL}\` failures).`,
        "",
        `Failure classes seen: ${input.classes.length ? input.classes.map((c) => `\`${c}\``).join(", ") : "none readable"}.`,
        "",
        `Labelled \`${HUMAN_LABEL}\`: the dispatcher no longer picks this PR.`,
    ].join("\n");
}

/** `land-failed` label events of one PR; null when unreadable. */
export function failureCount(slug: string, pr: number): number | null {
    try {
        const lines = gh([
            "api",
            "--paginate",
            `repos/${slug}/issues/${pr}/events`,
            "--jq",
            `.[] | select(.event == "labeled" and .label.name == "${FAILED_LABEL}") | .created_at`,
        ])
            .split("\n")
            .filter((l) => l.trim() !== "");
        return lines.length;
    } catch {
        return null;
    }
}

/**
 * The PRs (by number) past the cap. An unreadable count caps nothing: a
 * missed cap is caught next run, a wrongly capped PR is lost work.
 */
export function cappedRepairPrs(
    slug: string,
    prs: readonly { number: number }[],
    countOf: (slug: string, pr: number) => number | null = failureCount
): Set<number> {
    const capped = new Set<number>();
    for (const pr of prs) {
        const n = countOf(slug, pr.number);
        if (n !== null && repairCapReached(n)) capped.add(pr.number);
    }
    return capped;
}

/**
 * Hand each capped PR to its human, once: label + one comment. Idempotent —
 * a PR already carrying the label is skipped. Returns the PRs escalated now.
 */
export function escalateCappedRepairs(
    slug: string,
    capped: ReadonlySet<number>
): number[] {
    const done: number[] = [];
    for (const pr of capped) {
        try {
            const view = JSON.parse(
                gh(["pr", "view", String(pr), "--json", "labels,comments"])
            ) as {
                labels: { name: string }[];
                comments: { body: string }[];
            };
            if (view.labels.some((l) => l.name === HUMAN_LABEL)) continue;
            const bodies = view.comments.map((c) => c.body);
            const comment = escalationComment({
                failures: failureCount(slug, pr) ?? 0,
                classes: failureClasses(bodies),
            });
            gh(["pr", "edit", String(pr), "--add-label", HUMAN_LABEL]);
            gh(["pr", "comment", String(pr), "--body", comment]);
            done.push(pr);
        } catch (err) {
            console.error(
                `repair-cap: could not escalate PR #${pr} (${(err as Error).message.split("\n")[0]})`
            );
        }
    }
    return done;
}
