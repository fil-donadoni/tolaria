/**
 * A PR under a standing RED (issue #4964): may it merge while the health
 * marker stands? Pure functions over hand-buildable inputs.
 */

/**
 * How a landing made under a standing RED declared itself (issue #4964).
 * Absent on an ordinary landing. `repair`: the PR closes the issue a
 * `/health-fix` session opened (see `repairIssues`), the landing that can turn
 * the tip GREEN.
 */
export type LandingKind = "repair";

/** The issues a PR body closes, by GitHub's own keywords. Only a BARE `#N`
 *  closes — `Closes issue #N` does not, so it does not count here either. */
export function closingIssueRefs(body: string): number[] {
    const refs = new Set<number>();
    const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;
    for (const m of body.matchAll(re)) refs.add(Number(m[1]));
    return [...refs];
}

export type RedLandVerdict =
    | {
          kind: "proceed";
          /** How this landing declared itself; absent off RED. */
          landing?: LandingKind;
          note?: string;
      }
    | { kind: "refuse"; reason: string };

/**
 * May this PR merge while the RED marker stands? Only a repair: a PR closing
 * an issue `/health-fix` recorded on the pivot.
 */
export function redLandGate(input: {
    red: boolean;
    prBody: string;
    repairIssues: readonly number[];
}): RedLandVerdict {
    if (!input.red) return { kind: "proceed" };
    const closed = closingIssueRefs(input.prBody).filter((n) =>
        input.repairIssues.includes(n)
    );
    if (closed.length > 0)
        return {
            kind: "proceed",
            landing: "repair",
            note: `a declared repair — closes issue #${closed[0]}, opened by /health-fix`,
        };
    const known =
        input.repairIssues.length === 0
            ? "no /health-fix issue is recorded"
            : `it closes none of the /health-fix issues (${input.repairIssues.map((n) => `#${n}`).join(", ")})`;
    return {
        kind: "refuse",
        reason: `the health gate is RED and this PR is not a declared repair — ${known}. Record it with \`bun run health:fix repair-issue --issue=<N>\` if it fixes the red tip`,
    };
}
