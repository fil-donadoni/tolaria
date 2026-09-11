import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
    CONVEX_NODE_BUNDLE_BUDGET_BYTES,
    measureConvexNodeBundle,
} from "../lib/convex-bundle-size";

/**
 * The `"use node"` seam (issue #3444, ADR 0113 § Amendment).
 *
 * Convex bundles Node actions in an esbuild invocation SEPARATE from the
 * isolate modules, so every module a `"use node"` file reaches is emitted a
 * SECOND time into the pushed artifact. `convex/debugScenarioGenerator.ts`
 * imported `./cards` for two name lookups; that pulled the card registry and
 * with it `convex/cards/compiledPool.ts` -> `data/oracle-compiled-pool.json`,
 * and the duplicate cost **7,200,356 B** — 23% of the whole push, and the
 * 117,487 B that put `bun run check:convex-bundle` over its 30 MiB budget on
 * `origin/staging` itself.
 *
 * The budget alone is not a guard against the regression. It is a SUM: the
 * same import can come back the day the pool is 2,000 rows smaller, or behind
 * a `check:convex-bundle` that the `skin` and `engine` lanes never run
 * (`scripts/check-lane.ts`), and nothing would name the cause. So this pins
 * the cut twice:
 *
 *   - by CAUSE — the node graph does not reach the card registry at all;
 *   - by EFFECT — the node half stays under a budget a single re-entry of the
 *     pool (~2.4 MB at the measured 1,013 B/row) cannot fit beneath.
 *
 * It runs in the light lane: one esbuild pass over one entry point, ~1 s.
 */

const CONVEX_DIR = resolve(__dirname, "../../convex");

/** Modules a `"use node"` graph must never reach. The pool is the payload; the
 *  registry and the catalogue are the two doors it comes through, and naming
 *  them makes the failure say WHICH import did it rather than only that the
 *  bytes moved. */
const FORBIDDEN = [
    "data/oracle-compiled-pool.json",
    "convex/cards/compiledPool.ts",
    "convex/cards/catalogue.ts",
    "convex/cards/registry.ts",
    "convex/cards/index.ts",
];

describe("the Convex `use node` bundle's card seam (issue #3444)", () => {
    it("reaches neither the compiled pool nor the registry that imports it", async () => {
        const m = await measureConvexNodeBundle(CONVEX_DIR);

        // A vacuous pass is the one way this guard fails silently: delete the
        // last `"use node"` file and every assertion below holds trivially.
        expect(
            m.entryPoints.length,
            "no `use node` entry point was found — this guard measured nothing"
        ).toBeGreaterThan(0);

        const offenders = m.inputs.filter((input) =>
            FORBIDDEN.some((f) => input === f || input.endsWith("/" + f))
        );
        expect(
            offenders,
            `the \`use node\` graph (${m.entryPoints.join(", ")}) reached ${offenders.join(", ")}. ` +
                `A Node action's esbuild graph is separate, so that inlines the whole compiled ` +
                `card pool a SECOND time into the pushed bundle (issue #3444). Reach the ` +
                `registry by \`ctx.runQuery\` into an isolate module instead — see ` +
                `\`cardAuthority\` in convex/debugScenarioGenerator.ts.`
        ).toEqual([]);
    });

    it("stays under a budget one re-entry of the pool could not fit beneath", async () => {
        const m = await measureConvexNodeBundle(CONVEX_DIR);
        expect(
            m.totalBytes,
            `the \`use node\` half is ${m.totalBytes.toLocaleString("en-US")} B against a budget of ` +
                `${CONVEX_NODE_BUNDLE_BUDGET_BYTES.toLocaleString("en-US")} B. ` +
                `Something large entered the Node graph; ` +
                `\`bun run check:convex-bundle\` will show it in the total.`
        ).toBeLessThanOrEqual(CONVEX_NODE_BUNDLE_BUDGET_BYTES);
    });
});
