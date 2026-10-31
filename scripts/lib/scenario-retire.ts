// The pure decisions behind `retire-reverted-scenarios.ts` (issue #7702):
// which PRs a landing reverts, and how each retire is called and reported.
//
// WHY A RETIRE AT ALL. `land` seeds a merged PR's `## Preset scenario` into
// the deployment (ADR 0044, upsert by label). When that PR is later reverted
// — by the RED ladder's revert rung (ADR 0158 § 3) or by hand — the revert
// PR declares "None owed", so nothing seeds and nothing deletes: the row
// outlives the cards it names and throws `Card not found by name` on load.
// Observed on PR #7612 → reverted by PR #7623 (2026-10-31).
//
// WHERE THE REVERTED PRs COME FROM — the SAME list the ladder records, never
// a second reading of git history:
//
//  - THE LADDER'S REVERT writes one `revertRestoresLine` per reverted commit
//    (full sha) into the revert PR's body (`revertPrBody`,
//    `lib/health-ladder.ts`); `land` already reads those lines back for the
//    `check:ui` restore check (`revertedCommitsOf`). Each sha maps to its PR by
//    its squash subject through `prOfSubject` — the function the ladder's own
//    `planRevertSet` names its culprits with.
//  - A HAND REVERT names the reverted PR on a `Reverts …` line: GitHub's
//    revert button writes `Reverts owner/repo#N`; a hand-written body says
//    `Reverts PR #N` or `Reverts #N`. An `issue #N` on that line is NOT a PR
//    and is skipped (the ladder's line cites `issue #7446`).

import { prOfSubject } from "./health-bisect";
import { convexRunArgv } from "./seed-scenario-run";
import { revertedCommitsOf } from "./ui-scope";

/** A line of a PR body that declares what it reverts. */
const REVERTS_LINE = /^Reverts\b.*$/gm;
/** A PR reference on a `Reverts` line: `#N`, `PR #N`, `owner/repo#N` — but
 *  never `issue #N`. */
const PR_REF = /(?<!issue )(?:PR |[\w.-]+\/[\w.-]+)?#(\d+)\b/g;

/**
 * Every PR a landing's body says it reverts, ascending, each once — empty for
 * a PR that reverts nothing (the common case: the step is then a no-op).
 *
 * `subjectOf` reads a commit's subject (`git log -1 --format=%s <sha>` in the
 * primary checkout); null when the commit cannot be read. A sha whose subject
 * names no PR (a direct commit) seeded nothing and contributes nothing.
 */
export function revertedPrsOf(
    prBody: string,
    subjectOf: (sha: string) => string | null
): number[] {
    const prs = new Set<number>();
    for (const sha of revertedCommitsOf(prBody)) {
        const subject = subjectOf(sha);
        const pr = subject === null ? null : prOfSubject(subject);
        if (pr !== null) prs.add(pr);
    }
    for (const line of prBody.match(REVERTS_LINE) ?? []) {
        for (const m of line.matchAll(PR_REF)) prs.add(Number(m[1]));
    }
    return [...prs].sort((a, b) => a - b);
}

/** The `npx` argv of one retire. `push` on the FIRST call of a run only:
 *  `retireScenariosByLabel` must exist in the deployed bundle, and the
 *  fast-forward `land` just made is what carries it (constraint 1b of
 *  `lib/seed-scenario-run.ts`); a second push would buy nothing. */
export function retireScenarioArgv(label: string, push: boolean): string[] {
    return convexRunArgv(
        "debugScenarios:retireScenariosByLabel",
        JSON.stringify({ label }),
        { push }
    );
}

/** What `retireScenariosByLabel` returns. */
export interface RetireCounts {
    retired: number;
    kept: number;
}

/**
 * The line(s) one retire prints. A KEPT row is the named warning the golden
 * decision owes (`selectRetirableScenarioIds`): an admin-authored row shares
 * the reverted PR's label, still names the reverted cards, and stays until a
 * human runs `scenario:rm`.
 */
export function formatRetireOutcome(
    pr: number,
    label: string,
    counts: RetireCounts
): string[] {
    const lines = [
        counts.retired === 0
            ? `retire-scenario: PR #${pr} "${label}" — no seeded row (already gone)`
            : `retire-scenario: PR #${pr} "${label}" — retired ${counts.retired} row(s)`,
    ];
    if (counts.kept > 0) {
        lines.push(
            `retire-scenario: WARNING — kept ${counts.kept} admin-authored row(s) labelled "${label}"; it may name cards the revert removed — \`bun run scenario:rm "${label}"\` if so`
        );
    }
    return lines;
}
