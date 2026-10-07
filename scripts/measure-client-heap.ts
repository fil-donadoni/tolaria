#!/usr/bin/env bun
/**
 * `bun run measure:client-heap` — the heap of the CLIENT catalogue for one game
 * load, in the page and in the Bot worker separately, today and at the target
 * scale (35k cards), as a report (issue #4861, PRD #4849). `WARN` lines, never
 * a failure: a MEASUREMENT for iterating. The budget is ARMED by
 * `check:convex-heap` on `health` (issue #4862), which runs this same
 * measurement and fails. Measured cost: ~3 s (2026-10-06, load ~4).
 *
 * The DECK BUILDER's search index is reported beside them (issue #5125): no
 * game loads it, but it is resident for as long as the deck builder is open,
 * so it is its own figure, under no budget: `check:convex-heap` arms the
 * per-game budget only (issue #4862).
 *
 * Method and caveats: `scripts/lib/client-heap.ts`. `--rows <n>` measures one
 * corpus size instead of the two.
 */
import { dirname, join } from "node:path";
import {
    CLIENT_CATALOGUE_BUDGET_BYTES,
    TARGET_CORPUS_ROWS,
    clientHeapFailures,
    committedRows,
    committedSearchIndexWire,
    measureClientHeap,
    measureSearchIndexHeap,
} from "./lib/client-heap";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const MIB = 1024 * 1024;

const mib = (n: number): string => (n / MIB).toFixed(1).padStart(7);

async function main(): Promise<void> {
    const rowsAt = process.argv.indexOf("--rows");
    const sizes =
        rowsAt >= 0
            ? [Number(process.argv[rowsAt + 1])]
            : [committedRows(ROOT).length, TARGET_CORPUS_ROWS];
    console.log(
        "[measure:client-heap]  context     rows  import MiB  catalogue MiB  budget MiB  blocks"
    );
    const report = [];
    for (const rows of sizes) {
        for (const h of await measureClientHeap(ROOT, rows)) {
            report.push(h);
            console.log(
                `[measure:client-heap]  ${h.context.padEnd(7)} ${String(h.rows).padStart(8)}  ` +
                    `${mib(h.importBytes)}     ${mib(h.catalogueBytes)}     ` +
                    `${mib(CLIENT_CATALOGUE_BUDGET_BYTES)}   ${String(h.inflations).padStart(5)}`
            );
        }
    }
    const indexSizes =
        rowsAt >= 0
            ? sizes
            : [committedSearchIndexWire(ROOT).length, TARGET_CORPUS_ROWS];
    console.log(
        "[measure:client-heap]  context       rows  import MiB  search index MiB"
    );
    for (const rows of indexSizes) {
        const h = await measureSearchIndexHeap(ROOT, rows);
        console.log(
            `[measure:client-heap]  deck-builder ${String(h.rows).padStart(6)}  ` +
                `${mib(h.importBytes)}     ${mib(h.indexBytes)}`
        );
    }
    const warnings = clientHeapFailures(report);
    for (const w of warnings) console.log(`[measure:client-heap] WARN ${w}`);
    console.log(
        `[measure:client-heap] ${warnings.length === 0 ? "within budget" : `${warnings.length} over budget`} ` +
            "(report only — armed by check:convex-heap on health)"
    );
}

await main();
