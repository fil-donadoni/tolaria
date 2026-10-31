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

/** The failure class of a `pr:checks ui-receipt` / `check:ui` red (issue #7649). */
export const UI_RECEIPT_CLASS = "ui-receipt";

/**
 * The comment `check:ui` posts on a red walk: `### check:ui — N failing
 * cell(s) at <sha>`. It is the only trace a ui-receipt failure leaves — no
 * `land-failed` label event — so PR #7510 ran eight repair passes (2026-10-30)
 * with the label-event count at zero.
 */
const UI_RECEIPT_FAILURE =
    /^### check:ui — \d+ failing cell\(s\) at ([0-9a-f]{7,40})/;

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
 * Failed `ui-receipt` rounds: one per head sha the walk failed at. A re-run
 * of the same head (load, flake) is the same round, a repair pass pushes a new
 * head — PR #7510's 15 failure comments are 8 rounds.
 */
export function uiReceiptRounds(bodies: readonly string[]): number {
    const heads = new Set<string>();
    for (const body of bodies) {
        const sha = UI_RECEIPT_FAILURE.exec(body)?.[1];
        if (sha) heads.add(sha.slice(0, 7));
    }
    return heads.size;
}

/** Whether the `ui-receipt` class has failed its third round (cap = 3 rounds). */
export function uiReceiptCapReached(
    rounds: number,
    cap: number = REPAIR_ROUND_CAP
): boolean {
    return rounds >= cap;
}

/**
 * The failure classes the PR's comments name: Mergify's
 * "dequeued (`reason`)" and the land-runner's "Class: `x`". A failure naming
 * neither counts as `unclassified`.
 */
export function failureClasses(bodies: readonly string[]): string[] {
    const seen = new Set<string>();
    for (const body of bodies) {
        if (UI_RECEIPT_FAILURE.test(body)) seen.add(UI_RECEIPT_CLASS);
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
    /** Failed `ui-receipt` rounds (issue #7649), when that class capped it. */
    uiRounds?: number;
}): string {
    const tried = repairsTried(input.failures);
    const headline = input.uiRounds
        ? `**repair cap reached** — ${input.uiRounds} \`${UI_RECEIPT_CLASS}\` round(s) failed.`
        : `**repair cap reached** — ${tried} repair round(s) failed again (${input.failures} \`${FAILED_LABEL}\` failures).`;
    return [
        ESCALATION_MARKER,
        headline,
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
 * The PRs past the cap, PR number → failure count. An unreadable count caps nothing: a
 * missed cap is caught next run, a wrongly capped PR is lost work.
 */
export function cappedRepairPrs(
    slug: string,
    prs: readonly { number: number }[],
    countOf: (slug: string, pr: number) => number | null = failureCount
): Map<number, number> {
    const capped = new Map<number, number>();
    for (const pr of prs) {
        const n = countOf(slug, pr.number);
        if (n !== null && repairCapReached(n)) capped.set(pr.number, n);
    }
    return capped;
}

/**
 * The open PRs whose `ui-receipt` class hit its cap, PR number → failed
 * rounds (issue #7649). Counts `check:ui` failure comments, so it sees a PR
 * the queue never labelled `land-failed`. Unreadable → none capped.
 */
export function cappedUiReceiptPrs(
    slug: string,
    list: () => readonly {
        number: number;
        labels: readonly { name: string }[];
        comments: readonly { body: string }[];
    }[] = openPrComments
): Map<number, number> {
    const capped = new Map<number, number>();
    try {
        for (const pr of list()) {
            if (pr.labels.some((l) => l.name === HUMAN_LABEL)) continue;
            const rounds = uiReceiptRounds(pr.comments.map((c) => c.body));
            if (uiReceiptCapReached(rounds)) capped.set(pr.number, rounds);
        }
    } catch {
        // a missed cap is caught next run; a wrongly capped PR is lost work
    }
    return capped;
}

function openPrComments() {
    return JSON.parse(
        gh([
            "pr",
            "list",
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,labels,comments",
        ])
    ) as {
        number: number;
        labels: { name: string }[];
        comments: { body: string }[];
    }[];
}

/**
 * Hand each capped PR to its human, once: label + one comment. Idempotent —
 * a PR already carrying the label is skipped. Returns the PRs escalated now.
 */
export function escalateCappedRepairs(
    capped: ReadonlyMap<number, number>,
    uiCapped: ReadonlyMap<number, number> = new Map()
): number[] {
    const done: number[] = [];
    const all = new Map<number, { failures: number; uiRounds?: number }>();
    for (const [pr, failures] of capped) all.set(pr, { failures });
    for (const [pr, uiRounds] of uiCapped)
        all.set(pr, {
            ...all.get(pr),
            failures: all.get(pr)?.failures ?? 0,
            uiRounds,
        });
    for (const [pr, { failures, uiRounds }] of all) {
        try {
            const view = JSON.parse(
                gh(["pr", "view", String(pr), "--json", "labels,comments"])
            ) as {
                labels: { name: string }[];
                comments: { body: string }[];
            };
            if (view.labels.some((l) => l.name === HUMAN_LABEL)) continue;
            const bodies = view.comments.map((c) => c.body);
            // Comment first, guarded by its marker: a human removing the label
            // to retry must not draw a second comment, and a failed label edit
            // must not leave a labelled PR without its explanation.
            if (!bodies.some((b) => b.includes(ESCALATION_MARKER)))
                gh([
                    "pr",
                    "comment",
                    String(pr),
                    "--body",
                    escalationComment({
                        failures,
                        classes: failureClasses(bodies),
                        uiRounds,
                    }),
                ]);
            gh(["pr", "edit", String(pr), "--add-label", HUMAN_LABEL]);
            done.push(pr);
        } catch (err) {
            console.error(
                `repair-cap: could not escalate PR #${pr} (${(err as Error).message.split("\n")[0]})`
            );
        }
    }
    return done;
}
