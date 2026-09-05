import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    CONVEX_BUNDLE_BUDGET_BYTES,
    CONVEX_CODE_SIZE_LIMIT_BYTES,
    CONVEX_MAX_USER_MODULES,
    CONVEX_USER_MODULE_BUDGET,
    measureConvexBundle,
} from "../lib/convex-bundle-size";

/**
 * Gate guard for the Convex function bundle — the server-side ceiling ADR
 * 0113 § 2 rested on without measuring (issue #3051).
 *
 * ADR 0113 § 2 decided that compiled card definitions stay in the Convex
 * module graph because that costs "zero reads, zero bandwidth, zero billing",
 * and recorded in the same breath that the bound on the decision — "the
 * Convex function bundle limit" — "is unverified and must be measured before
 * the corpus grows into it".
 *
 * Measured (issue #3051, 2026-09-05): the ceiling is 32 MiB of code size per
 * deployment, source maps included, and this repo already sits at 86% of it.
 * The mirror of `scripts/__tests__/oracle-pool-size.test.ts` for the server
 * side, and it lives in the `node` project so every lane runs it: the engine
 * lane through `node[all]`, the skin lane through `node[src,scripts]`,
 * `check:pr` through `check:guards`.
 *
 * It measures by re-running the CLI's own esbuild invocation rather than by
 * reading a committed number, for the same reason `full-catalogue-size.test.ts`
 * records: a guard that measures a synthetic stand-in can never fail on the
 * real artifact's growth.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");

// The budgets live in the lib, NOT in `scripts/check-convex-bundle-size.ts`:
// that script is a CLI with a top-level `await main()`, so importing a
// constant from it would RUN it — and its `process.exit(1)` would kill the
// suite at collection instead of failing an assertion. Observed, not feared
// (issue #3051 proof-of-failure round 1).

/** One esbuild pass for the whole file — it costs ~1s, the assertions are cheap. */
let measured: ReturnType<typeof measureConvexBundle> | undefined;
const measure = () =>
    (measured ??= measureConvexBundle(resolve(REPO_ROOT, "convex")));

describe("Convex function bundle size budget (issue #3051, ADR 0113 § 2)", () => {
    it(`is at most ${(CONVEX_BUNDLE_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MiB — past this, stop bundling the compiled pool server-side, don't raise the number`, async () => {
        const m = await measure();
        console.log(
            `convex function bundle: ${(m.totalBytes / 1024 / 1024).toFixed(2)} MiB ` +
                `(source ${m.sourceBytes} B + source maps ${m.sourceMapBytes} B), ` +
                `budget ${(CONVEX_BUNDLE_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MiB, ` +
                `Convex ceiling ${(CONVEX_CODE_SIZE_LIMIT_BYTES / 1024 / 1024).toFixed(0)} MiB`
        );
        expect(m.totalBytes).toBeLessThanOrEqual(CONVEX_BUNDLE_BUDGET_BYTES);
        // The budget is worthless if it ever creeps past what Convex accepts.
        expect(CONVEX_BUNDLE_BUDGET_BYTES).toBeLessThan(
            CONVEX_CODE_SIZE_LIMIT_BYTES
        );
    }, 120_000);

    it(`keeps files under convex/ within ${CONVEX_USER_MODULE_BUDGET} user modules (Convex MAX_USER_MODULES ${CONVEX_MAX_USER_MODULES})`, async () => {
        const m = await measure();
        console.log(
            `convex user modules: ${m.userModules} (budget ${CONVEX_USER_MODULE_BUDGET}, ` +
                `Convex cap ${CONVEX_MAX_USER_MODULES}), emitted ${m.emittedModules}`
        );
        expect(m.userModules).toBeLessThanOrEqual(CONVEX_USER_MODULE_BUDGET);
        expect(CONVEX_USER_MODULE_BUDGET).toBeLessThan(CONVEX_MAX_USER_MODULES);
    }, 120_000);

    it("counts source maps, because the Convex backend does", async () => {
        // `crates/model/src/source_packages/upload_download.rs` adds both
        // `module.source` and `module.source_map` to `unzipped_size_bytes`.
        // A `.js`-only measurement would report ~69% of the real number and
        // would have declared 13.5 MB of headroom where there is 4.6 MB.
        const m = await measure();
        expect(m.sourceMapBytes).toBeGreaterThan(0);
        expect(m.totalBytes).toBe(m.sourceBytes + m.sourceMapBytes);
    }, 120_000);
});

describe("Convex bundle guard wiring (issue #3051)", () => {
    it("is reachable as `bun run check:convex-bundle`", () => {
        const pkg = JSON.parse(
            readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(pkg.scripts["check:convex-bundle"]).toContain(
            "check-convex-bundle-size.ts"
        );
    });
});
