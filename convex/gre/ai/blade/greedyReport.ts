// Issue #3393 — the greedy-vs-search measurement, blade half.
//
// Runs registry entries with the 1-ply greedy pick (`greedyRootPick`: the
// rollout policy applied at the root, NO search) and, optionally, with the
// real search at each entry's own budget, so the two deciders sit side by
// side on identical positions and seeds. Reports pass-rates per entry, per
// tier and per expected move kind, plus entry-level agreement.
//
// Pure — no node APIs — so the convex tsconfig project can type it and the
// gated runner spec (`__tests__/greedy-report.spec.ts`) owns the I/O. It is
// a REPORT, never a gate: a greedy failure asserts nothing about the bot.
// The number it buys is "how much of the correctness floor the policy alone
// already holds" — an input to the policy-first question on map #1892.
//
// Lives here rather than under `scripts/` because importing the blade module
// pulls `convex/game.ts` (through `setup.ts`'s engine-real steps) and with
// it `_generated/api` → `@auth/core` → preact → `lib.dom`, which changes how
// the scripts project types `Response` and reds an unrelated script.

import type { BladeScenario } from "./types";
import { runBladeScenario, type BladePick, type BladeResult } from "./runner";

/** The move kind an entry is about — its first positive matcher's kind, or
 *  `forbidden:<kind>` / `predicate` for the other two expectation shapes. */
export function expectedKind(s: BladeScenario): string {
    if (s.expect.moves) return s.expect.moves[0]?.kind ?? "?";
    if (s.expect.forbidden)
        return `forbidden:${s.expect.forbidden[0]?.kind ?? "?"}`;
    return "predicate";
}

export type GreedyLeg = {
    ok: boolean;
    seedsOk: number;
    seeds: number;
    picks: string[];
};

export type GreedyReportRow = {
    label: string;
    tier: string;
    kind: string;
    iterations: number;
    greedy: GreedyLeg;
    search?: GreedyLeg;
};

function leg(s: BladeScenario, pick: BladePick): GreedyLeg {
    const r: BladeResult = runBladeScenario(s, null, pick);
    return {
        ok: r.ok,
        seedsOk: r.seeds.filter((x) => x.ok).length,
        seeds: r.seeds.length,
        picks: r.seeds.map((x) => x.moveDescription),
    };
}

/** One row per scenario: the greedy leg always, the search leg on request.
 *  `onRow` fires as each row completes so a long run can stream progress. */
export function collectGreedyReport(
    scenarios: BladeScenario[],
    options: { withSearch: boolean; onRow?: (row: GreedyReportRow) => void }
): GreedyReportRow[] {
    const rows: GreedyReportRow[] = [];
    for (const s of scenarios) {
        const row: GreedyReportRow = {
            label: s.label,
            tier: s.tier,
            kind: expectedKind(s),
            iterations: s.budget.iterations,
            greedy: leg(s, "greedy"),
        };
        if (options.withSearch) row.search = leg(s, "search");
        rows.push(row);
        options.onRow?.(row);
    }
    return rows;
}

export type GreedyAgg = {
    entries: number;
    entriesOk: number;
    seeds: number;
    seedsOk: number;
};

export type GreedyReportSummary = {
    byTier: Record<string, { greedy: GreedyAgg; search: GreedyAgg }>;
    byKind: Record<string, { greedy: GreedyAgg; search: GreedyAgg }>;
    /** Entry-level agreement, counted only over rows that ran both legs. */
    agreement: {
        both: number;
        greedyOnly: number;
        searchOnly: number;
        neither: number;
    };
};

function agg(): GreedyAgg {
    return { entries: 0, entriesOk: 0, seeds: 0, seedsOk: 0 };
}

function add(a: GreedyAgg, l: GreedyLeg): void {
    a.entries++;
    if (l.ok) a.entriesOk++;
    a.seeds += l.seeds;
    a.seedsOk += l.seedsOk;
}

export function summarizeGreedyReport(
    rows: GreedyReportRow[]
): GreedyReportSummary {
    const byTier: GreedyReportSummary["byTier"] = {};
    const byKind: GreedyReportSummary["byKind"] = {};
    const bucket = (t: GreedyReportSummary["byTier"], k: string) =>
        (t[k] ??= { greedy: agg(), search: agg() });
    const agreement = { both: 0, greedyOnly: 0, searchOnly: 0, neither: 0 };
    for (const r of rows) {
        add(bucket(byTier, r.tier).greedy, r.greedy);
        add(bucket(byKind, r.kind).greedy, r.greedy);
        if (!r.search) continue;
        add(bucket(byTier, r.tier).search, r.search);
        add(bucket(byKind, r.kind).search, r.search);
        if (r.greedy.ok && r.search.ok) agreement.both++;
        else if (r.greedy.ok) agreement.greedyOnly++;
        else if (r.search.ok) agreement.searchOnly++;
        else agreement.neither++;
    }
    return { byTier, byKind, agreement };
}

function pct(n: number, d: number): string {
    return d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;
}

function fmt(a: GreedyAgg): string {
    return `${a.entriesOk}/${a.entries} entries (${pct(a.entriesOk, a.entries)}), ${a.seedsOk}/${a.seeds} seeds (${pct(a.seedsOk, a.seeds)})`;
}

/** One progress line per row, the shape the gated runner prints. */
export function formatGreedyRow(row: GreedyReportRow): string {
    const g = row.greedy.ok ? "ok  " : "FAIL";
    const sr = row.search
        ? ` | search ${row.search.ok ? "ok  " : "FAIL"} ${row.search.seedsOk}/${row.search.seeds}`
        : "";
    const head = `[${row.tier.padEnd(7)}] greedy ${g} ${row.greedy.seedsOk}/${row.greedy.seeds}${sr}  ${row.label}`;
    if (row.greedy.ok) return head;
    return `${head}\n           greedy picked: ${[...new Set(row.greedy.picks)].join(" | ")}`;
}

export function formatGreedyReport(
    rows: GreedyReportRow[],
    summary: GreedyReportSummary,
    elapsedMs: number
): string {
    const withSearch = rows.some((r) => r.search !== undefined);
    const out: string[] = [];
    out.push(
        `== greedy 1-ply pick vs blade registry (issue #3393) — ${rows.length} entries, ${(elapsedMs / 1000).toFixed(1)}s`
    );
    for (const [tier, a] of Object.entries(summary.byTier)) {
        out.push(`  ${tier.padEnd(8)} greedy: ${fmt(a.greedy)}`);
        if (withSearch) out.push(`  ${"".padEnd(8)} search: ${fmt(a.search)}`);
    }
    out.push(
        `\n== by expected move kind (greedy${withSearch ? " / search" : ""})`
    );
    for (const [kind, a] of Object.entries(summary.byKind).sort(
        (x, y) => y[1].greedy.entries - x[1].greedy.entries
    )) {
        out.push(
            `  ${kind.padEnd(28)} ${fmt(a.greedy)}${withSearch ? `  ||  ${fmt(a.search)}` : ""}`
        );
    }
    if (withSearch) {
        const g = summary.agreement;
        out.push(
            `\n== entry agreement: both ok ${g.both}, greedy-only ${g.greedyOnly}, search-only ${g.searchOnly}, neither ${g.neither}`
        );
        for (const r of rows) {
            if (r.search && r.greedy.ok !== r.search.ok)
                out.push(
                    `  ${r.greedy.ok ? "greedy-only" : "search-only"}  [${r.tier}] ${r.label}`
                );
        }
    }
    return out.join("\n");
}
