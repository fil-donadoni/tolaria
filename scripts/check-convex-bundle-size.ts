#!/usr/bin/env bun
/**
 * `bun run check:convex-bundle` — size budget on the CONVEX function bundle,
 * the server-side half of ADR 0113 § 2 (issue #3051).
 *
 * `scripts/check-bundle-size.ts` guards the CLIENT chunks the compiled pool
 * lands in. Nothing guarded the server side, because ADR 0113 § 2 asserted
 * bundling there was free — "zero reads, zero bandwidth, zero billing" — and
 * recorded that the one bound on that claim, the Convex function bundle
 * limit, "is unverified and must be measured before the corpus grows into
 * it".
 *
 * It is now measured, and it is NOT far away. Convex's ceiling is
 * **32 MiB of code size, per deployment**:
 *
 *   "The total size of your bundled function code in your `convex/` folder is
 *    limited to 32MiB (~33.55MB)."
 *   — https://docs.convex.dev/functions/bundling#code-size-limits
 *      (mirrored in https://docs.convex.dev/production/state/limits:
 *      "Code size | 32 MiB | ... | Per deployment.")
 *
 * At issue #3051's measurement (2026-09-05) this repo pushed 28,926,718 B —
 * **86.2% of the ceiling**, with 4,627,714 B to spare. So the budget below is
 * not theatre: the next few hundred compiled cards spend it.
 *
 * The receipt prints the per-row headroom because that is the number ADR 0113
 * actually turns on. Marginal cost of one compiled-pool row, measured by
 * re-bundling at +2,000 and +6,000 synthetic rows: **2,086 B/row** (1,258
 * source + 828 source map), linear to three digits. Six times the 347 B/row
 * of the raw definition, because the pool is inlined TWICE — once into the
 * shared isolate chunk, once into the `"use node"` module that imports it,
 * whose graph is separate — and because source maps count.
 *
 * Crossing the budget is the signal to stop bundling the pool server-side, not
 * to raise the number. See ADR 0113 § Amendment.
 */
import { join, dirname } from "node:path";
import {
    CONVEX_BUNDLE_BUDGET_BYTES,
    CONVEX_CODE_SIZE_LIMIT_BYTES,
    CONVEX_MAX_USER_MODULES,
    CONVEX_USER_MODULE_BUDGET,
    MEASURED_BYTES_PER_POOL_ROW,
    compiledPoolRows,
    measureConvexBundle,
} from "./lib/convex-bundle-size";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

function fmt(n: number): string {
    return n.toLocaleString("en-US");
}

function mib(n: number): string {
    return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

async function main(): Promise<void> {
    const m = await measureConvexBundle(join(ROOT, "convex"));
    const rows = compiledPoolRows(ROOT);
    const toLimit = CONVEX_CODE_SIZE_LIMIT_BYTES - m.totalBytes;
    const toBudget = CONVEX_BUNDLE_BUDGET_BYTES - m.totalBytes;

    console.log(
        `[check:convex-bundle] source ${fmt(m.sourceBytes)} B + source maps ` +
            `${fmt(m.sourceMapBytes)} B = ${fmt(m.totalBytes)} B (${mib(m.totalBytes)})`
    );
    console.log(
        `[check:convex-bundle] budget ${fmt(CONVEX_BUNDLE_BUDGET_BYTES)} B ` +
            `(${mib(CONVEX_BUNDLE_BUDGET_BYTES)}) — Convex ceiling ` +
            `${fmt(CONVEX_CODE_SIZE_LIMIT_BYTES)} B (${mib(CONVEX_CODE_SIZE_LIMIT_BYTES)}), ` +
            `${(100 * (m.totalBytes / CONVEX_CODE_SIZE_LIMIT_BYTES)).toFixed(1)}% used`
    );
    console.log(
        `[check:convex-bundle] headroom ${fmt(toLimit)} B to the ceiling, ` +
            `${fmt(toBudget)} B to the budget — at the measured ` +
            `${fmt(MEASURED_BYTES_PER_POOL_ROW)} B per compiled-pool row, ` +
            `${fmt(Math.floor(toLimit / MEASURED_BYTES_PER_POOL_ROW))} rows and ` +
            `${fmt(Math.floor(toBudget / MEASURED_BYTES_PER_POOL_ROW))} rows ` +
            `(pool is ${fmt(rows)} rows today)`
    );
    console.log(
        `[check:convex-bundle] user modules ${fmt(m.userModules)} ` +
            `(budget ${fmt(CONVEX_USER_MODULE_BUDGET)}, Convex MAX_USER_MODULES ` +
            `${fmt(CONVEX_MAX_USER_MODULES)}), emitted modules ${fmt(m.emittedModules)}`
    );

    const failures: string[] = [];
    if (m.totalBytes > CONVEX_BUNDLE_BUDGET_BYTES) {
        failures.push(
            `Convex function bundle is ${fmt(m.totalBytes)} B > budget ` +
                `${fmt(CONVEX_BUNDLE_BUDGET_BYTES)} B, against a hard Convex ceiling of ` +
                `${fmt(CONVEX_CODE_SIZE_LIMIT_BYTES)} B. Do NOT raise the number: ` +
                `ADR 0113 § Amendment names this as the signal to stop bundling the ` +
                `compiled pool into the Convex module graph.`
        );
    }
    if (m.userModules > CONVEX_USER_MODULE_BUDGET) {
        failures.push(
            `${fmt(m.userModules)} files under convex/ become user modules > budget ` +
                `${fmt(CONVEX_USER_MODULE_BUDGET)}, against Convex's MAX_USER_MODULES ` +
                `${fmt(CONVEX_MAX_USER_MODULES)} ("Too many function files ... in \\"convex/\\"").`
        );
    }

    if (failures.length > 0) {
        console.error("\n[check:convex-bundle] budget exceeded:\n");
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
    }
}

// Guarded: this file is a CLI, and a stray import of it must not run the
// gate (and its `process.exit`) as a side effect.
if (import.meta.main) await main();
