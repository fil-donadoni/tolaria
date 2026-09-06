#!/usr/bin/env bun
/**
 * `bun run check:bundle` — real `vite build`, THEN a size budget on the two
 * client chunks the card catalogue used to be imported into.
 *
 * HISTORY, because the budgets only make sense with it. Round-1 review of
 * issue #2702 measured an undisclosed, unguarded client cost: `src/main.tsx`
 * eagerly imports `@convex/cards/catalogue`, which imported
 * `data/oracle-compiled-pool.json` at module load — paid on every cold load,
 * in BOTH the main app bundle (`card-catalogue` chunk, `vite.config.ts`'s
 * `manualChunks`) and the separate Web Worker bundle (`brain.worker`,
 * `src/lib/ai/brain-client.ts`), since a Worker gets its own module graph.
 * Measured at #2702 round 2's landing (gzip): card-catalogue 533,558 B,
 * brain.worker 682,833 B — +97 KB gzip each over the pre-#2702 baseline,
 * identical deltas because it was the SAME JSON duplicated into both graphs.
 *
 * Issue #3053 removed the import (ADR 0113 §2/§3). The client FETCHES the
 * merged, content-addressed artifact at the loading gate instead, so both
 * chunks are back to carrying code only. Re-measured immediately after that
 * change, on the same `vite build` this script runs (gzip, `zlib.gzipSync`
 * defaults): **card-catalogue 440,553 B, brain.worker 610,101 B** — the pool
 * gone from both, each chunk within a few KB of its pre-#2702 baseline plus
 * the app/bot code that has landed since.
 *
 * SO THESE BUDGETS NOW GUARD RE-ENTRY, not growth. ~10% headroom over the
 * measured post-#3053 numbers, which is deliberately tighter than the
 * ~15-20% the eager-import era carried: re-adding the pool to either graph is
 * +99 KB gzip and therefore a red on both rows, which is exactly the accident
 * worth catching — an innocent-looking `import` of a `convex/` module that
 * pulls `./compiledPool` back in past the Vite alias
 * (`scripts/__tests__/compiled-pool-client-seam.test.ts` guards the alias's
 * premise; this guards its EFFECT, in the bundler that ships).
 *
 * The SERVED artifact has its own budget —
 * `scripts/__tests__/catalogue-artifact-size.test.ts` — and the server bundle
 * a third (`bun run check:convex-bundle`, ADR 0113 § Amendment). Three
 * numbers, three different costs; none of them is a proxy for another any
 * more.
 *
 * `check:bundle` used to be a bare `vite build` with no assertion — nothing
 * caught the #2702 cost. This script keeps the exact same build (still fails
 * loudly on a build error, still the resolver-purity guard #2530 needs — see
 * `scripts/__tests__/client-bundle-lane.test.ts`) and adds the budget.
 */
import { execSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const DIST_ASSETS = join(ROOT, "dist", "assets");

interface Budget {
    /** Chunk filename prefix (hash suffix varies per build). */
    prefix: string;
    /** gzip bytes. ~10% headroom over the post-#3053 measurement in this
     *  file's header — past this, either the chunk's own code has grown a
     *  lot, or card data has come back into a client graph. */
    gzipBudgetBytes: number;
}

const BUDGETS: Budget[] = [
    // measured 440,553 B (issue #3053)
    { prefix: "card-catalogue-", gzipBudgetBytes: 490_000 },
    // measured 610,101 B (issue #3053)
    { prefix: "brain.worker-", gzipBudgetBytes: 675_000 },
];

function findChunk(prefix: string): string | null {
    const files = readdirSync(DIST_ASSETS).filter(
        (f) => f.startsWith(prefix) && f.endsWith(".js")
    );
    if (files.length === 0) return null;
    // Deterministic: if a rename ever produces more than one match, the
    // largest is the one worth budgeting — never silently pick the first.
    files.sort(
        (a, b) =>
            statSync(join(DIST_ASSETS, b)).size -
            statSync(join(DIST_ASSETS, a)).size
    );
    return files[0]!;
}

function main(): void {
    execSync("bunx vite build --logLevel warn", {
        cwd: ROOT,
        stdio: "inherit",
    });

    const failures: string[] = [];
    for (const budget of BUDGETS) {
        const file = findChunk(budget.prefix);
        if (file === null) {
            failures.push(
                `${budget.prefix}*.js — no chunk found in dist/assets/. ` +
                    `Either the build changed how this entry is chunked (update ` +
                    `the prefix in scripts/check-bundle-size.ts), or the entry ` +
                    `that produces it was removed (drop the budget row).`
            );
            continue;
        }
        const raw = readFileSync(join(DIST_ASSETS, file));
        const gzipBytes = gzipSync(raw).length;
        const status = gzipBytes <= budget.gzipBudgetBytes ? "OK" : "OVER";
        console.log(
            `[check:bundle] ${file}: ${(gzipBytes / 1024).toFixed(1)} KB gzip ` +
                `(budget ${(budget.gzipBudgetBytes / 1024).toFixed(0)} KB) — ${status}`
        );
        if (gzipBytes > budget.gzipBudgetBytes) {
            failures.push(
                `${file}: ${gzipBytes} B gzip > budget ${budget.gzipBudgetBytes} B. ` +
                    `See this file's header for what lands in this chunk and why.`
            );
        }
    }

    if (failures.length > 0) {
        console.error("\n[check:bundle] size budget exceeded:\n");
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
    }
}

main();
