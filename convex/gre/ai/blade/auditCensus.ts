/**
 * Audit census — themes × pairs × red/green × issues, a typed read of the
 * registry (ADR 0149 §5, issue #4925, PRD issue #4920).
 *
 * What a Bot Audit has covered, per Audit Theme (`auditThemes.ts`), read from
 * the registry entries and never from a hand-kept ledger. Pure: takes the
 * scenarios, runs nothing, so it prints in seconds. The registry itself is
 * loaded by `__tests__/audit-census.spec.ts` (importing it pulls
 * `convex/game.ts` and with it `lib.dom`, which reds the `scripts` project).
 *
 * A PAIR is two entries: an anchor and its right-hand half. Pairs are read
 * from the `pairOf` field (issue #4796) where an entry carries it, and from
 * the `PAIRED WITH "<label>"` prose of `note` otherwise — the prose the
 * registry carried before the field. A pair belongs to the theme of its half,
 * else of its anchor; a pair neither member of which carries `audit.theme`
 * belongs to no audit and is not counted. Red / green count the pair's
 * MEMBERS by tier: `stretch` = red (the Bot is wrong now), `must` = green.
 * The issues are the `issue #N` refs the members' notes name.
 */

import { AUDIT_THEME_LIST, type AuditTheme } from "./auditThemes";
import type { BladeScenario } from "./types";

/** The slice of a registry entry the census reads. */
export type CensusScenario = Pick<
    BladeScenario,
    "label" | "tier" | "note" | "pairOf" | "audit" | "beyondBudget"
>;

export type AuditCensusRow = {
    theme: AuditTheme;
    pairs: number;
    red: number;
    green: number;
    /** Issue numbers named by the notes of the theme's pair members, sorted. */
    issues: number[];
};

type Pair = { half: CensusScenario; anchorLabel: string };

const PROSE_PARTNER = /PAIRED WITH\s+["“']([^"”']+)["”']/;
const ISSUE_REF = /issue #(\d+)/g;

/** The pairs the scenarios declare, each once. A `pairOf` field wins over the
 *  entry's own prose; a pair declared from both sides is counted once. */
export function readPairs(scenarios: readonly CensusScenario[]): Pair[] {
    const pairs: Pair[] = [];
    const seen = new Set<string>();
    for (const half of scenarios) {
        const anchorLabel =
            half.pairOf?.anchor ?? PROSE_PARTNER.exec(half.note ?? "")?.[1];
        if (anchorLabel === undefined) continue;
        const key = [half.label, anchorLabel].sort().join("\u0000");
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ half, anchorLabel });
    }
    return pairs;
}

function issuesNamedBy(text: string | undefined): number[] {
    return [...(text ?? "").matchAll(ISSUE_REF)].map((m) => Number(m[1]));
}

/** One row per theme of `themes` (default: the whole closed list), zero-pair
 *  themes included so the least-covered ground is visible. */
export function auditCensus(
    scenarios: readonly CensusScenario[],
    themes: readonly AuditTheme[] = AUDIT_THEME_LIST
): AuditCensusRow[] {
    const byLabel = new Map(scenarios.map((s) => [s.label, s]));
    const rows = new Map<AuditTheme, AuditCensusRow & { refs: Set<number> }>(
        themes.map((theme) => [
            theme,
            { theme, pairs: 0, red: 0, green: 0, issues: [], refs: new Set() },
        ])
    );
    for (const { half, anchorLabel } of readPairs(scenarios)) {
        const anchor = byLabel.get(anchorLabel);
        const theme = half.audit?.theme ?? anchor?.audit?.theme;
        const row = theme === undefined ? undefined : rows.get(theme);
        if (row === undefined) continue;
        row.pairs += 1;
        for (const member of anchor === undefined ? [half] : [half, anchor]) {
            if (member.tier === "stretch") row.red += 1;
            else row.green += 1;
            for (const n of issuesNamedBy(member.note)) row.refs.add(n);
            for (const n of issuesNamedBy(member.beyondBudget?.note)) {
                row.refs.add(n);
            }
        }
    }
    return [...rows.values()].map(({ refs, ...row }) => ({
        ...row,
        issues: [...refs].sort((a, b) => a - b),
    }));
}

/** The table `/bot-audit` prints on opening. */
export function formatAuditCensus(rows: readonly AuditCensusRow[]): string {
    const width = Math.max(5, ...rows.map((r) => r.theme.length));
    const line = (
        theme: string,
        pairs: string,
        red: string,
        green: string,
        issues: string
    ) =>
        `${theme.padEnd(width)}  ${pairs.padStart(5)}  ${red.padStart(3)}  ${green.padStart(5)}  ${issues}`;
    return [
        line("theme", "pairs", "red", "green", "issues"),
        ...rows.map((r) =>
            line(
                r.theme,
                String(r.pairs),
                String(r.red),
                String(r.green),
                r.issues.map((n) => `#${n}`).join(" ") || "-"
            )
        ),
        `${rows.filter((r) => r.pairs === 0).length}/${rows.length} themes have no pair`,
    ].join("\n");
}
