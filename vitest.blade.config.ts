import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Blade-suite vitest config (issue #1427, PRD #1423).
 *
 * The blade suite is DELIBERATELY NOT part of the fast unit suite: it runs the
 * real ISMCTS search over full game states, so it is orders of magnitude
 * slower per test than a GRE unit test, and its verdict answers a different
 * question ("is the bot still playing well?" vs "is the rule still correct?").
 * Its own config + its own CI job keeps `bun run test` fast and reports a
 * bot-quality regression as its own signal.
 *
 * The spec files are named `*.spec.ts` (not `*.test.ts`) precisely so the root
 * `vitest.config.ts` node project — which includes `convex/**\/*.test.ts` —
 * never picks them up, and they live under a `__tests__/` directory so the
 * Convex bundler ignores them like every other test module under `convex/`.
 *
 * Run:  bun run test:blade          (must tier — blocking)
 *       bun run test:blade:stretch  (stretch tier — report-only)
 */

const alias = {
    "~": path.resolve(__dirname, "src"),
    "@": path.resolve(__dirname, "src"),
    "@convex": path.resolve(__dirname, "convex"),
};

export default defineConfig({
    resolve: { alias },
    test: {
        name: "blade",
        globals: true,
        environment: "node",
        include: ["convex/gre/ai/blade/__tests__/**/*.spec.ts"],
        exclude: ["**/node_modules/**", "**/dist/**"],
        isolate: false,
        // A blade entry runs a full ISMCTS search per seed; the default 5s
        // ceiling is not a meaningful signal here.
        testTimeout: 120_000,
    },
});
