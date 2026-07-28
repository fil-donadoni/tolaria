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

// ─────────────────────────────────────────────────────────────────────────────
// TWO AXES: runtime environment (node / jsdom) × subsystem (app / bot).
//
// AXIS 1 — runtime environment (issue #811):
//   - `node`   → convex GRE / card / script tests. Pure Node logic (no DOM, no
//                React); running them under jsdom paid a per-file jsdom
//                environment-init cost for nothing. `node` env init is
//                effectively free, which collapses the `environment` phase.
//   - `jsdom`  → everything under src/ (React component / hook / util files),
//                which genuinely needs a DOM. Only the jsdom projects load the
//                jsdom setup file (jest-dom matchers + ResizeObserver stub).
// The split is content-independent: it survives future card-registry migrations
// because it keys off directory/runtime need, not on which modules a test imports.
//
// AXIS 2 — subsystem: APP vs BOT (`*.bot.test.ts`).
// The bot/AI tests (ISMCTS search, evaluation, move enumeration, the bot
// driver, self-play, the drafter — 43 files) answer a DIFFERENT question from
// the application suite ("is the bot still playing well?" vs "is the rule still
// correct?") and have a different cost profile: they run real searches over
// full game states, so a single file can occupy a worker for tens of seconds.
// Mixed into the ~578-file application suite they lose the CPU race and their
// heavy episodes time out — the ai-diagnosis ladder episodes did exactly that
// on main, red under full-suite load and green in isolation.
//
// Selection is by FILENAME, not directory: `*.bot.test.ts` is the bot suite,
// every other `*.test.ts` is the application suite. Bot tests are interleaved
// with app tests in shared directories (convex/gre/__tests__ holds both), so no
// directory glob isolates them; the suffix keeps each test next to the module it
// covers while making the suite membership explicit and self-documenting — a new
// bot test opts in by its own name. The convention is enforced by
// `convex/__tests__/bot-suite-boundary.test.ts`, which fails when a non-bot test
// file imports a bot-only module. Same shape as the blade suite's `*.spec.ts`
// naming (`vitest.blade.config.ts`).
//
// The projects exist so `--project` can select a suite, but the CPU-contention
// fix is that `bun run test` invokes vitest TWICE (test:app then test:bot):
// projects within one invocation share a single worker pool, so a project split
// alone would not have separated the two suites' scheduling.
//
// `isolate: false` on the node projects is the import-cost lever. The card
// registry (convex/cards/index.ts) eagerly pulls in ~37 sets / ~290 modules;
// under the default per-file isolation that whole graph is re-evaluated once
// for every node file. Disabling isolation shares one module registry per
// worker, so the graph is imported ~once per worker instead of once per file —
// the dominant slice of the `import` phase. It is safe there because
// convex/scripts tests use ZERO vi.mock / vi.spyOn / fake timers / global
// writes, so there is no module-level state to leak between files sharing a
// worker. The jsdom projects keep the default isolation because src files use
// vi.mock/spyOn and would leak spies.
// ─────────────────────────────────────────────────────────────────────────────

/** Bot/AI tests, selected by the `*.bot.test.ts` filename suffix. */
const BOT_GLOB_NODE = ["convex/**/*.bot.test.ts", "scripts/**/*.bot.test.ts"];
const BOT_GLOB_JSDOM = ["src/**/*.bot.test.{ts,tsx}"];

// ─────────────────────────────────────────────────────────────────────────────
// WORKER CAP — CPU admission control (see scripts/gate.ts for the full rationale).
//
// Vitest defaults to `ncpu - 1` workers per invocation. That is correct for ONE
// invocation and pathological for this repo's actual working mode: several
// concurrent Claude Code subagents, each in its own worktree, each running
// vitest. On 8 cores four of them spawn ~28 workers — measured load average 45,
// targeted suites 2.5x slower than solo, and the bot suite blowing its 60s
// per-test ceiling under contention (false reds).
//
// So the DEFAULT here is deliberately small (2): four concurrent light jobs then
// fit inside ncpu. The heavy tier — the full suites and `check:all`, which hold
// the machine-wide gate mutex and therefore run alone — raises it back to
// `ncpu - 1` by exporting TOLARIA_VITEST_WORKERS (scripts/gate.ts). Override by
// hand for a one-off solo run: TOLARIA_VITEST_WORKERS=7 bunx vitest run <path>.
// ─────────────────────────────────────────────────────────────────────────────
const WORKERS = Math.max(1, Number(process.env.TOLARIA_VITEST_WORKERS ?? 2));

export default defineConfig({
    resolve: { alias },
    test: {
        globals: true,
        maxWorkers: WORKERS,
        minWorkers: 1,
        projects: [
            {
                extends: true,
                test: {
                    name: "node",
                    environment: "node",
                    include: ["convex/**/*.test.ts", "scripts/**/*.test.ts"],
                    exclude: [...exclude, ...BOT_GLOB_NODE],
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
                    exclude: [...exclude, ...BOT_GLOB_JSDOM],
                },
            },
            {
                extends: true,
                test: {
                    name: "bot-node",
                    environment: "node",
                    include: BOT_GLOB_NODE,
                    exclude,
                    isolate: false,
                    // A bot test runs a real ISMCTS search (the ai-diagnosis
                    // ladder tops out at 20k iterations, and since ADR 0015
                    // each rollout plays a full round). The default 5s ceiling
                    // is not a meaningful signal here — it only needs to be
                    // tight enough to still catch a genuine hang. Same
                    // reasoning as the blade suite's own 120s ceiling.
                    testTimeout: 60_000,
                },
            },
            {
                extends: true,
                test: {
                    name: "bot-jsdom",
                    environment: "jsdom",
                    setupFiles: ["./vitest.setup.ts"],
                    include: BOT_GLOB_JSDOM,
                    exclude,
                    testTimeout: 60_000,
                },
            },
        ],
    },
});
