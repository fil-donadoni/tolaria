#!/usr/bin/env bun
/**
 * `bun run check:convex-heap` — the heap of ONE call per Convex isolate
 * function module at the target scale (35k cards), and the client catalogue's
 * heap per context. A FAILURE (exit 1) when a budget is exceeded (issue #4862,
 * PRD #4849; ADR 0113 Amendment IV): one call to `game.ts` ≤ 34 MiB, a module
 * that reads no Card Definition ≤ 4 MiB, the client catalogue ≤ 15 MiB in the
 * main thread and in the Bot worker, each measured separately. Runs in
 * `health` only (`HEALTH_ONLY_GUARDS`), never in `check:pr` or `land`.
 *
 * Server figures are Node V8 heap deltas read as isolate bytes through
 * `NODE_TO_ISOLATE_RATIO` = 0.65 — the highest of the 0.56–0.65 the cloud
 * probe measured (issue #4852). A failure names the module, its heap, the
 * budget and the method that finds the cause.
 *
 * Method and caveats: `scripts/lib/convex-heap.ts`, `scripts/lib/client-heap.ts`
 * and `docs/research/convex-server-scale-2026-09-29.md` § Method.
 * `--only <substr>` restricts the server walk to the modules whose path
 * contains it, and skips the client.
 */
import { dirname, join } from "node:path";
import {
    NODE_TO_ISOLATE_RATIO,
    TARGET_POOL_ROWS,
    heapFailures,
    isolateBytes,
    measureConvexHeap,
} from "./lib/convex-heap";
import {
    TARGET_CORPUS_ROWS,
    clientHeapFailures,
    committedRows,
    measureClientHeap,
    type ClientHeap,
} from "./lib/client-heap";

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
        .filter(
            (m) =>
                m.readsCatalogue || isolateBytes(m.targetBytes) > m.budgetBytes
        )
        .sort((a, b) => b.targetBytes - a.targetBytes);
    console.log(
        `[check:convex-heap] ${report.length} isolate modules, ` +
            `${report.filter((m) => m.readsCatalogue).length} reach the catalogue; ` +
            `target = compiled pool at ${TARGET_POOL_ROWS.toLocaleString("en-US")} rows ` +
            `(printings are not synthesised); ` +
            `isolate MiB = Node x ${NODE_TO_ISOLATE_RATIO}`
    );
    console.log(
        "[check:convex-heap]   today MiB  target MiB  budget MiB  module  (isolate MiB, ratio applied)"
    );
    for (const m of rows) {
        console.log(
            `[check:convex-heap] ${mib(isolateBytes(m.todayBytes))}   ${mib(isolateBytes(m.targetBytes))}   ` +
                `${mib(m.budgetBytes)}   ${m.module}` +
                `${m.readsCatalogue ? "" : "  (no Card Definition)"}`
        );
    }
    for (const m of report.filter((r) => r.error))
        console.log(
            `[check:convex-heap] WARN ${m.module}: not measured — ${m.error?.split("\n")[0]}`
        );
    const failures = heapFailures(report);
    for (const f of failures) console.error(`[check:convex-heap] FAIL ${f}`);

    const clientReport: ClientHeap[] = [];
    if (!only) {
        for (const rows of [committedRows(ROOT).length, TARGET_CORPUS_ROWS])
            clientReport.push(...(await measureClientHeap(ROOT, rows)));
        for (const h of clientReport)
            console.log(
                `[check:convex-heap] client ${h.context.padEnd(7)} ${String(h.rows).padStart(7)} rows  ` +
                    `${mib(h.catalogueBytes)} MiB of catalogue`
            );
    }
    const clientFailures = clientHeapFailures(clientReport);
    for (const f of clientFailures)
        console.error(`[check:convex-heap] FAIL client ${f}`);

    const total = failures.length + clientFailures.length;
    console.log(
        total === 0
            ? "[check:convex-heap] within budget"
            : `[check:convex-heap] ${total} budget failure(s)`
    );
    if (total > 0) process.exit(1);
}

if (import.meta.main) await main();
