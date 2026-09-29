#!/usr/bin/env bun
/**
 * `bun run check:convex-bundle` — size receipt on the CONVEX function bundle,
 * the server-side half of ADR 0113 § 2 (issue #3051): a WARNING at 30 MiB, a
 * FAILURE only near a ceiling Convex enforces (ADR 0113 Amendment III, issue
 * #4810).
 *
 * `scripts/check-bundle-size.ts` guards the CLIENT chunks the compiled pool
 * lands in. Nothing guarded the server side, because ADR 0113 § 2 asserted
 * bundling there was free — "zero reads, zero bandwidth, zero billing" — and
 * recorded that the one bound on that claim, the Convex function bundle
 * limit, "is unverified and must be measured before the corpus grows into
 * it".
 *
 * Convex DOCUMENTS **32 MiB of code size, per deployment**:
 *
 *   "The total size of your bundled function code in your `convex/` folder is
 *    limited to 32MiB (~33.55MB)."
 *   — https://docs.convex.dev/functions/bundling#code-size-limits
 *      (mirrored in https://docs.convex.dev/production/state/limits:
 *      "Code size | 32 MiB | ... | Per deployment.")
 *
 * At issue #3051's measurement (2026-09-05) this repo pushed 28,926,718 B —
 * 86.2% of that number. ADR 0113 Amendment III (2026-09-20) then tested it on
 * cloud: 36/40/60 MiB pushes were accepted, and the one refusal came from the
 * backend's `PackageSize::verify_size` — `MAX_ZIPPED_PACKAGES_SIZE`
 * 90,000,000 B / `MAX_UNZIPPED_PACKAGES_SIZE` 230,000,000 B. So the 32 MiB is
 * a documented contract Convex may start enforcing, and 30 MiB is the WARNING
 * distance to it (printed here, and in every `health` log through
 * `check:all`); the exit code turns on the hard bounds, 75% of each enforced
 * ceiling. The verdict itself is `assessConvexBundle` in the lib, shared with
 * the lane test.
 *
 * The receipt prints the per-row headroom because that is the number ADR 0113
 * actually turns on. Marginal cost of one compiled-pool row, re-measured at
 * issue #4811 by re-bundling at +2,000 and +6,000 synthetic rows:
 * **1,385 B/row**, linear to four digits (1,013 at issue #3444; the rows grew,
 * see `MEASURED_BYTES_PER_POOL_ROW`). It was
 * 2,086 while the pool was inlined TWICE — once into the shared isolate chunk,
 * once into the `"use node"` graph esbuild bundles separately; #3444 cut the
 * second copy and the doubling with it.
 *
 * A WARN line is the signal to ask what is IN the bundle, not to move the
 * number (ADR 0113 Amendments II and III).
 */
import { join, dirname } from "node:path";
import {
    CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES,
    CONVEX_BUNDLE_HARD_BOUND_ZIPPED_BYTES,
    CONVEX_BUNDLE_WARNING_BYTES,
    CONVEX_CODE_SIZE_LIMIT_BYTES,
    CONVEX_MAX_UNZIPPED_PACKAGES_SIZE,
    CONVEX_MAX_USER_MODULES,
    CONVEX_MAX_ZIPPED_PACKAGES_SIZE,
    CONVEX_USER_MODULE_BUDGET,
    MEASURED_BYTES_PER_POOL_ROW,
    assessConvexBundle,
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
    const toDocumented = CONVEX_CODE_SIZE_LIMIT_BYTES - m.totalBytes;
    const toHard = CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES - m.totalBytes;

    console.log(
        `[check:convex-bundle] source ${fmt(m.sourceBytes)} B + source maps ` +
            `${fmt(m.sourceMapBytes)} B = ${fmt(m.totalBytes)} B (${mib(m.totalBytes)}), ` +
            `~${fmt(m.zippedBytes)} B zipped`
    );
    console.log(
        `[check:convex-bundle] warning ${fmt(CONVEX_BUNDLE_WARNING_BYTES)} B ` +
            `(${mib(CONVEX_BUNDLE_WARNING_BYTES)}) — Convex documented ` +
            `${fmt(CONVEX_CODE_SIZE_LIMIT_BYTES)} B (${mib(CONVEX_CODE_SIZE_LIMIT_BYTES)}), ` +
            `${(100 * (m.totalBytes / CONVEX_CODE_SIZE_LIMIT_BYTES)).toFixed(1)}% used, not enforced`
    );
    console.log(
        `[check:convex-bundle] hard bound ${fmt(CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES)} B ` +
            `unzipped / ${fmt(CONVEX_BUNDLE_HARD_BOUND_ZIPPED_BYTES)} B zipped — Convex ` +
            `enforced MAX_UNZIPPED_PACKAGES_SIZE ${fmt(CONVEX_MAX_UNZIPPED_PACKAGES_SIZE)} B / ` +
            `MAX_ZIPPED_PACKAGES_SIZE ${fmt(CONVEX_MAX_ZIPPED_PACKAGES_SIZE)} B`
    );
    console.log(
        `[check:convex-bundle] headroom ${fmt(toDocumented)} B to the documented 32 MiB, ` +
            `${fmt(toHard)} B to the hard bound — at the measured ` +
            `${fmt(MEASURED_BYTES_PER_POOL_ROW)} B per compiled-pool row, ` +
            `${fmt(Math.floor(toDocumented / MEASURED_BYTES_PER_POOL_ROW))} rows and ` +
            `${fmt(Math.floor(toHard / MEASURED_BYTES_PER_POOL_ROW))} rows ` +
            `(pool is ${fmt(rows)} rows today)`
    );
    console.log(
        `[check:convex-bundle] user modules ${fmt(m.userModules)} ` +
            `(budget ${fmt(CONVEX_USER_MODULE_BUDGET)}, Convex MAX_USER_MODULES ` +
            `${fmt(CONVEX_MAX_USER_MODULES)}), emitted modules ${fmt(m.emittedModules)}`
    );

    const { warnings, failures } = assessConvexBundle(m);
    for (const w of warnings) console.log(`[check:convex-bundle] WARN ${w}`);

    if (failures.length > 0) {
        console.error("\n[check:convex-bundle] hard bound exceeded:\n");
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
    }
}

// Guarded: this file is a CLI, and a stray import of it must not run the
// gate (and its `process.exit`) as a side effect.
if (import.meta.main) await main();
