import { defineConfig } from "vitest/config";
import path from "path";
import { fsModuleCacheOptions } from "./scripts/lib/vitest-fs-cache";

/**
 * Blade-suite vitest config (issue #1427, PRD #1423).
 *
 * The blade suite is DELIBERATELY NOT part of the fast unit suite: it runs the
 * real ISMCTS search over full game states, so it is orders of magnitude
 * slower per test than a GRE unit test, and its verdict answers a different
 * question ("is the bot still playing well?" vs "is the rule still correct?").
 * Its own config keeps `test:app` / `test:bot` fast and reports a bot-quality
 * regression as its own signal. It used to be gated by its own CI job
 * (`.github/workflows/blade.yml`); since the Actions workflows were removed
 * (no minutes on the plan, and with no branch protection they gated nothing)
 * the must tier is the third leg of `bun run test` — the only gate left is the
 * local one, so anything blocking has to live inside it. The stretch tier is
 * report-only and stays manual: `bun run test:blade:stretch`.
 *
 * The spec files are named `*.spec.ts` (not `*.test.ts`) precisely so the root
 * `vitest.config.ts` node project — which includes `convex/**\/*.test.ts` —
 * never picks them up, and they live under a `__tests__/` directory so the
 * Convex bundler ignores them like every other test module under `convex/`.
 *
 * Run:  bun run test:blade          (must tier — blocking)
 *       bun run test:blade:stretch  (stretch tier — report-only)
 *
 * A search VARIANT leg (issue #2684) is opt-in through the environment, the
 * same way the tier is:
 *       BLADE_VARIANT=action-priors bun run test:blade
 * installs that `LADDER_VARIANTS` entry around every entry of the tier. Unset
 * (the default, and what `bun run test` runs) touches the variant module state
 * not at all.
 */

const alias = {
    "~": path.resolve(__dirname, "src"),
    "@": path.resolve(__dirname, "src"),
    "@convex": path.resolve(__dirname, "convex"),
};

// Worker cap (issue #4482): the must tier is sharded over four spec files
// (`__tests__/blade.shard-N.spec.ts`), so the pool size decides the wall.
// Same knob and default as `vitest.config.ts`: the heavy tier (`bun run test`,
// `test:app`, `test:bot`) exports `min(ncpu - 1, 4)` through `scripts/gate.ts`;
// a bare `bun run test:blade` stays at 2 so concurrent light jobs fit ncpu.
const WORKERS = Math.max(1, Number(process.env.TOLARIA_VITEST_WORKERS ?? 2));

export default defineConfig({
    resolve: { alias },
    test: {
        // Same manual flag as `vitest.config.ts` (issue #4488), off unless
        // set by hand. No `define` here, so no key plugin.
        ...fsModuleCacheOptions(process.env),
        name: "blade",
        maxWorkers: WORKERS,
        minWorkers: 1,
        globals: true,
        // Same rule as `vitest.config.ts` (issue #4492): a block that reaches
        // no `expect` fails.
        expect: { requireAssertions: true },
        environment: "node",
        include: ["convex/gre/ai/blade/__tests__/**/*.spec.ts"],
        exclude: ["**/node_modules/**", "**/dist/**"],
        isolate: false,
        // A blade entry runs a full ISMCTS search per seed; the default 5s
        // ceiling is not a meaningful signal here.
        testTimeout: 120_000,
    },
});
