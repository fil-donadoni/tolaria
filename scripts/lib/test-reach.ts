/**
 * Which tests a diff can reach through the import graph (ADR 0154 §2, issue
 * #5464) — the scoping `check:lane` runs for the `engine` and `skin` lanes in
 * place of whole vitest projects.
 *
 * A test is RELATED to a diff when the diff contains the test itself or any
 * module in the test's transitive local import closure. That is the question
 * vitest's `--changed <ref>` answers, asked of a static walk instead of
 * vitest's own module graph, for one measured reason: `vitest list --changed`
 * transforms every module every spec reaches before it can answer, and that
 * took 5 min 37 s on a three-file diff (load ~14, 2026-10-12) and 102 s for the
 * graph alone in a second session's measurement — as slow as running
 * `node-engine` whole, inside the mutex the lane exists to shorten. The walk
 * below reads each module once with the SAME specifier regex and resolver the
 * vitest project split already trusts (`test-env-split.ts`, one authority) and
 * answers in seconds.
 *
 * WHAT THE WALK CANNOT SEE, stated so nobody reads a skip as a proof:
 *
 *   - a test that READS a file through `fs` (the census shape: a catalogue
 *     sweep, a drift guard over `.claude/**`, `package.json`). `check-lane.ts`
 *     admits `node-tooling` WHOLE for a tooling path that is not a module; the
 *     rest is health's job, which ADR 0154 §2 accepts as the residual risk.
 *   - a vitest `setupFiles` closure. vitest's own `--changed` does not count it
 *     either; the setup files themselves are `full`-lane paths.
 *   - a subprocess: a test that spawns a script which imports the change.
 *
 * Conservative in the direction that matters: an unresolvable specifier still
 * yields a location (`resolveLocal`), and a deleted module is matched by its
 * extension-less key, so a test importing a file the diff deletes is related.
 */

import * as fs from "fs";
import * as path from "path";
import {
    collect,
    IMPORT_SPECIFIER,
    resolveLocal,
    splitScriptsTests,
    splitSrcTests,
} from "../test-env-split";

/** The vitest projects a related test can belong to (bot, perf and ladder
 *  tests are none of them: ADR 0154 §3 sends the bot suite to health). */
export type RelatedProject = "node-engine" | "node-tooling" | "dom";

/** Related test files per vitest project, repo-relative, posix, sorted. */
export type RelatedTests = Record<RelatedProject, string[]>;

/**
 * Specifiers `IMPORT_SPECIFIER` does not carry and a dependency walk must:
 * `vi.mock("x")` (the test depends on the mocked path) and
 * `new URL("x", import.meta.url)` (a worker entry, no import specifier).
 * Local to this walk on purpose — widening the shared regex would move
 * tests between the vitest project partitions it also decides.
 */
const EXTRA_SPECIFIER =
    /vi\.(?:mock|doMock)\(\s*["']([^"']+)["']|new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g;

/** Module extensions a specifier may omit, and the index file it may name. */
const MODULE_SUFFIX = /(\.(tsx?|mjs|js))?$/;

/**
 * The identity a changed path and a resolved import share: repo-relative,
 * posix, without a module extension or a trailing `/index`. `./foo` imports
 * `foo.ts` whether or not `foo.ts` still exists (a deletion), and a deleted
 * `foo/index.ts` is what `./foo` named.
 */
export function moduleKey(rel: string): string {
    return rel
        .split(path.sep)
        .join("/")
        .replace(MODULE_SUFFIX, "")
        .replace(/\/index$/, "");
}

/**
 * The pure core: every test in `tests` whose transitive closure under
 * `importsOf` contains a key in `changed` (the test itself included).
 * Works on keys only, so a test pins it with a hand-built graph.
 */
export function reverseReach(
    tests: readonly string[],
    importsOf: (key: string) => readonly string[],
    changed: readonly string[]
): string[] {
    const importers = new Map<string, string[]>();
    const seen = new Set<string>();
    const stack = [...tests];
    while (stack.length > 0) {
        const key = stack.pop()!;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const dep of importsOf(key)) {
            const list = importers.get(dep);
            if (list) list.push(key);
            else importers.set(dep, [key]);
            stack.push(dep);
        }
    }
    const reached = new Set<string>();
    const frontier = [...changed];
    while (frontier.length > 0) {
        const key = frontier.pop()!;
        if (reached.has(key)) continue;
        reached.add(key);
        frontier.push(...(importers.get(key) ?? []));
    }
    const testSet = new Set(tests);
    return [...reached].filter((k) => testSet.has(k)).sort();
}

/** `*.test.ts(x)` that belongs to a general project, not bot/perf/ladder. */
const isGeneralTest = (basename: string) =>
    /\.test\.tsx?$/.test(basename) &&
    !/\.(bot|perf)\.test\.tsx?$/.test(basename);

/**
 * Every general test file with its vitest project, mirroring
 * `vitest.config.ts`: `convex/**` → `node-engine`; `scripts/**` by
 * `splitScriptsTests`; `src/**` by `splitSrcTests` (`.tsx` is always `dom`);
 * `dashboard/**` → `dom`. Repo-relative, posix.
 */
export function generalTests(root: string): Map<string, RelatedProject> {
    const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
    const out = new Map<string, RelatedProject>();
    for (const f of collect(path.join(root, "convex"), isGeneralTest))
        if (f.endsWith(".test.ts")) out.set(rel(f), "node-engine");
    const scripts = splitScriptsTests(root);
    for (const f of scripts.engine) out.set(f, "node-engine");
    for (const f of scripts.tooling) out.set(f, "node-tooling");
    const srcNode = new Set(splitSrcTests(root).node);
    for (const f of collect(path.join(root, "src"), isGeneralTest)) {
        const r = rel(f);
        out.set(r, srcNode.has(r) ? "node-engine" : "dom");
    }
    for (const f of collect(path.join(root, "dashboard"), isGeneralTest))
        out.set(rel(f), "dom");
    return out;
}

/**
 * The walk's reusable half: every general test keyed by module key, and a
 * memoised `importsOf` — each module is read once per index, however many
 * diffs ask (`check-lane.test.ts` asks dozens).
 */
export interface ReachIndex {
    root: string;
    /** module key → [test path, project] */
    tests: Map<string, [string, RelatedProject]>;
    importsOf: (key: string) => readonly string[];
}

export function reachIndex(
    root: string,
    tests: Map<string, RelatedProject> = generalTests(root)
): ReachIndex {
    const fileOf = new Map<string, string>();
    const keyOf = (abs: string) => {
        const key = moduleKey(path.relative(root, abs));
        if (!fileOf.has(key)) fileOf.set(key, abs);
        return key;
    };
    const byKey = new Map<string, [string, RelatedProject]>();
    for (const [t, project] of tests)
        byKey.set(keyOf(path.join(root, t)), [t, project]);

    const memo = new Map<string, string[]>();
    const importsOf = (key: string): string[] => {
        const hit = memo.get(key);
        if (hit) return hit;
        const deps: string[] = [];
        memo.set(key, deps);
        const file = fileOf.get(key);
        if (
            !file ||
            !/\.(tsx?|mjs|js)$/.test(file) ||
            !fs.existsSync(file) ||
            !fs.statSync(file).isFile()
        )
            return deps;
        const source = fs.readFileSync(file, "utf8");
        for (const re of [IMPORT_SPECIFIER, EXTRA_SPECIFIER])
            for (const m of source.matchAll(re)) {
                const spec = m[1] ?? m[2] ?? m[3];
                const resolved = spec && resolveLocal(root, file, spec);
                if (resolved && resolved.startsWith(root + path.sep))
                    deps.push(keyOf(resolved));
            }
        return deps;
    };
    return { root, tests: byKey, importsOf };
}

/** The tests in `index` the `changed` (repo-relative) paths reach, per project. */
export function relatedTests(
    index: ReachIndex,
    changed: readonly string[]
): RelatedTests {
    const reached = reverseReach(
        [...index.tests.keys()],
        index.importsOf,
        changed.map(moduleKey)
    );
    const out: RelatedTests = {
        "node-engine": [],
        "node-tooling": [],
        dom: [],
    };
    for (const key of reached) {
        const [test, project] = index.tests.get(key)!;
        out[project].push(test);
    }
    for (const list of Object.values(out)) list.sort();
    return out;
}
