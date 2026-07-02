import { defineConfig } from "vitest/config";
import path from "path";

// Shared resolve aliases — must match tsconfig paths so both projects resolve
// `~`, `@`, and `@convex` identically.
const alias = {
    "~": path.resolve(__dirname, "src"),
    "@": path.resolve(__dirname, "src"),
    "@convex": path.resolve(__dirname, "convex"),
};

const exclude = [
    "**/node_modules/**",
    "**/dist/**",
    ".sandcastle/worktrees/**",
];

// Two projects split purely by runtime environment (issue #811):
//   - `node`   → convex GRE / card / script tests (148 files). Pure Node logic
//                (no DOM, no React); running them under jsdom paid a per-file
//                jsdom environment-init cost for nothing. `node` env init is
//                effectively free, which collapses the `environment` phase.
//   - `jsdom`  → everything under src/ (127 React component / hook / util
//                files), which genuinely needs a DOM. Only this project loads
//                the jsdom setup file (jest-dom matchers + ResizeObserver stub).
// The split is content-independent: it survives future card-registry migrations
// because it keys off directory/runtime need, not on which modules a test imports.
//
// `isolate: false` on the node project is the import-cost lever. The card
// registry (convex/cards/index.ts) eagerly pulls in ~37 sets / ~290 modules;
// under the default per-file isolation that whole graph is re-evaluated once
// for every one of the 148 node files. Disabling isolation shares one module
// registry per worker, so the graph is imported ~once per worker instead of
// ~148 times — the dominant slice of the `import` phase. It is safe here
// because convex/scripts tests use ZERO vi.mock / vi.spyOn / fake timers /
// global writes (verified by grep), so there is no module-level state to leak
// between files sharing a worker. The jsdom project keeps the default
// isolation because 43 src files use vi.mock/spyOn and would leak spies.
export default defineConfig({
    resolve: { alias },
    test: {
        globals: true,
        projects: [
            {
                extends: true,
                test: {
                    name: "node",
                    environment: "node",
                    include: ["convex/**/*.test.ts", "scripts/**/*.test.ts"],
                    exclude,
                    isolate: false,
                },
            },
            {
                extends: true,
                test: {
                    name: "jsdom",
                    environment: "jsdom",
                    setupFiles: ["./vitest.setup.ts"],
                    include: ["src/**/*.test.{ts,tsx}"],
                    exclude,
                },
            },
        ],
    },
});
