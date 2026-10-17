/**
 * `land` under a standing RED (issue #4964): may this PR merge while the
 * health marker stands? Pure functions over hand-buildable inputs.
 */

/**
 * How a landing made under a standing RED declared itself (issue #4964).
 * Absent on an ordinary landing.
 *
 *  - `repair` — the PR closes the issue a `/health-fix` session opened (see
 *    `repairIssues`), or `land --repair` declared it: the landing that can
 *    turn the tip GREEN.
 *  - `red-ok` — unrelated work landed on a red tip by `land --red-ok`: a
 *    stated act, never on its own a reason to re-gate.
 */
export type LandingKind = "repair" | "red-ok";

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
 * May `land` merge this PR while the RED marker stands?
 *
 * A repair — a PR closing an issue `/health-fix` opened, or `--repair` — lands
 * as before. Anything else needs `--red-ok`: a session mid-issue can still
 * finish, but as a stated act, not by default.
 */
export function redLandGate(input: {
    red: boolean;
    prBody: string;
    repairIssues: readonly number[];
    repairFlag: boolean;
    redOkFlag: boolean;
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
    if (input.repairFlag)
        return {
            kind: "proceed",
            landing: "repair",
            note: "a declared repair (--repair)",
        };
    if (input.redOkFlag)
        return {
            kind: "proceed",
            landing: "red-ok",
            note: "unrelated work on a RED tip (--red-ok)",
        };
    const known =
        input.repairIssues.length === 0
            ? "no /health-fix issue is recorded"
            : `it closes none of the /health-fix issues (${input.repairIssues.map((n) => `#${n}`).join(", ")})`;
    return {
        kind: "refuse",
        reason: `the health gate is RED and this PR is not a declared repair — ${known}. Pass --repair if it fixes the red tip, or --red-ok to land unrelated work anyway `,
    };
}
