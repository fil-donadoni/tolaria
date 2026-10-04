#!/usr/bin/env bun
/**
 * `bun run check:convex-heap` — the heap of ONE call per Convex isolate
 * function module, today and at the target scale (35k cards), as a report
 * (issue #4853, PRD #4849). `WARN` lines, never a failure: the budgets are
 * armed by a later ticket. Runs in `health` only (`HEALTH_ONLY_GUARDS`), never
 * in `check:pr` or `land`.
 *
 * Method and caveats: `scripts/lib/convex-heap.ts`, and
 * `docs/research/convex-server-scale-2026-09-29.md` § Method. `--only <substr>`
 * restricts the walk to the modules whose path contains it.
 */
import { dirname, join } from "node:path";
import {
    TARGET_POOL_ROWS,
    heapWarnings,
    measureConvexHeap,
} from "./lib/convex-heap";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const MIB = 1024 * 1024;

function mib(n: number): string {
    return (n / MIB).toFixed(1).padStart(7);
}

async function main(): Promise<void> {
    const onlyAt = process.argv.indexOf("--only");
    const only = onlyAt >= 0 ? process.argv[onlyAt + 1] : undefined;
    const report = await measureConvexHeap(ROOT, { only });

    // Heaviest first; the isolate modules that read no catalogue are 4 MiB
    // budgets and would bury the ones that matter, so list those only when
    // they are over budget.
    const rows = [...report]
        .filter((m) => m.readsCatalogue || m.targetBytes > m.budgetBytes)
        .sort((a, b) => b.targetBytes - a.targetBytes);
    console.log(
        `[check:convex-heap] ${report.length} isolate modules, ` +
            `${report.filter((m) => m.readsCatalogue).length} reach the catalogue; ` +
            `target = compiled pool at ${TARGET_POOL_ROWS.toLocaleString("en-US")} rows ` +
            `(printings are not synthesised)`
    );
    console.log(
        "[check:convex-heap]   today MiB  target MiB  budget MiB  module"
    );
    for (const m of rows) {
        console.log(
            `[check:convex-heap] ${mib(m.todayBytes)}   ${mib(m.targetBytes)}   ` +
                `${mib(m.budgetBytes)}   ${m.module}` +
                `${m.readsCatalogue ? "" : "  (no Card Definition)"}`
        );
    }
    const warnings = heapWarnings(report);
    for (const w of warnings) console.log(`[check:convex-heap] WARN ${w}`);
    console.log(
        `[check:convex-heap] ${warnings.length} module(s) over budget — report only, exit 0`
    );
}

if (import.meta.main) await main();
