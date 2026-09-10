#!/usr/bin/env bun
// `bun scripts/blade-greedy.ts [--tier must|stretch|all] [--with-search]
//                              [--out <path>.json] [--label <substring>]`
//
// Issue #3393 — the greedy-vs-search measurement, blade half. Runs every
// registry entry with the 1-ply greedy pick (`greedyRootPick`: the rollout
// policy applied at the root, NO search) and reports the pass-rate per entry,
// per tier and per expected move kind. `--with-search` also runs the real
// ISMCTS at each entry's own budget, so the two deciders sit side by side on
// identical positions and seeds (slow: the must suite's full cost).
//
// This is a REPORT, never a gate: a greedy failure asserts nothing about the
// bot. The number it buys is "how much of the correctness floor the policy
// alone already holds" — the input to the policy-first decision on map #1892.
//
// Deterministic: fixed seeds from each entry, `iterations` budgets only.

import { writeFileSync } from "node:fs";
import {
    BLADE_SCENARIOS,
    runBladeScenario,
    type BladePick,
    type BladeResult,
    type BladeScenario,
} from "../convex/gre/ai/blade";

type Args = {
    tier: "must" | "stretch" | "all";
    withSearch: boolean;
    out: string | null;
    label: string | null;
};

function parseArgs(argv: string[]): Args {
    const args: Args = {
        tier: "all",
        withSearch: false,
        out: null,
        label: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--with-search") args.withSearch = true;
        else if (a === "--tier") {
            const v = argv[++i];
            if (v !== "must" && v !== "stretch" && v !== "all")
                throw new Error(`--tier must be must|stretch|all (got ${v})`);
            args.tier = v;
        } else if (a === "--out") args.out = argv[++i] ?? null;
        else if (a === "--label") args.label = argv[++i] ?? null;
        else throw new Error(`unknown argument ${a}`);
    }
    return args;
}

/** The move kind an entry is about — its first positive matcher's kind, or
 *  `forbidden:<kind>` / `predicate` for the other two expectation shapes. */
export function expectedKind(s: BladeScenario): string {
    if (s.expect.moves) return s.expect.moves[0]?.kind ?? "?";
    if (s.expect.forbidden)
        return `forbidden:${s.expect.forbidden[0]?.kind ?? "?"}`;
    return "predicate";
}

type EntryRow = {
    label: string;
    tier: string;
    kind: string;
    iterations: number;
    greedy: { ok: boolean; seedsOk: number; seeds: number; picks: string[] };
    search?: { ok: boolean; seedsOk: number; seeds: number; picks: string[] };
};

function leg(s: BladeScenario, pick: BladePick): EntryRow["greedy"] {
    const r: BladeResult = runBladeScenario(s, null, pick);
    return {
        ok: r.ok,
        seedsOk: r.seeds.filter((x) => x.ok).length,
        seeds: r.seeds.length,
        picks: r.seeds.map((x) => x.moveDescription),
    };
}

type Agg = {
    entries: number;
    entriesOk: number;
    seeds: number;
    seedsOk: number;
};
function agg(): Agg {
    return { entries: 0, entriesOk: 0, seeds: 0, seedsOk: 0 };
}
function add(a: Agg, l: EntryRow["greedy"]): void {
    a.entries++;
    if (l.ok) a.entriesOk++;
    a.seeds += l.seeds;
    a.seedsOk += l.seedsOk;
}
function pct(n: number, d: number): string {
    return d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;
}
function fmt(a: Agg): string {
    return `${a.entriesOk}/${a.entries} entries (${pct(a.entriesOk, a.entries)}), ${a.seedsOk}/${a.seeds} seeds (${pct(a.seedsOk, a.seeds)})`;
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const scenarios = BLADE_SCENARIOS.filter(
        (s) =>
            (args.tier === "all" || s.tier === args.tier) &&
            (args.label === null || s.label.includes(args.label))
    );
    const rows: EntryRow[] = [];
    const t0 = performance.now();
    for (const s of scenarios) {
        const row: EntryRow = {
            label: s.label,
            tier: s.tier,
            kind: expectedKind(s),
            iterations: s.budget.iterations,
            greedy: leg(s, "greedy"),
        };
        if (args.withSearch) row.search = leg(s, "search");
        rows.push(row);
        const g = row.greedy.ok ? "ok  " : "FAIL";
        const sr = row.search
            ? ` | search ${row.search.ok ? "ok  " : "FAIL"} ${row.search.seedsOk}/${row.search.seeds}`
            : "";
        console.log(
            `[${s.tier.padEnd(7)}] greedy ${g} ${row.greedy.seedsOk}/${row.greedy.seeds}${sr}  ${s.label}`
        );
        if (!row.greedy.ok) {
            console.log(
                `           greedy picked: ${[...new Set(row.greedy.picks)].join(" | ")}`
            );
        }
    }
    const elapsedMs = performance.now() - t0;

    const byTier: Record<string, { greedy: Agg; search: Agg }> = {};
    const byKind: Record<string, { greedy: Agg; search: Agg }> = {};
    const bucket = (
        t: Record<string, { greedy: Agg; search: Agg }>,
        k: string
    ) => (t[k] ??= { greedy: agg(), search: agg() });
    let both = 0,
        greedyOnly = 0,
        searchOnly = 0,
        neither = 0;
    for (const r of rows) {
        add(bucket(byTier, r.tier).greedy, r.greedy);
        add(bucket(byKind, r.kind).greedy, r.greedy);
        if (r.search) {
            add(bucket(byTier, r.tier).search, r.search);
            add(bucket(byKind, r.kind).search, r.search);
            if (r.greedy.ok && r.search.ok) both++;
            else if (r.greedy.ok) greedyOnly++;
            else if (r.search.ok) searchOnly++;
            else neither++;
        }
    }

    console.log(
        `\n== greedy 1-ply pick vs blade registry (issue #3393) — ${rows.length} entries, ${(elapsedMs / 1000).toFixed(1)}s`
    );
    for (const [tier, a] of Object.entries(byTier)) {
        console.log(`  ${tier.padEnd(8)} greedy: ${fmt(a.greedy)}`);
        if (args.withSearch)
            console.log(`  ${"".padEnd(8)} search: ${fmt(a.search)}`);
    }
    console.log(
        `\n== by expected move kind (greedy${args.withSearch ? " / search" : ""})`
    );
    for (const [kind, a] of Object.entries(byKind).sort(
        (x, y) => y[1].greedy.entries - x[1].greedy.entries
    )) {
        console.log(
            `  ${kind.padEnd(28)} ${fmt(a.greedy)}${args.withSearch ? `  ||  ${fmt(a.search)}` : ""}`
        );
    }
    if (args.withSearch) {
        console.log(
            `\n== entry agreement: both ok ${both}, greedy-only ${greedyOnly}, search-only ${searchOnly}, neither ${neither}`
        );
        for (const r of rows) {
            if (r.search && r.greedy.ok !== r.search.ok)
                console.log(
                    `  ${r.greedy.ok ? "greedy-only" : "search-only"}  [${r.tier}] ${r.label}`
                );
        }
    }
    if (args.out) {
        writeFileSync(
            args.out,
            JSON.stringify(
                {
                    meta: { ...args, elapsedMs, entries: rows.length },
                    byTier,
                    byKind,
                    rows,
                },
                null,
                2
            )
        );
        console.log(`\nwrote ${args.out}`);
    }
}

main();
