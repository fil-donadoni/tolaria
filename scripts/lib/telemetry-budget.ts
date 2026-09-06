/**
 * Budget share over the telemetry mirror (issue #3080).
 *
 * ADR 0110 carries two targets. The latency one was measured in issue #3079.
 * The other — **"an issue costs under 0.5% of the weekly budget"** — could not
 * be evaluated at all, because every number the telemetry layer produced was an
 * API list-price equivalent (`costOf` in `telemetry-db.ts`) and the target is
 * stated as a share of an allowance nothing had a value for. A target with no
 * denominator is not a loose target; it is not a measurement.
 *
 * That gap is the same shape as the incident that motivated the target. On
 * 2026-08-25→27 roughly 91% of a weekly allowance went in 48 hours, and ADR
 * 0109 records why nobody saw it coming: the driver's budget guard logged
 * `pct=n/a` on every pass, because no budget was configured. The percentage was
 * missing, so the burn was invisible.
 *
 * This module turns consumption into a share. Everything here is PURE over
 * plain rows so it runs under the `node` vitest project (`bun:sqlite` is a Bun
 * builtin and is not importable there — the same split `telemetry-latency.ts`
 * and `telemetry-context.ts` use). The CLI in `scripts/telemetry-budget.ts`
 * owns every database call.
 *
 * ## Two currencies, never mixed
 *
 * A row can be quoted two ways and the report always says which:
 *
 * - **list price**, in USD, from `costOf` — what the same tokens would have
 *   cost at published API rates. Comparable across eras of this project;
 *   meaningless as a share of anything, because the work is not bought that
 *   way.
 * - **allowance units**, from `unitsOf` — weighted tokens in the unit
 *   `usage-window.ts` anchors at "1 Sonnet input token", the same unit the AFK
 *   driver's budget guard already uses. Only these divide into an allowance.
 *
 * For CLAUDE rows the two are proportional by construction and not by luck: the
 * weight table is today's list price divided by three, anchored at Sonnet input
 * (Opus output is 25/3 = 8.33 units, exactly its 25x dollar ratio). So on a
 * Claude-only window it does not matter which you divide — and the dollar
 * figure is still not a share, because no allowance is denominated in dollars.
 * That is the whole of the issue's complaint: not that list price weights the
 * models wrongly, but that it has no denominator.
 *
 * The proportionality is a property of today's table, not a guarantee, and the
 * store already breaks it: a DeepSeek row has real list-price dollars and
 * exactly zero allowance units. So the report quotes both, labels every column
 * with its currency, and never blends them — a single number carrying both
 * meanings is how "$140" came to say nothing about whether an issue ran away.
 *
 * ## The allowance is declared, never read
 *
 * There is no supported way to read the real Anthropic quota (ADR 0097): no
 * subcommand, nothing in the config or cache files, and `/usage` is
 * interactive-only. The weekly allowance is therefore a value the USER
 * declares, and {@link resolveAllowance} is the single place that resolves it.
 * **Absence degrades to "share unavailable", never to a percentage.** A default
 * baked in here would be exactly the failure this issue exists to fix, one
 * layer down: a number that looks like a measurement and is a guess.
 *
 * ## Attribution — how a row becomes an issue's cost
 *
 * Under ADR 0110 a session IS an issue: `/next-issue N` opens it, one issue
 * closes in it, and 87% of the cost is main-thread (measured over
 * 2026-08-28 → 2026-09-05: $2093 main vs $314 subagent). So attribution runs at
 * SESSION level — `agent_runs.issue`, which the dashboard's issue table uses,
 * sees only the subagent 13% and would have reported an eighth of an issue's
 * cost as its cost.
 *
 * A session is attributed when its opening slash command names exactly ONE
 * issue number ({@link issueFromSessionCommand}). Naming several is the legacy
 * `/process-gh-issues` batch shape, where one session worked many issues and no
 * split between them is recoverable — those sessions are left unattributed and
 * their volume is reported as such, rather than charged whole to whichever
 * number appeared first. Over the baseline window attribution reaches 78% of
 * allowance units (629M of 804M).
 */

import { issueFromSessionCommand } from "./telemetry-db.ts";
import { quantile } from "./telemetry-latency.ts";

/**
 * The ONE name for the weekly allowance. Every consumer reads it through
 * {@link resolveAllowance}; nothing else in the repo may hard-code a weekly
 * figure, or the report and whoever acts on it can disagree about what 100%
 * means.
 *
 * Unit: weighted tokens, anchored at "1 unit == 1 Sonnet input token" — the
 * same unit as the AFK driver's `TOLARIA_LOOP_TOKEN_BUDGET` (ADR 0109), which
 * is deliberately a DIFFERENT value: that one budgets a rolling few-hour
 * window, this one a week. Sharing the unit is what lets the two be compared;
 * sharing the value would be wrong.
 */
export const WEEKLY_ALLOWANCE_ENV = "TOLARIA_WEEKLY_ALLOWANCE";

/** A resolved allowance and where it came from — the provenance is printed. */
export interface Allowance {
    /** Weighted tokens per week. Always finite and > 0. */
    unitsPerWeek: number;
    /** Human-readable origin, e.g. `--allowance` or `$TOLARIA_WEEKLY_ALLOWANCE`. */
    source: string;
}

/**
 * Parse an allowance literal. Accepts a plain number of units and the `M` / `G`
 * suffixes, because the realistic magnitudes are around 10^9 and a mistyped
 * zero in a raw literal is a silently wrong denominator.
 *
 * Returns null — never 0, never NaN — for anything unusable, so a caller cannot
 * accidentally divide by it. Zero and negatives are unusable by the same rule
 * `pctOfBudget` applies: "no budget configured" is not "a budget of nothing".
 */
export function parseAllowance(raw: string | null | undefined): number | null {
    if (raw === null || raw === undefined) return null;
    const m = /^\s*([0-9]*\.?[0-9]+)\s*([MG])?\s*$/i.exec(raw);
    if (!m) return null;
    const scale = m[2] ? (m[2].toUpperCase() === "G" ? 1e9 : 1e6) : 1;
    const value = Number(m[1]) * scale;
    return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Resolve the weekly allowance: explicit flag first, then the environment.
 *
 * An UNPARSABLE value is not a missing one — it is a typo in the only number
 * every percentage in the report divides by. It resolves to null (share
 * unavailable), and the CLI says which of the two happened.
 *
 * **A flag that was PRESENT and unusable stops the resolution there**, rather
 * than falling through to the environment. Falling through would hand back a
 * denominator the user believes they just overrode, and the CLI's warning only
 * fires when the resolution came back empty — so the report would quote a stale
 * allowance with nothing on screen saying the override was rejected. That is
 * the silently-wrong-denominator failure this whole module exists to close, one
 * layer down: an explicit-but-broken override instead of an absent one.
 */
export function resolveAllowance(opts: {
    flag?: string | null;
    env?: string | null;
}): Allowance | null {
    const flagGiven = opts.flag !== null && opts.flag !== undefined;
    if (flagGiven) {
        const fromFlag = parseAllowance(opts.flag);
        return fromFlag === null
            ? null
            : { unitsPerWeek: fromFlag, source: "--allowance" };
    }
    const fromEnv = parseAllowance(opts.env);
    if (fromEnv !== null)
        return { unitsPerWeek: fromEnv, source: `$${WEEKLY_ALLOWANCE_ENV}` };
    return null;
}

/** True for a session opened with `/next-issue` — the ADR 0110 pipeline. */
export function isNextIssueCommand(cmd: string | null): boolean {
    return /^\/next-issue\b/.test(cmd ?? "");
}

/** One session, already reduced to its totals. */
export interface SessionConsumption {
    session: string;
    cmd: string | null;
    /** Weighted tokens that draw on the Claude allowance. */
    units: number;
    /** API list-price equivalent, USD, of the SAME rows. */
    usd: number;
    /** List-price USD of rows that draw on no Claude allowance (opencode et al). */
    nonClaudeUsd: number;
}

/** One issue, summed over every session that named it. */
export interface IssueConsumption {
    issue: number;
    units: number;
    usd: number;
    sessions: number;
    /** `open` | `closed` | `unknown` — from `issue_meta`, absent when never fetched. */
    state: string | null;
    /** True when at least one of its sessions was a `/next-issue` run. */
    nextIssue: boolean;
    /** Share of the weekly allowance, percent; null when no allowance is configured. */
    sharePct: number | null;
}

/** What a window consumed, before any per-issue split. */
export interface WindowTotals {
    /** Allowance-drawing weighted tokens over the whole window. */
    units: number;
    /** List-price USD of the same rows. */
    usd: number;
    /** List-price USD of non-Claude rows — reported, never folded in. */
    nonClaudeUsd: number;
    /** Units that no session command attributed to an issue. */
    unattributedUnits: number;
    /** Days spanned by the window, inclusive — the weekly share's scaling. */
    days: number;
}

/** median / p90 / max of a per-issue quantity. */
export interface ShareStat {
    median: number;
    p90: number;
    max: number;
    n: number;
}

/** Roll sessions up into issues, carrying attribution and issue state. */
export function attributeIssues(
    sessions: readonly SessionConsumption[],
    states: ReadonlyMap<number, string>,
    allowance: Allowance | null
): IssueConsumption[] {
    const byIssue = new Map<number, IssueConsumption>();
    for (const s of sessions) {
        const issue = issueFromSessionCommand(s.cmd);
        if (issue === null) continue;
        let row = byIssue.get(issue);
        if (!row) {
            row = {
                issue,
                units: 0,
                usd: 0,
                sessions: 0,
                state: states.get(issue) ?? null,
                nextIssue: false,
                sharePct: null,
            };
            byIssue.set(issue, row);
        }
        row.units += s.units;
        row.usd += s.usd;
        row.sessions += 1;
        row.nextIssue ||= isNextIssueCommand(s.cmd);
    }
    const rows = [...byIssue.values()];
    if (allowance) {
        for (const r of rows)
            r.sharePct = (r.units / allowance.unitsPerWeek) * 100;
    }
    return rows.sort((a, b) => b.units - a.units);
}

/**
 * median / p90 / max.
 *
 * **max, not mean**, and that is the whole point of reporting a distribution
 * here: the failure mode is the runaway tail, and under the orchestrator a
 * single issue reached $1095 against a $59 median. A mean hides that in both
 * directions — it is dragged up by the runaway and still understates it.
 * `quantile` is the nearest-rank one from `telemetry-latency.ts`, reused rather
 * than copied so the two reports cannot answer "p90" differently.
 */
export function shareStat(values: readonly number[]): ShareStat {
    if (values.length === 0) return { median: 0, p90: 0, max: 0, n: 0 };
    return {
        median: quantile([...values], 0.5),
        p90: quantile([...values], 0.9),
        max: Math.max(...values),
        n: values.length,
    };
}

/** The cohorts the report splits issues into, in the order it prints them. */
export interface Cohort {
    name: string;
    issues: IssueConsumption[];
}

/**
 * Split attributed issues into the cohorts the target is about.
 *
 * `/next-issue` closed issues come first: that is literally the population ADR
 * 0110's target speaks about. The wider cohorts are there so a reader can see
 * whether the headline is an artifact of the narrower one.
 */
export function cohorts(issues: readonly IssueConsumption[]): Cohort[] {
    const closed = (r: IssueConsumption) => r.state === "closed";
    return [
        {
            name: "closed issues run by /next-issue (the ADR 0110 target's population)",
            issues: issues.filter((r) => r.nextIssue && closed(r)),
        },
        {
            name: "all issues run by /next-issue",
            issues: issues.filter((r) => r.nextIssue),
        },
        {
            name: "all attributed issues in window",
            issues: [...issues],
        },
    ];
}

function pad(s: string, w: number, right = true): string {
    return right ? s.padStart(w) : s.padEnd(w);
}

function units(u: number): string {
    return u >= 1e9 ? `${(u / 1e9).toFixed(2)}G` : `${(u / 1e6).toFixed(1)}M`;
}

function usd(v: number): string {
    return `$${v.toFixed(0)}`;
}

/**
 * A percentage, or the explicit refusal to invent one.
 *
 * This is the SINGLE place that decides how an absent share renders, and every
 * caller routes through it — including the ones that know perfectly well the
 * value is missing. An earlier version had each call site choose between
 * `share(x)` and a literal `"n/a"`, which left this null branch unreachable:
 * breaking it to print `0.00%` kept the whole suite green. A guard nothing can
 * reach is not a guard.
 */
function share(pct: number | null): string {
    return pct === null ? "n/a" : `${pct.toFixed(2)}%`;
}

/**
 * Render the whole report as one plain-text receipt, safe to paste into a PR.
 *
 * Every figure carries its currency in the column header, and the allowance
 * line says whether a denominator exists at all — the report must be readable
 * without knowing which of the two numbers it is quoting.
 */
export function formatReport(
    from: string,
    to: string,
    totals: WindowTotals,
    allowance: Allowance | null,
    cohortList: readonly Cohort[],
    targetPct: number
): string {
    const LABEL = 26;
    const COL = 10;
    const out: string[] = [];
    const row = (label: string, ...cells: string[]) =>
        `    ${pad(label, LABEL, false)}${cells.map((c) => pad(c, COL)).join("")}`;
    /** A single value plus a left-aligned note — the note must not be padded
     * into the value column, or the receipt reads as one run-on number. */
    const noted = (label: string, value: string, note: string) =>
        `${row(label, value)}  ${note}`;

    out.push(`budget share per issue — ${from} → ${to} (${totals.days}d)`);
    out.push("");
    out.push(
        allowance
            ? `  weekly allowance ${units(allowance.unitsPerWeek)} units, declared via ${allowance.source}` +
                  `\n  (a USER-DECLARED figure, not a quota reading — no supported way to read the real one exists)`
            : `  weekly allowance NOT CONFIGURED — every share below reads "n/a".` +
                  `\n  Set ${WEEKLY_ALLOWANCE_ENV} or pass --allowance <units>; this report never invents a denominator.`
    );
    out.push("");
    out.push("  window consumption");
    out.push(
        allowance
            ? noted(
                  "allowance units",
                  units(totals.units),
                  `= ${share((totals.units / allowance.unitsPerWeek) * 100)} of one week's allowance, over a ${totals.days}d window`
              )
            : row("allowance units", units(totals.units))
    );
    const attributed = totals.units - totals.unattributedUnits;
    out.push(
        noted(
            "  attributed to an issue",
            units(attributed),
            totals.units > 0
                ? `(${((attributed / totals.units) * 100).toFixed(0)}% of the window)`
                : "(0% of the window)"
        )
    );
    out.push(
        noted(
            "list price",
            usd(totals.usd),
            "API-equivalent — NOT a share of anything"
        )
    );
    if (totals.nonClaudeUsd > 0) {
        out.push(
            noted(
                "non-Claude models",
                usd(totals.nonClaudeUsd),
                "list price only — draws on no Claude allowance"
            )
        );
    }

    for (const c of cohortList) {
        out.push("");
        out.push(`  ${c.name} — ${c.issues.length} issues`);
        if (c.issues.length === 0) {
            out.push("    (none in window)");
            continue;
        }
        const shares = c.issues
            .map((r) => r.sharePct)
            .filter((p): p is number => p !== null);
        const u = shareStat(c.issues.map((r) => r.units));
        const d = shareStat(c.issues.map((r) => r.usd));
        const p = shares.length === c.issues.length ? shareStat(shares) : null;
        out.push(row("per issue", "median", "p90", "max"));
        out.push(
            row("allowance units", units(u.median), units(u.p90), units(u.max))
        );
        out.push(
            row(
                "share of weekly allowance",
                share(p?.median ?? null),
                share(p?.p90 ?? null),
                share(p?.max ?? null)
            )
        );
        out.push(
            row(
                "list price (not a share)",
                usd(d.median),
                usd(d.p90),
                usd(d.max)
            )
        );
        out.push(
            `    ADR 0110 target — under ${targetPct}% of the week per issue: ${
                p === null
                    ? "UNEVALUATED (no allowance configured)"
                    : p.median <= targetPct
                      ? `MET (median ${share(p.median)})`
                      : `NOT MET (median ${share(p.median)})`
            }`
        );
    }
    return out.join("\n");
}
