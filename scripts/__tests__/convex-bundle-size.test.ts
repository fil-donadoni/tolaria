import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    CONVEX_BUNDLE_BOUNDS,
    CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES,
    CONVEX_BUNDLE_HARD_BOUND_ZIPPED_BYTES,
    CONVEX_BUNDLE_WARNING_BYTES,
    CONVEX_CODE_SIZE_LIMIT_BYTES,
    CONVEX_MAX_UNZIPPED_PACKAGES_SIZE,
    CONVEX_MAX_USER_MODULES,
    CONVEX_MAX_ZIPPED_PACKAGES_SIZE,
    CONVEX_USER_MODULE_BUDGET,
    assessConvexBundle,
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
 * Measured (issue #3051, 2026-09-05): Convex documents 32 MiB of code size per
 * deployment, source maps included, and this repo sat at 86% of it. ADR 0113
 * Amendment III (2026-09-20) found that number NOT enforced — the backend's
 * `PackageSize::verify_size` refuses at 90 MB zipped / 230 MB unzipped — so
 * 30 MiB is a WARNING here and the failure is a hard bound at 75% of the
 * enforced ceilings (issue #4810).
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
    it(`stays under the hard bound — ${CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES} B unzipped, ${CONVEX_BUNDLE_HARD_BOUND_ZIPPED_BYTES} B zipped (75% of Convex's ENFORCED ceilings, ADR 0113 Amendment III); 30 MiB only warns`, async () => {
        const m = await measure();
        console.log(
            `convex function bundle: ${(m.totalBytes / 1024 / 1024).toFixed(2)} MiB ` +
                `(source ${m.sourceBytes} B + source maps ${m.sourceMapBytes} B), ` +
                `~${m.zippedBytes} B zipped; warning ` +
                `${(CONVEX_BUNDLE_WARNING_BYTES / 1024 / 1024).toFixed(0)} MiB, documented ` +
                `${(CONVEX_CODE_SIZE_LIMIT_BYTES / 1024 / 1024).toFixed(0)} MiB, hard bound ` +
                `${CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES} B`
        );
        const { warnings, failures } = assessConvexBundle(m);
        for (const w of warnings) console.warn(`WARN ${w}`);
        expect(failures).toEqual([]);
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

describe("Convex bundle verdict: warning vs hard bound (issue #4810, ADR 0113 Amendment III)", () => {
    const base = { totalBytes: 1_000, zippedBytes: 100, userModules: 10 };

    it("keeps the lines ordered: warning < documented < hard bound < enforced", () => {
        expect(CONVEX_BUNDLE_WARNING_BYTES).toBeLessThan(
            CONVEX_CODE_SIZE_LIMIT_BYTES
        );
        expect(CONVEX_CODE_SIZE_LIMIT_BYTES).toBeLessThan(
            CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES
        );
        expect(CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES).toBeLessThan(
            CONVEX_MAX_UNZIPPED_PACKAGES_SIZE
        );
        expect(CONVEX_BUNDLE_HARD_BOUND_ZIPPED_BYTES).toBeLessThan(
            CONVEX_MAX_ZIPPED_PACKAGES_SIZE
        );
    });

    it("between the 30 MiB warning and the hard bound: a WARN naming total, warning and enforced ceiling — no failure", () => {
        const total = CONVEX_BUNDLE_WARNING_BYTES + 31_000;
        const { warnings, failures } = assessConvexBundle({
            ...base,
            totalBytes: total,
        });
        expect(failures).toEqual([]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(total.toLocaleString("en-US"));
        expect(warnings[0]).toContain(
            CONVEX_BUNDLE_WARNING_BYTES.toLocaleString("en-US")
        );
        expect(warnings[0]).toContain("MAX_UNZIPPED_PACKAGES_SIZE");
    });

    it("under the warning: neither warns nor fails", () => {
        expect(assessConvexBundle(base)).toEqual({
            warnings: [],
            failures: [],
        });
    });

    it("above the unzipped hard bound: fails naming MAX_UNZIPPED_PACKAGES_SIZE", () => {
        const { failures } = assessConvexBundle({
            ...base,
            totalBytes: CONVEX_BUNDLE_HARD_BOUND_UNZIPPED_BYTES + 1,
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain("MAX_UNZIPPED_PACKAGES_SIZE");
    });

    it("above the zipped hard bound: fails naming MAX_ZIPPED_PACKAGES_SIZE", () => {
        const { failures } = assessConvexBundle({
            ...base,
            zippedBytes: CONVEX_BUNDLE_HARD_BOUND_ZIPPED_BYTES + 1,
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain("MAX_ZIPPED_PACKAGES_SIZE");
    });

    it("above the user-module budget: fails naming MAX_USER_MODULES", () => {
        const { failures } = assessConvexBundle({
            ...base,
            userModules: CONVEX_BUNDLE_BOUNDS.userModuleBudget + 1,
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain("MAX_USER_MODULES");
    });
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
