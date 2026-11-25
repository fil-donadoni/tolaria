// The `land-failed` PRs a pass can still repair (issue #6795), shared by the
// AFK dispatcher and `queue:plan` (issue #10716): the stalled-PR rule asks the
// SAME question the dispatcher does — "is a repair still owed this PR?" — so a
// PR nobody can repair stops occupying files, and one with a repair owed keeps
// them. One authority, never restated.
import { gh } from "./gh";
import { FAILED_LABEL } from "./land-labels";
import {
    cappedRepairPrs,
    cappedUiReceiptPrs,
    escalateCappedRepairs,
} from "./repair-cap";
import { repairItems, type PlanConfig, type RepairItem } from "./queue-plan";
import {
    livePassIssues,
    repairAttempted,
    type RepairPick,
    type WorkflowRun,
} from "./afk-dispatch";

/** The repair picks: open PRs labelled `land-failed`, each with the time of
 *  its newest `land-failed` label event (`null` when unreadable — the age
 *  then counts from the PR's creation). */
export function repairPicks(slug: string): RepairPick[] {
    const rows = JSON.parse(
        gh([
            "pr",
            "list",
            "--state",
            "open",
            "--label",
            FAILED_LABEL,
            "--limit",
            "100",
            "--json",
            "number,createdAt",
        ])
    ) as { number: number; createdAt: string }[];
    return rows.map((r) => {
        let failedAt: string | null = null;
        try {
            const times = gh([
                "api",
                "--paginate",
                `repos/${slug}/issues/${r.number}/events`,
                "--jq",
                `.[] | select(.event == "labeled" and .label.name == "${FAILED_LABEL}") | .created_at`,
            ])
                .split("\n")
                .filter((l) => l.trim() !== "");
            failedAt = times.length ? times[times.length - 1] : null;
        } catch {
            failedAt = null;
        }
        return { pr: r.number, failedAt, createdAt: r.createdAt };
    });
}

/** The `land-failed` PRs a pass can repair (issue #6795): `repairItems` over
 *  the open ones, minus an issue a live pass holds or a pass already tried
 *  since the label (`repairAttempted`); a closed issue (its PR outlived it)
 *  or an unreadable one is left to its human. */
export function repairDispatchables(
    slug: string,
    passRuns: readonly WorkflowRun[],
    config: PlanConfig,
    /** The dispatcher escalates a capped PR to its human, once; `queue:plan`
     *  only reads the same set and must never send that email. */
    escalate = false
): RepairItem[] {
    const prs = JSON.parse(
        gh([
            "pr",
            "list",
            "--state",
            "open",
            "--label",
            FAILED_LABEL,
            "--limit",
            "100",
            "--json",
            "number,headRefName",
        ])
    ) as { number: number; headRefName: string }[];
    const failedAt = new Map(repairPicks(slug).map((p) => [p.pr, p.failedAt]));
    // Repair cap (issue #6649): a PR whose repairs keep failing leaves the
    // loop for its human, once.
    // `ui-receipt` is its own class (issue #7649): counted from the check:ui
    // failure comments, so a PR never labelled `land-failed` is capped too.
    const failedCapped = cappedRepairPrs(slug, prs);
    const uiCapped = cappedUiReceiptPrs();
    if (escalate) escalateCappedRepairs(failedCapped, uiCapped);
    const capped = new Set([...failedCapped.keys(), ...uiCapped.keys()]);
    return repairItems(
        prs,
        (issue) => {
            try {
                const d = JSON.parse(
                    gh([
                        "issue",
                        "view",
                        String(issue),
                        "--json",
                        "state,labels,body",
                    ])
                ) as {
                    state: string;
                    labels: { name: string }[];
                    body: string;
                };
                if (d.state !== "OPEN") return null;
                return { labels: d.labels.map((l) => l.name), body: d.body };
            } catch {
                return null;
            }
        },
        config,
        livePassIssues(passRuns),
        capped
    ).filter(
        (r) => !repairAttempted(passRuns, r.number, failedAt.get(r.pr) ?? null)
    );
}
