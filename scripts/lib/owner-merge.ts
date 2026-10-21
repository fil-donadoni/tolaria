/**
 * The decision behind `.github/workflows/owner-merge.yml` (issue #6188, ADR
 * 0156 §5): a `ready-to-land` PR the Mergify queue will never land (it
 * touches `.github/` or `.mergify.yml`, or its author is not trusted) fails
 * the run on purpose, and GitHub's own failed-run email reaches the owner.
 * The verdict is `land:ready`'s — `handsToQueue` over `trustedAuthorStatus` —
 * never a second copy of the protected-path list.
 */
import { READY_LABEL } from "./land-labels";
import { handsToQueue } from "./land-runner";
import { trustedAuthorStatus, type GatePr } from "./pr-gate";

export type OwnerMergeDecision =
    | { notify: false; reason: string }
    | {
          notify: true;
          /** Why the queue refuses the PR (the `trusted-author` description). */
          description: string;
      };

/** Whether the label just added hands the PR to someone by hand. */
export function ownerMergeDecision(input: {
    label: string;
    pr: GatePr;
    trusted: readonly string[];
}): OwnerMergeDecision {
    if (input.label !== READY_LABEL)
        return {
            notify: false,
            reason: `label \`${input.label}\` is not a hand-off`,
        };
    const status = trustedAuthorStatus(input.pr, input.trusted);
    if (handsToQueue({ trustedAuthor: status.state }))
        return { notify: false, reason: "the Mergify queue lands it" };
    return { notify: true, description: status.description };
}

/** The job summary: the PR, why the queue refuses it, the owner's checklist. */
export function ownerMergeSummary(input: {
    prNumber: number;
    prUrl: string;
    title: string;
    description: string;
}): string {
    return [
        `## Merge by hand: PR #${input.prNumber}`,
        "",
        `[#${input.prNumber} — ${input.title.replace(/[\r\n]+/g, " ")}](${input.prUrl}) is \`${READY_LABEL}\` but the merge queue will never land it.`,
        "",
        `**Why:** ${input.description}`,
        "",
        "**Checklist**",
        "",
        "- [ ] `check:lane (advisory)` is green on the PR",
        "- [ ] `base-health` is green on the PR",
        "- [ ] merge it by hand",
        "",
    ].join("\n");
}
