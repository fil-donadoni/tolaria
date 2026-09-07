import { tier } from "./format";
import type {
    FamilyRow,
    IssueRow,
    IssueTierSummary,
    SessionRow,
} from "./historyPayload";

/**
 * The row-shaping History does before it renders (PRD #3148 S3) — the filter
 * predicates, the option sets the pickers offer, and the Family × role pivot.
 *
 * PURE, and in `lib/` rather than beside the components, for one reason: this
 * is where the behaviour a person would call a BUG lives. Whether `(none)`
 * stands for a missing family, whether a search matches the session id as well
 * as its title, whether an issue with no `state` is filterable at all — each is
 * a decision the vanilla tables made inside a render function, where the only
 * way to test it was to build a DOM and read cells back out.
 */

/* ── Issues ────────────────────────────────────────────────────────────── */

export interface IssueFilterState {
    /** `""` means "all" for each of these — the raw value otherwise. */
    family: string;
    tier: string;
    state: string;
    text: string;
}

export const EMPTY_ISSUE_FILTER: IssueFilterState = {
    family: "",
    tier: "",
    state: "",
    text: "",
};

/** A missing family is a filterable value, not an absence — an issue with no
 *  recorded family is exactly the thing a person filters FOR. */
export const familyOf = (r: IssueRow): string => r.family ?? "(none)";
export const issueStateOf = (r: IssueRow): string => r.state ?? "?";

export const issueFamilies = (rows: readonly IssueRow[]): string[] => [
    ...new Set(rows.map(familyOf)),
];
export const issueTiers = (rows: readonly IssueRow[]): string[] => [
    ...new Set(rows.map((r) => tier(r.impl_model))),
];
export const issueStates = (rows: readonly IssueRow[]): string[] => [
    ...new Set(rows.map(issueStateOf)),
];

/** The search matches the issue NUMBER as well as the title — `#3152` is how
 *  a person refers to one, and it appears in no other column as text. */
export function filterIssues(
    rows: readonly IssueRow[],
    f: IssueFilterState
): IssueRow[] {
    const text = f.text.toLowerCase();
    return rows.filter(
        (r) =>
            (!f.family || familyOf(r) === f.family) &&
            (!f.tier || tier(r.impl_model) === f.tier) &&
            (!f.state || issueStateOf(r) === f.state) &&
            (!text ||
                `#${r.issue} ${r.title ?? ""}`.toLowerCase().includes(text))
    );
}

/** The fixup-rate headline: one clause per model tier, which is the whole
 *  reason the Issues card exists as a narrative rather than a table. */
export const fixupRate = (
    tiers: Record<string, IssueTierSummary> | undefined
): string =>
    Object.entries(tiers ?? {})
        .map(
            ([model, t]) =>
                `${tier(model)}: ${t.withFixup}/${t.issues} with fixup`
        )
        .join(" · ") || "no data";

/* ── Sessions ──────────────────────────────────────────────────────────── */

export interface SessionFilterState {
    cmd: string;
    text: string;
}

export const EMPTY_SESSION_FILTER: SessionFilterState = { cmd: "", text: "" };

/** The COMMAND FAMILY — the first whitespace-delimited word of the command
 *  line. `/next-issue 3152` and `/next-issue 3153` are one bucket, which is
 *  the grouping a person filters by; the arguments are per-session noise. */
export const cmdBase = (c: string | null | undefined): string =>
    (c ?? "").split(/\s/)[0] || "(none)";

/** `prs` arrives as a JSON string; an unparseable value counts as none rather
 *  than throwing out of a sort comparator. */
export function prCount(r: SessionRow): number {
    return prList(r).length;
}

export function prList(r: SessionRow): string[] {
    if (!r.prs) return [];
    try {
        const parsed: unknown = JSON.parse(r.prs);
        return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
        return [];
    }
}

export const sessionCommands = (rows: readonly SessionRow[]): string[] => [
    ...new Set(rows.map((r) => cmdBase(r.cmd))),
];

/** Title, command line AND session id — the id is the only handle an operator
 *  has when a session has no title yet, and it is what the transcript files
 *  are named after. */
export function filterSessions(
    rows: readonly SessionRow[],
    f: SessionFilterState
): SessionRow[] {
    const text = f.text.toLowerCase();
    return rows.filter(
        (r) =>
            (!f.cmd || cmdBase(r.cmd) === f.cmd) &&
            (!text ||
                `${r.title ?? ""} ${r.cmd ?? ""} ${r.session}`
                    .toLowerCase()
                    .includes(text))
    );
}

/* ── Family × role ─────────────────────────────────────────────────────── */

/** The four role columns the pivot shows. Anything the server reports under
 *  another role folds into `support` — a new role must not silently vanish
 *  from a table whose columns are fixed. */
export const ROLE_COLS = ["implement", "review", "fixup", "support"] as const;
export type RoleCol = (typeof ROLE_COLS)[number];

export interface RoleCell {
    minutes: number;
    cost: number;
    out_tok: number;
}

export interface FamilyPivotRow {
    family: string;
    /** Absent for a role this family never ran — the cell renders empty, and
     *  "no runs" is a different statement from "$0 of runs". */
    roles: Partial<Record<RoleCol, RoleCell>>;
    /** The largest per-role issue count, not a sum: the same issues are
     *  counted once per role, so adding them would multiply-count. */
    issues: number;
    total: number;
}

/** Families as rows, roles as columns, descending by total cost. */
export function pivotFamilies(rows: readonly FamilyRow[]): FamilyPivotRow[] {
    const byFamily = new Map<string, FamilyPivotRow>();
    for (const r of rows) {
        let f = byFamily.get(r.family);
        if (!f) {
            f = { family: r.family, roles: {}, issues: 0, total: 0 };
            byFamily.set(r.family, f);
        }
        const key = (ROLE_COLS as readonly string[]).includes(r.role)
            ? (r.role as RoleCol)
            : "support";
        const cell = (f.roles[key] ??= { minutes: 0, cost: 0, out_tok: 0 });
        cell.minutes += r.minutes;
        cell.cost += r.cost;
        cell.out_tok += r.out_tok;
        f.issues = Math.max(f.issues, r.issues);
        f.total += r.cost;
    }
    return [...byFamily.values()].sort((a, b) => b.total - a.total);
}
