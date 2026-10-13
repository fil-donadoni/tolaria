/**
 * Audit Themes — the closed list a Bot Audit is seeded with (ADR 0149 §5,
 * issue #4923, PRD issue #4920).
 *
 * A theme is `Decision Class × mechanic family`, in the corpus census's class
 * vocabulary (`verdicts/coverage.ts` `DecisionClass`; `any` where the census
 * target cuts across classes). `BladeScenario.audit.theme` draws from this
 * list so the coverage census (themes × pairs × red/green) is typed, never a
 * hand-kept ledger. Adding a theme is ONE row below.
 */

import type { BladeScenario } from "./types";

/** Every Audit Theme with its readable description. The keys ARE the closed
 *  union (`AuditTheme`). */
export const AUDIT_THEMES = {
    "cast × blink": "Casting a spell whose payoff is a flicker/blink effect.",
    "land-drop × enters-tapped":
        "Which land to play when some enter tapped and others do not.",
    "declare-attackers|declare-blockers × first-strike/double-strike/deathtouch":
        "Combat declarations where first strike, double strike or deathtouch changes the exchange.",
    "declare-attackers × planeswalker":
        "Attacking when a planeswalker is a legal attack target or an attacker's threat.",
    "cast × counterspell-as-cycler":
        "Casting a counterspell for its cycling or alternative use instead of holding it.",
    "any × non-empty-stack":
        "Any decision taken while the Stack is non-empty (census target).",
    "declare-blockers × combat": "Block assignments (census target: blockers).",
    "declare-attackers × combat":
        "Attack assignments (census target: attackers).",
    "targeting × any": "Target selection (census target: targeting).",
    "mulligan × any":
        "Mulligan keep/bottom decisions (census target: mulligan).",
} as const;

/** The closed union of Audit Themes. */
export type AuditTheme = keyof typeof AUDIT_THEMES;

export const AUDIT_THEME_LIST = Object.keys(AUDIT_THEMES) as AuditTheme[];

/** What an audit entry owes to be honest about itself: a known theme; and, as
 *  a `stretch` entry, a classified `beyondBudget.cause` plus its issue named
 *  in `note` as `issue #N`. A `must` audit entry owes neither (its fix
 *  landed). Returns one message per problem; empty = honest. Entries without
 *  `audit` are not judged here. */
export function auditEntryProblems(
    scenario: Pick<BladeScenario, "label" | "audit" | "tier" | "beyondBudget">
): string[] {
    if (scenario.audit === undefined) return [];
    const problems: string[] = [];
    const { theme } = scenario.audit;
    if (!(AUDIT_THEME_LIST as string[]).includes(theme)) {
        problems.push(
            `"${scenario.label}": audit theme "${theme}" is not in AUDIT_THEMES`
        );
    }
    if (scenario.tier === "stretch") {
        const bb = scenario.beyondBudget;
        if (bb?.cause === undefined) {
            problems.push(
                `"${scenario.label}": audit stretch entry has no beyondBudget.cause (ADR 0070)`
            );
        }
        if (!/issue #\d+/.test(bb?.note ?? "")) {
            problems.push(
                `"${scenario.label}": audit stretch entry's beyondBudget.note does not name its issue as "issue #N"`
            );
        }
    }
    return problems;
}
