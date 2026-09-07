import { defineConfig } from "vitest/config";
import path from "path";
import { splitSrcTests } from "./scripts/test-env-split";

// Shared resolve aliases — must match tsconfig paths so both projects resolve
// `~`, `@`, and `@convex` identically.
const alias = {
    "~": path.resolve(__dirname, "src"),
    "@": path.resolve(__dirname, "src"),
    "@convex": path.resolve(__dirname, "convex"),
};

const baseExclude = [
    "**/node_modules/**",
    "**/dist/**",
    ".sandcastle/worktrees/**",
];

// ─────────────────────────────────────────────────────────────────────────────
// AXIS 3 — WALL-CLOCK PERFORMANCE TESTS (`*.perf.test.ts`, issue #3123).
//
// A test that asserts on elapsed wall-clock time is not a correctness test: it
// measures the machine it runs on. In the general suites it measures a machine
// running seven other vitest workers plus `tsc`, so it reds on correct code —
// the same class of false red the bot/app split (AXIS 2) exists to prevent,
// one axis over.
//
// So they get their OWN project, selected by the `*.perf.test.ts` filename
// suffix and excluded from every other project. `bun run test:perf` runs them
// on demand, solo, when someone actually wants the number. NO gate runs them:
// `bun run test` is still test:app → test:bot → test:blade, and `check:lane`
// never names this project.
//
// The convention is enforced by `scripts/__tests__/perf-test-boundary.test.ts`,
// which fails when a non-perf test file asserts on a clock delta — and also
// pins the exclusion below, so a config edit cannot silently fold perf tests
// back into the gate.
//
// `vitest.blade.config.ts` selects `*.spec.ts` only, so it never picks these up.
// ─────────────────────────────────────────────────────────────────────────────
const PERF_GLOB = ["**/*.perf.test.ts"];

/** Shared exclude for the four GENERAL projects. Perf tests are excluded here
 *  rather than per-project so a new project inherits the exclusion for free;
 *  the `perf` project uses `baseExclude` instead. */
const exclude = [...baseExclude, ...PERF_GLOB];

// ─────────────────────────────────────────────────────────────────────────────
// TWO AXES: runtime environment (node / dom) × subsystem (app / bot).
//
// AXIS 1 — runtime environment (issue #811, DOM impl swapped to happy-dom in
// #2435):
//   - `node`  → convex GRE / card / script tests. Pure Node logic (no DOM, no
//               React); running them under a DOM environment paid a per-file
//               environment-init cost for nothing. `node` env init is
//               effectively free, which collapses the `environment` phase.
//   - `dom`   → the src/ tests that genuinely need a DOM (React component /
//               hook renders), run under `happy-dom` (issue #2435 — swapped
//               from jsdom because jsdom's per-file `environment` phase was
//               the dominant cost. Measured back-to-back on the SAME tree,
//               `TOLARIA_VITEST_WORKERS=2 bunx vitest run --project dom`,
//               252 files / 2207 passed both ways: happy-dom 119.35s wall /
//               44.33s `environment`, jsdom 180.05s wall / 113.03s
//               `environment` — ~34% off wall, ~61% off the `environment`
//               phase). Only the DOM
//               projects load the DOM setup file (jest-dom matchers +
//               ResizeObserver stub).
// The line between them is runtime NEED, not directory: `src` tests that touch
// no DOM global and mock no module run in the node project (see SRC_NODE_TESTS
// below). It survives future card-registry migrations because it keys off what
// a file uses, not on which modules it imports.
//
// AXIS 2 — subsystem: APP vs BOT (`*.bot.test.ts`).
// The bot/AI tests (ISMCTS search, evaluation, move enumeration, the bot
// driver, self-play, the drafter — 43 files) answer a DIFFERENT question from
// the application suite ("is the bot still playing well?" vs "is the rule still
// correct?") and have a different cost profile: they run real searches over
// full game states, so a single file can occupy a worker for tens of seconds.
// Mixed into the ~578-file application suite they lose the CPU race and their
// heavy episodes time out — the ai-diagnosis ladder episodes did exactly that
// on main, red under full-suite load and green in isolation (they have since
// left the gate outright, issue #2436; the split is what kept every OTHER bot
// file honest in the meantime).
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
// worker. The dom projects keep the default isolation because src files use
// vi.mock/spyOn and would leak spies.
// ─────────────────────────────────────────────────────────────────────────────

/** Bot/AI tests, selected by the `*.bot.test.ts` filename suffix. */
const BOT_GLOB_NODE = ["convex/**/*.bot.test.ts", "scripts/**/*.bot.test.ts"];
const BOT_GLOB_DOM = ["src/**/*.bot.test.{ts,tsx}"];

// ─────────────────────────────────────────────────────────────────────────────
// AXIS 1, REFINED — `src` tests that need no DOM run in the NODE project.
//
// The dom project selected by directory, so 104 pure-logic `src` files paid
// the DOM tax for a DOM they never touch: measured, that subset costs 57.8s
// under jsdom and ~10-20s under node, and the whole dom project is 171s of
// which 133s is per-file environment init (issue #811's jsdom baseline; the
// happy-dom swap in #2435 cut the `environment` phase to 44.33s measured on a
// same-tree back-to-back run — see the `dom` project comment above). The
// classifier (`scripts/test-env-split.ts`) reads each file and disqualifies
// on any DOM global, testing-library import, jest-dom matcher, or
// `vi.mock`/spy/fake-timer (the node project runs `isolate: false`, so
// module-level state is shared).
//
// Computed at config load, never checked in: a file that grows a DOM dependency
// moves back to dom on the next run with no list to update. Partition pinned
// by `scripts/__tests__/src-test-env-split.test.ts` — the silent failure to
// guard against is a file selected by NEITHER project, which is a test that
// stops running while the gate stays green.
// ─────────────────────────────────────────────────────────────────────────────
const SRC_NODE_TESTS = splitSrcTests(__dirname).node;

// ─────────────────────────────────────────────────────────────────────────────
// BOT FAST LANE — `TOLARIA_BOT_FAST=1` (issue #1912).
//
// The light pre-PR gate (`check:pr`) ran no tests at all, and the bot suite is
// the one place catalogue-wide GUARDS live: `aiEffectsGuard` (a new
// `resolve()`/`resolveSteps` card with no AI valuation), `pickRatings` (a cube
// card with no pick rating), `opValuerCoverage` (a new Op with no valuer), the
// `moves`/`cardProfile` censuses. Shipping a card trips them routinely — and
// three consecutive card PRs reached a green `check:pr` while red in the bot
// suite, each caught only by human/agent review or by CI after the fact.
//
// So `check:pr` now runs the bot suite too — minus a DENY-LIST of the few
// genuinely expensive files. The cost distribution made this cheap: measured
// per-file, `ai-diagnosis.bot.test.ts` alone was 163s of the suite's then-188s,
// and the remaining 65 files totalled ~25s of test time. Since issue #2436 that
// one file is gone (its ladder episodes were a strength measurement, not a
// correctness guard) and the deny-list is EMPTY — the fast lane and the full
// lane run the same bot files, and the whole suite is the ~25s remainder.
//
// DENY-list, not an allow-list of guards, on purpose: an allow-list silently
// stops covering every guard added after it was written — the hand-maintained
// list anti-pattern this repo has already paid for elsewhere. With a deny-list
// a NEW bot guard is picked up for free, and only a new genuinely-slow file
// needs a decision here.
//
// The deny-listed files still run in the full gate (`bun run test:bot`) — this
// lane defers them, it never drops them.
// ─────────────────────────────────────────────────────────────────────────────
// Bot test files the `TOLARIA_BOT_FAST=1` lane skips. EMPTY since issue #2436:
// its sole member was `ai-diagnosis.bot.test.ts`, whose five-rung ISMCTS ladder
// episodes (up to 20 000 iterations, 163s — ~87% of the bot suite) were a
// STRENGTH measurement rather than a correctness guard and left the gate
// altogether; what survived is a bounded liveness smoke
// (`searchLiveness.bot.test.ts`), three `must` blade entries and two leaf
// assertions in `evaluate.bot.test.ts`, none of them expensive. So the fast
// lane and the full lane now run the SAME bot files.
//
// The mechanism is kept, not deleted: it is the declared home for a future file
// too expensive for `check:pr`, and `scripts/__tests__/bot-fast-lane.test.ts`
// mirrors this list so the two cannot drift. Adding an entry means accepting
// that `check:pr` stops covering it.
const HEAVY_BOT_GLOB: string[] = [];
const BOT_FAST = process.env.TOLARIA_BOT_FAST === "1";
const botExclude = BOT_FAST ? [...exclude, ...HEAVY_BOT_GLOB] : exclude;

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
                    // Deep-freezes the shared catalogue: `isolate: false`
                    // shares module state across files, so an in-place
                    // mutation of a card definition would silently poison
                    // later files in the worker (order-dependent heisen-red,
                    // observed 2026-08-27). See vitest.setup.node.ts.
                    setupFiles: ["./vitest.setup.node.ts"],
                    include: [
                        "convex/**/*.test.ts",
                        "scripts/**/*.test.ts",
                        ...SRC_NODE_TESTS,
                    ],
                    exclude: [...exclude, ...BOT_GLOB_NODE],
                    isolate: false,
                    // A HANG GUARD, not a measurement (issue #3123). Health
                    // runs measured load average 21 on 8 cores, and at that
                    // contention vitest's 5s default reds CORRECT code — it
                    // did so in >=10 of 23 RED health runs. 30s is far beyond
                    // anything a unit test legitimately takes here and still
                    // tight enough to catch a genuine hang. A test that wants
                    // to ASSERT on elapsed time belongs in the `perf` project.
                    testTimeout: 30_000,
                },
            },
            {
                extends: true,
                test: {
                    name: "dom",
                    environment: "happy-dom",
                    setupFiles: ["./vitest.setup.ts"],
                    // `dashboard/**` joins the DOM project WHOLE (PRD #3148
                    // S1), not split by AXIS 1's runtime-need rule: every
                    // module in that tree is either a React component or a
                    // store built on `document`/`localStorage`/`matchMedia`,
                    // so there is no pure-logic subset to route to `node`.
                    include: [
                        "src/**/*.test.{ts,tsx}",
                        "dashboard/**/*.test.{ts,tsx}",
                    ],
                    exclude: [...exclude, ...BOT_GLOB_DOM, ...SRC_NODE_TESTS],
                    // Same hang guard as the `node` project above (#3123).
                    testTimeout: 30_000,
                },
            },
            {
                extends: true,
                test: {
                    name: "bot-node",
                    environment: "node",
                    // Same shared-module-state hazard as the `node` project
                    // (`isolate: false`) — same frozen catalogue.
                    setupFiles: ["./vitest.setup.node.ts"],
                    include: BOT_GLOB_NODE,
                    exclude: botExclude,
                    isolate: false,
                    // A bot test runs a real ISMCTS search (production
                    // budgets are hundreds of iterations, and since ADR 0015
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
                    name: "bot-dom",
                    environment: "happy-dom",
                    setupFiles: ["./vitest.setup.ts"],
                    include: BOT_GLOB_DOM,
                    exclude: botExclude,
                    testTimeout: 60_000,
                },
            },
            {
                extends: true,
                test: {
                    name: "perf",
                    environment: "node",
                    // Same frozen-catalogue setup as the `node` project.
                    setupFiles: ["./vitest.setup.node.ts"],
                    include: PERF_GLOB,
                    // NOT `exclude` — that list is what banishes perf tests
                    // from the general projects; applying it here would leave
                    // this project selecting nothing at all.
                    exclude: baseExclude,
                },
            },
        ],
    },
});
