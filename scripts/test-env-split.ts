/**
 * Which `src/**` tests actually need a DOM.
 *
 * The jsdom project selects by DIRECTORY (`src/**`), not by need. Measured at
 * the light tier's 2 workers: 362 files, 171s — of which 133s is `environment`
 * (a jsdom instance built per file) and 116s is `import` (the default per-file
 * isolation re-evaluates each module graph). Actual test execution is 37s.
 * Meanwhile the node project runs 577 files in 26.5s, because node's
 * environment init is free and `isolate: false` shares one module registry per
 * worker.
 *
 * 104 of those `src` files render nothing: they exercise pure helpers —
 * sorting, filtering, cost math, eligibility predicates — and pay the jsdom
 * tax for a DOM they never touch. Moving them to the node project measured
 * 57.8s → ~10-20s for that subset, and hands the light gate a `src`-side
 * catalogue guard it never ran (`activation-affordability.catalogue.test.ts`).
 *
 * The split is CONTENT-classified rather than named (`*.node.test.ts` would
 * mean renaming ~104 files and would rot the moment someone adds `render()` to
 * one without renaming it) and it is computed at config load, so it re-derives
 * itself on every run. A file that grows a DOM dependency moves back to jsdom
 * by itself.
 *
 * Conservative by construction — the markers below are "might need a DOM or
 * might leak between files", not "definitely does". A false jsdom classification
 * costs ~0.4s; a false node classification is a red test, so ambiguity resolves
 * toward jsdom. `.tsx` is never classified: JSX in a test means rendering.
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
    /** `src` tests that stay in jsdom, repo-relative, posix. */
    jsdom: string[];
}

/** Classifies every non-bot `src/**\/*.test.ts` by whether it needs jsdom. */
export function splitSrcTests(root: string): SrcTestSplit {
    const node: string[] = [];
    const jsdom: string[] = [];
    for (const file of collect(path.join(root, "src")).sort()) {
        if (file.endsWith(".bot.test.ts")) continue;
        const rel = path.relative(root, file).split(path.sep).join("/");
        const source = fs.readFileSync(file, "utf8");
        const needsDom = SRC_NODE_DISQUALIFIERS.some((m) => source.includes(m));
        (needsDom ? jsdom : node).push(rel);
    }
    return { node, jsdom };
}
