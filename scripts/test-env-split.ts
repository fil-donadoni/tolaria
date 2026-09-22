/**
 * Which `src/**` tests actually need a DOM.
 *
 * The `dom` project (named `jsdom` before #2435, when it also ran under the
 * `jsdom` package — it now runs under `happy-dom`) selects by DIRECTORY
 * (`src/**`), not by need. Measured at the light tier's 2 workers: 362 files,
 * 171s — of which 133s was `environment` (a DOM instance built per file) and
 * 116s is `import` (the default per-file isolation re-evaluates each module
 * graph). Actual test execution is 37s. Meanwhile the node project runs 577
 * files in 26.5s, because node's environment init is free and
 * `isolate: false` shares one module registry per worker.
 *
 * 104 of those `src` files render nothing: they exercise pure helpers —
 * sorting, filtering, cost math, eligibility predicates — and pay the DOM
 * tax for a DOM they never touch. Moving them to the node project measured
 * 57.8s → ~10-20s for that subset, and hands the light gate a `src`-side
 * catalogue guard it never ran (`activation-affordability.catalogue.test.ts`).
 *
 * The split is CONTENT-classified rather than named (`*.node.test.ts` would
 * mean renaming ~104 files and would rot the moment someone adds `render()` to
 * one without renaming it) and it is computed at config load, so it re-derives
 * itself on every run. A file that grows a DOM dependency moves back to `dom`
 * by itself.
 *
 * Conservative by construction — the markers below are "might need a DOM or
 * might leak between files", not "definitely does". A false `dom`
 * classification costs ~0.4s; a false node classification is a red test, so
 * ambiguity resolves toward `dom`. `.tsx` is never classified: JSX in a test
 * means rendering.
 *
 * `vi.mock` / `vi.spyOn` / fake timers / global stubs are disqualifiers even
 * with no DOM in sight: the node project runs `isolate: false`, so module-level
 * state is shared across the files a worker runs. That is exactly what broke
 * when the whole `src` set was tried under `isolate: false` — 128 files red,
 * one factory's `@convex/cards` mock winning over another's.
 */
import * as fs from "fs";
import * as path from "path";

/** A DOM (or DOM-adjacent global) the node environment does not provide. */
const DOM_MARKERS = [
    "@testing-library",
    'from "react"',
    'from "react-dom"',
    "renderHook",
    "document.",
    "window.",
    "localStorage",
    "sessionStorage",
    "matchMedia",
    "ResizeObserver",
    "IntersectionObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "navigator.",
    "HTMLElement",
    "createRoot",
    // jest-dom matchers imply a rendered tree even without a visible import.
    "toBeInTheDocument",
    "toHaveClass",
    "toBeVisible",
    "toHaveAttribute",
    "toHaveTextContent",
    "toBeDisabled",
    "toHaveFocus",
];

/** Module-level state that `isolate: false` would share between files. */
const ISOLATION_MARKERS = [
    "vi.mock",
    "vi.doMock",
    "vi.spyOn",
    "vi.hoisted",
    "vi.useFakeTimers",
    "vi.stubGlobal",
    "vi.stubEnv",
];

export const SRC_NODE_DISQUALIFIERS = [...DOM_MARKERS, ...ISOLATION_MARKERS];

function collect(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(full, out);
        else if (entry.name.endsWith(".test.ts")) out.push(full);
    }
    return out;
}

export interface SrcTestSplit {
    /** `src` tests that can run in the node project, repo-relative, posix. */
    node: string[];
    /** `src` tests that stay in the dom project, repo-relative, posix. */
    dom: string[];
}

/** Classifies every non-bot `src/**\/*.test.ts` by whether it needs a DOM. */
export function splitSrcTests(root: string): SrcTestSplit {
    const node: string[] = [];
    const dom: string[] = [];
    for (const file of collect(path.join(root, "src")).sort()) {
        if (file.endsWith(".bot.test.ts")) continue;
        const rel = path.relative(root, file).split(path.sep).join("/");
        const source = fs.readFileSync(file, "utf8");
        const needsDom = SRC_NODE_DISQUALIFIERS.some((m) => source.includes(m));
        (needsDom ? dom : node).push(rel);
    }
    return { node, dom };
}

// ─────────────────────────────────────────────────────────────────────────────
// The node project, partitioned: `node-engine` / `node-tooling` (ADR 0136 §5).
//
// `scripts/__tests__` holds two different populations under one directory:
// guards over the ENGINE (catalogue censuses, the card-index and oracle
// artefacts, bundle purity, CR citations) and tests of the repo's TOOLING
// (gate, land, hooks, loop, telemetry, dashboard) — the second half mostly
// subprocess-heavy, and none of it reachable from a `convex/**` edit. The
// `engine` lane pays for the first and, since ADR 0136, not the second.
//
// A FIXED partition, classified by content, never by the diff (ADR 0104 §2 as
// amended): the predicate reads the test and its local import graph, not the
// changed files. It is conservative toward `engine`, the partition every code
// lane runs — a false `engine` costs seconds, a false `tooling` is a guard a
// `convex/**` diff stops running until the next health run. So a file is
// `engine` when EITHER
//
//   - its transitive local imports (relative specifiers and the `@convex/`,
//     `~/`, `@/` aliases, followed through `scripts/**` and `src/**`) reach a
//     module under `convex/` or `data/`, or
//   - the test itself names `convex` or `data` as a path literal (`"convex/…"`,
//     `join(ROOT, "convex")`) — the census shape, which reads the engine tree
//     through `fs` and imports none of it — or any local module it reaches
//     names `convex/…` / `data/…` (the CR sweeps read `data/cr/` and every
//     tracked `convex/**` source through a `scripts/lib` helper). The module
//     arm requires the slash and ignores comments: a bare `"data"` there is an
//     event name as often as a directory, and a doc comment citing
//     `convex/bugReports.ts` reads nothing.
//
// What the predicate cannot see is a subprocess: a tooling test that spawns a
// script which imports `convex/` or reads it. None exists as of ADR 0136; one
// that appears is caught at the health run, the backstop ADR 0104 already
// names.
// ─────────────────────────────────────────────────────────────────────────────

/** Import specifiers: `from "x"`, `import("x")`, bare `import "x"`. */
const IMPORT_SPECIFIER =
    /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;

/** A string literal naming the engine tree or its data as a path. */
const ENGINE_PATH_LITERAL = /["'`](convex|data)(["'`]|\/)/;

/** The same, in a reached module: the directory form only, and only in code —
 *  `scripts/lib` doc comments cite `convex/…` paths as prose all the time. */
const ENGINE_DIR_LITERAL = /["'`](convex|data)\//;

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ENGINE_ROOTS = ["convex/", "data/"];

function resolveLocal(
    root: string,
    from: string,
    specifier: string
): string | null {
    let base: string;
    if (specifier.startsWith(".")) {
        base = path.resolve(path.dirname(from), specifier);
    } else if (specifier.startsWith("@convex/")) {
        base = path.join(root, "convex", specifier.slice("@convex/".length));
    } else if (specifier.startsWith("~/") || specifier.startsWith("@/")) {
        base = path.join(root, "src", specifier.slice(2));
    } else {
        return null;
    }
    for (const candidate of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.mjs`,
        `${base}.js`,
        path.join(base, "index.ts"),
    ]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    // Unresolved: still a location — `../../convex/_generated/api` is an
    // engine import whether or not the generated file is on disk.
    return base;
}

/** True when `testFile` belongs to `node-engine` (see the block above). */
export function reachesEngine(root: string, testFile: string): boolean {
    if (ENGINE_PATH_LITERAL.test(fs.readFileSync(testFile, "utf8"))) {
        return true;
    }
    const seen = new Set<string>();
    const stack = [testFile];
    while (stack.length > 0) {
        const file = stack.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        const rel = path.relative(root, file).split(path.sep).join("/");
        if (ENGINE_ROOTS.some((r) => rel.startsWith(r))) return true;
        if (!/\.(tsx?|mjs|js)$/.test(file) || !fs.existsSync(file)) continue;
        const source = fs.readFileSync(file, "utf8");
        if (
            file !== testFile &&
            ENGINE_DIR_LITERAL.test(stripComments(source))
        ) {
            return true;
        }
        for (const m of source.matchAll(IMPORT_SPECIFIER)) {
            const resolved = resolveLocal(root, file, m[1] ?? m[2] ?? m[3]);
            if (resolved) stack.push(resolved);
        }
    }
    return false;
}

export interface ScriptsTestSplit {
    /** `scripts` tests in `node-engine`, repo-relative, posix. */
    engine: string[];
    /** `scripts` tests in `node-tooling`, repo-relative, posix. */
    tooling: string[];
}

/**
 * Partitions every general `scripts/**\/*.test.ts` — bot tests belong to
 * `bot-node` and perf tests to `perf`, so neither is classified here.
 */
export function splitScriptsTests(root: string): ScriptsTestSplit {
    const engine: string[] = [];
    const tooling: string[] = [];
    for (const file of collect(path.join(root, "scripts")).sort()) {
        if (/\.(bot|perf)\.test\.ts$/.test(file)) continue;
        const rel = path.relative(root, file).split(path.sep).join("/");
        (reachesEngine(root, file) ? engine : tooling).push(rel);
    }
    return { engine, tooling };
}

// ─────────────────────────────────────────────────────────────────────────────
// Which `src/**` files a BOT project's tests can see (issue #3435).
//
// The bot projects are selected by FILENAME (`*.bot.test.{ts,tsx}`), and the
// split routes `src/**/*.bot.test.{ts,tsx}` to `bot-dom` while EXCLUDING those
// files from `dom`. So a `src/**` file's bot tests live in a project the `skin`
// lane never ran, and the lane's skip line asserted the bot suites "cannot go
// red" for a diff that could red them — the whole `src/lib/ai` client host, the
// vs-AI driver hook and the DecisionTrace debug components, plus
// `src/lib/ai/selfplay/ladder.ts`, which a `scripts/**` bot test imports and so
// reaches `bot-node` too.
//
// A HAND-MAINTAINED LIST WAS THE WRONG ANSWER, and the repo already had two
// overlapping ones (`BOT_GLOBS` and the boundary guard's exact-module list) —
// adding a third is how the hole stays open for whatever the third forgets.
// What the lane actually needs to know is not "is this file the Bot" but "can
// this file red a bot test", and that is COMPUTED: the transitive local import
// closure of every bot test file, keeping the `src/**` half. Measured 150 of
// 1449 `src` code files in 0.3s, so the `skin` lane keeps its cost on the ~90%
// of diffs that cannot reach a bot test and pays the project on the ones that
// can.
//
// Conservative in the direction that matters, exactly as `reachesEngine` is: a
// false positive costs the lane one project, a false negative is a suite that
// stops covering its own subject. `botSubjects` is therefore UNIONED at the
// call site with `matchesBotGlob` (`scripts/lib/bot-globs.ts`), which catches
// what an import walk structurally cannot — `brain-client.ts` spawns
// `brain.worker.ts` through `new Worker(new URL(...))`, a specifier no import
// graph contains.
// ─────────────────────────────────────────────────────────────────────────────

export interface BotSubjects {
    /** `src/**` paths reachable from a `bot-dom` test, the tests included. */
    dom: string[];
    /** `src/**` paths reachable from a `bot-node` test (`convex`, `scripts`). */
    node: string[];
}

/** Every `*.bot.test.{ts,tsx}` under `dir`, absolute. */
function collectBotTests(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectBotTests(full, out);
        else if (/\.bot\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** The `src/**` half of the transitive local import closure of `entries`. */
function srcClosure(root: string, entries: string[]): string[] {
    const srcRoot = path.join(root, "src");
    const seen = new Set<string>();
    const stack = [...entries];
    while (stack.length > 0) {
        const file = stack.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        if (!/\.(tsx?|mjs|js)$/.test(file) || !fs.existsSync(file)) continue;
        const source = fs.readFileSync(file, "utf8");
        for (const m of source.matchAll(IMPORT_SPECIFIER)) {
            const resolved = resolveLocal(root, file, m[1] ?? m[2] ?? m[3]);
            if (resolved) stack.push(resolved);
        }
    }
    return [...seen]
        .filter((f) => f.startsWith(`${srcRoot}${path.sep}`))
        .map((f) => path.relative(root, f).split(path.sep).join("/"))
        .sort();
}

/** The `src/**` paths each bot project's tests can reach. */
export function botSubjects(root: string): BotSubjects {
    return {
        dom: srcClosure(root, collectBotTests(path.join(root, "src"))),
        node: srcClosure(root, [
            ...collectBotTests(path.join(root, "convex")),
            ...collectBotTests(path.join(root, "scripts")),
        ]),
    };
}
