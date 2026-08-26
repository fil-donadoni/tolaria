#!/usr/bin/env bun
/**
 * `bun run check:bundle` — real `vite build`, THEN a size budget on the two
 * chunks the compiled-card pool JSON import (issue #2702) lands in.
 *
 * Round-1 review of #2702 measured an undisclosed, unguarded client cost:
 * `src/main.tsx` eagerly imports `@convex/cards/catalogue`, which (via
 * `convex/cards/compiledCatalogue.ts`) imports `data/oracle-compiled-pool.json`
 * at module load — paid on every cold load, in BOTH the main app bundle
 * (`card-catalogue` chunk, `vite.config.ts`'s `manualChunks`) and the
 * separate Web Worker bundle (`brain.worker`, `src/lib/ai/brain-client.ts`),
 * since a Worker gets its own module graph. Measured at #2702 round 2's
 * landing (gzip): card-catalogue 533,558 B, brain.worker 682,833 B — +97 KB
 * gzip each over the pre-#2702 baseline, identical deltas because it is the
 * SAME JSON duplicated into both graphs.
 *
 * `check:bundle` used to be a bare `vite build` with no assertion — nothing
 * caught this. This script keeps the exact same build (still fails loudly on
 * a build error, still the resolver-purity guard #2530 needs — see
 * `scripts/__tests__/client-bundle-lane.test.ts`) and adds a budget on the
 * two chunks this artifact can grow, so the NEXT undisclosed cost is a red,
 * not silence.
 *
 * The eager import itself is a deliberate, disclosed trade-off (PR #2838
 * round 2): the GRE, the client-side Brain and the Draft Lab all call
 * `getDefinition`/`tryGetDefinition` (ADR 0046) SYNCHRONOUSLY, on both server
 * and client — an async/lazy load would leave a real window where a compiled
 * card resolves as unknown mid-game, which is a correctness bug, not just a
 * perf one. Budgeted here instead of redesigned.
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
    /** gzip bytes. ~15-20% headroom over the measured baseline at landing —
     *  past this, the eager import's cost has grown enough to revisit
     *  whether it should stay eager, not just re-raise the number. */
    gzipBudgetBytes: number;
}

const BUDGETS: Budget[] = [
    { prefix: "card-catalogue-", gzipBudgetBytes: 620_000 },
    { prefix: "brain.worker-", gzipBudgetBytes: 790_000 },
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
