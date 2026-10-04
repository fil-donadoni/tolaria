/**
 * Heap of ONE call, per Convex isolate function module (issue #4853, PRD
 * #4849). The binding Convex limit is not the pushed bundle but the 64 MiB of
 * RAM of one function call: module globals do not survive a call (ADR 0113
 * Amendment III), so every call re-materialises everything its module
 * evaluates at load. Method: `docs/research/convex-server-scale-2026-09-29.md`
 * § Method.
 *
 * A module is bundled with the Convex CLI's own esbuild options
 * (`CONVEX_ESBUILD_OPTIONS`), written OUTSIDE the tree, imported in a fresh
 * `node --expose-gc`, and the heap delta around the `import()` is the number;
 * the minimum of several runs, since noise only ever adds. Node is a proxy for
 * the Convex isolate — read the figures as relative, the absolute ones as
 * approximately right.
 *
 * The target-scale figure comes from a SYNTHETIC catalogue substituted by an
 * esbuild `onLoad` plugin: the tree is never edited. Only modules whose graph
 * reaches the catalogue are measured twice — for the rest the substitution
 * cannot apply, so today's figure IS the target-scale one.
 */
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import {
    CONVEX_ESBUILD_OPTIONS,
    USE_NODE_DIRECTIVE,
    discoverEntryPoints,
    nonFunctionEntryPoints,
} from "./convex-bundle-size";

const MIB = 1024 * 1024;

/** The compiled pool's path inside the repo; the one file the synthetic
 *  catalogue replaces. */
const POOL_PATH = "data/oracle-compiled-pool.json";

/** Rows of the compiled pool at the scale target (PRD #4849). */
export const TARGET_POOL_ROWS = 35_000;

/** Heap budgets a module will be held to once armed (a later ticket). */
export const HEAP_BUDGET_CATALOGUE_BYTES = 32 * MIB;
export const HEAP_BUDGET_NO_CATALOGUE_BYTES = 4 * MIB;

/** Runs per measurement; the minimum is reported. */
export const HEAP_RUNS = 3;

export interface ModuleHeap {
    /** `convex/`-relative POSIX path. */
    module: string;
    /** The graph reaches the catalogue: hand-written sets or the compiled pool. */
    readsCatalogue: boolean;
    todayBytes: number;
    /** Equal to `todayBytes` for a module that reads no catalogue. */
    targetBytes: number;
    budgetBytes: number;
}

/** Whether a bundle's input list reaches a Card Definition. */
export function reachesCatalogue(inputs: string[]): boolean {
    return inputs.some(
        (i) => i.endsWith(POOL_PATH) || i.includes("convex/cards/sets/")
    );
}

export function heapBudgetBytes(readsCatalogue: boolean): number {
    return readsCatalogue
        ? HEAP_BUDGET_CATALOGUE_BYTES
        : HEAP_BUDGET_NO_CATALOGUE_BYTES;
}

/** The compiled pool grown to `rows` by cycling the existing rows with `id`
 *  and `name` uniquified (the catalogue indexes both at load). */
export function syntheticPool(base: unknown[], rows: number): string {
    const out: unknown[] = [];
    for (let i = 0; i < rows; i++) {
        const row = base[i % base.length] as Record<string, unknown>;
        out.push(
            i < base.length
                ? row
                : { ...row, id: `${row.id}-s${i}`, name: `${row.name} s${i}` }
        );
    }
    return JSON.stringify(out, null, 4);
}

/** esbuild plugin that serves the compiled pool at `rows` rows, in memory. */
export function syntheticPoolPlugin(
    repoRoot: string,
    rows: number
): esbuild.Plugin {
    const base = JSON.parse(
        readFileSync(join(repoRoot, POOL_PATH), "utf8")
    ) as unknown[];
    const contents = syntheticPool(base, rows);
    return {
        name: "synthetic-pool",
        setup(build) {
            build.onLoad({ filter: /oracle-compiled-pool\.json$/ }, () => ({
                contents,
                loader: "json",
            }));
        },
    };
}

/** Bundles one module with the CLI's options into `outFile`; returns the
 *  metafile's input paths. */
export async function bundleModule(
    entry: string,
    outFile: string,
    plugins: esbuild.Plugin[] = []
): Promise<string[]> {
    const result = await esbuild.build({
        ...CONVEX_ESBUILD_OPTIONS,
        entryPoints: [entry],
        platform: "browser",
        outfile: outFile,
        splitting: false,
        plugins,
        metafile: true,
    });
    return Object.keys(result.metafile?.inputs ?? {});
}

/** V8's heap is the proxy for the isolate's, so the probe runs under Node —
 *  never `process.execPath`, which is bun (JavaScriptCore) when this module
 *  runs from a `bun` script. */
const NODE = "node";

/** The child's program: heap used after `gc()`, before and after the import.
 *  A file, not `node -e`: the `-e` entry point measured 77 MiB where the same
 *  bundle run as a file measured 48 (its REPL-style wrapper holds the heap). */
const PROBE = `
const file = process.argv[2];
gc();
const before = process.memoryUsage().heapUsed;
await import(file);
gc();
console.log(process.memoryUsage().heapUsed - before);
`;

/** Heap delta of importing `file` in a fresh V8, minimum of `runs`. */
export function measureFileHeap(file: string, runs = HEAP_RUNS): number {
    const probe = join(dirname(file), "heap-probe.mjs");
    writeFileSync(probe, PROBE);
    let best = Infinity;
    for (let i = 0; i < runs; i++) {
        const r = spawnSync(NODE, ["--expose-gc", probe, file], {
            encoding: "utf8",
            timeout: 120_000,
        });
        const n = Number(r.stdout.trim());
        if (r.status !== 0 || !Number.isFinite(n)) {
            throw new Error(
                `heap probe failed on ${file} (status ${r.status}): ${r.stderr.slice(0, 400)}`
            );
        }
        best = Math.min(best, n);
    }
    return best;
}

/** Isolate function modules: entry points without a `"use node"` directive and
 *  outside the card-set / test directories. `convex/`-relative POSIX paths. */
export function isolateModules(convexDir: string): string[] {
    const skipped = new Set(nonFunctionEntryPoints(convexDir));
    return discoverEntryPoints(convexDir)
        .filter((f) => !USE_NODE_DIRECTIVE.test(readFileSync(f, "utf8")))
        .map((f) => relative(convexDir, f).split(sep).join("/"))
        .filter((rel) => !skipped.has(rel));
}

export interface MeasureOptions {
    /** Keep only modules whose path contains this substring. */
    only?: string;
    runs?: number;
    targetRows?: number;
    onProgress?: (done: number, total: number, module: string) => void;
}

/** The per-module report, today and at target scale. */
export async function measureConvexHeap(
    repoRoot: string,
    opts: MeasureOptions = {}
): Promise<ModuleHeap[]> {
    const convexDir = join(repoRoot, "convex");
    const modules = isolateModules(convexDir).filter(
        (m) => !opts.only || m.includes(opts.only)
    );
    const plugin = syntheticPoolPlugin(
        repoRoot,
        opts.targetRows ?? TARGET_POOL_ROWS
    );
    const dir = mkdtempSync(join(tmpdir(), "convex-heap-"));
    try {
        const report: ModuleHeap[] = [];
        for (const [i, module] of modules.entries()) {
            const entry = join(convexDir, module);
            const today = join(dir, "today.mjs");
            const inputs = await bundleModule(entry, today);
            const readsCatalogue = reachesCatalogue(inputs);
            const todayBytes = measureFileHeap(today, opts.runs);
            let targetBytes = todayBytes;
            if (readsCatalogue) {
                const target = join(dir, "target.mjs");
                await bundleModule(entry, target, [plugin]);
                targetBytes = measureFileHeap(target, opts.runs);
            }
            report.push({
                module,
                readsCatalogue,
                todayBytes,
                targetBytes,
                budgetBytes: heapBudgetBytes(readsCatalogue),
            });
            opts.onProgress?.(i + 1, modules.length, module);
        }
        return report;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** One `WARN` line per module whose target-scale heap is over its budget. */
export function heapWarnings(report: ModuleHeap[]): string[] {
    return report
        .filter((m) => m.targetBytes > m.budgetBytes)
        .map(
            (m) =>
                `${m.module}: ${(m.targetBytes / MIB).toFixed(1)} MiB at target scale > ` +
                `${(m.budgetBytes / MIB).toFixed(0)} MiB budget ` +
                `(${m.readsCatalogue ? "reads the catalogue" : "reads no Card Definition"}, ` +
                `${(m.todayBytes / MIB).toFixed(1)} MiB today)`
        );
}
