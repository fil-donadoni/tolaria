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
 * `node-engine` whole, inside the mutex the lane exists to shorten.
 *
 * ONE RESOLVER: edges come from `lib/import-graph.ts` (`importSpecifiers`,
 * `resolveSpecifier` — `./x.js` → `x.ts`, `index.*`, `?url` dropped, type-only
 * statements erased as vitest erases them), with vitest's aliases
 * (`TEST_ALIASES`, pinned to `vitest.config.ts` by `test-reach.test.ts`).
 * Three edges are added on top, each an over-approximation:
 *
 *   - `vi.mock("x")` / `vi.doMock("x")` — the test depends on the mocked path;
 *   - an unresolvable LOCAL specifier keys on its extension-less location
 *     (`specifierBase`), so a test importing a module the diff deletes is
 *     related;
 *   - a FILE-NAME LITERAL (`"card-index.json"`, `"deny-guard.sh"`,
 *     `"gate.ts"`) in any module is an edge to every file of that basename.
 *     This is how the walk sees a reader that opens its input through `fs`
 *     (`join(ROOT, "data", "card-index.json")`) and a tooling test that spawns
 *     a script by path (`resolve(__dirname, "..", "gate.ts")`).
 *
 * WHAT THE WALK STILL CANNOT SEE, stated so nobody reads a skip as a proof:
 * a census that walks a DIRECTORY (`readdirSync(".claude/skills")`) or matches
 * source text by pattern, a vitest `setupFiles` closure (vitest's own
 * `--changed` ignores it too; the setup files are `full`-lane paths), and a
 * name built at runtime. `check-lane.ts` admits `node-tooling` whole for a
 * tooling path that is not a module; the rest is health's job, which ADR 0154
 * §2 accepts as the residual risk.
 */

import * as fs from "fs";
import * as path from "path";
import {
    importSpecifiers,
    resolveSpecifier,
    specifierBase,
    type ImportAlias,
} from "./import-graph";
import { collect, splitScriptsTests, splitSrcTests } from "../test-env-split";

/** `vitest.config.ts` `resolve.alias`, repo-relative (pinned by its test). */
export const TEST_ALIASES: readonly ImportAlias[] = [
    { find: "~", replacement: "src" },
    { find: "@", replacement: "src" },
    { find: "@convex", replacement: "convex" },
];

/** The vitest projects a related test can belong to (bot, perf and ladder
 *  tests are none of them: ADR 0154 §3 sends the bot suite to health). */
export type RelatedProject = "node-engine" | "node-tooling" | "dom";

/** Related test files per vitest project, repo-relative, posix, sorted. */
export type RelatedTests = Record<RelatedProject, string[]>;

const MOCK_SPECIFIER = /\bvi\.(?:mock|doMock)\(\s*["']([^"'\n]+)["']/g;

/** A quoted file name with an extension the repo reads or spawns. */
const FILE_LITERAL =
    /["'`]([\w@./-]*?[\w-]+\.(?:tsx?|mjs|json|sh|md|txt|ya?ml|csv|css))["'`]/g;

/**
 * The file names `text` names as string literals in CODE, narrowed so a hub
 * module cannot drag half the suite in: comments are stripped (a doc comment
 * citing `card-utils.test.ts` in `src/lib/card-utils.ts` made 1,300 tests
 * "related" to that test file), a test file's name is never an input, and a
 * module name (`.ts`, `.tsx`, `.mjs`) counts only in a TEST file — the
 * spawn-by-path shape. Data and tooling inputs (`.json`, `.sh`, `.md`, …)
 * count in any module: their readers live in `scripts/lib/**`.
 */
export function fileNameLiterals(text: string, inTest: boolean): string[] {
    const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    const names = new Set<string>();
    for (const m of code.matchAll(FILE_LITERAL)) {
        const name = path.posix.basename(m[1]);
        if (/\.test\.[cm]?[jt]sx?$/.test(name)) continue;
        if (!inTest && /\.(tsx?|mjs)$/.test(name)) continue;
        names.add(name);
    }
    return [...names];
}

/** The node id every file-name literal of `basename` points at. */
const nameNode = (basename: string) => `name:${basename}`;

/** Module extensions a specifier may omit, and the index file it may name. */
const MODULE_SUFFIX = /(\.(tsx?|mjs|js))?$/;

/**
 * The extension-less identity of a repo-relative path: what an unresolvable
 * specifier keys on, and what a deleted changed path is matched by. A deleted
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

/** `*.test.ts(x)` outside the perf project. */
const isTest = (basename: string) =>
    /\.test\.tsx?$/.test(basename) && !/\.perf\.test\.tsx?$/.test(basename);
const isBot = (rel: string) => /\.bot\.test\.tsx?$/.test(rel);

/**
 * Every general test file with its vitest project, mirroring
 * `vitest.config.ts` (pinned file by file by `test-reach.test.ts`):
 * `convex/**\/*.test.ts` → `node-engine`; `scripts/**` by
 * `splitScriptsTests`; `src/**` by `splitSrcTests` (`.tsx` is always `dom`),
 * bot tests excluded; `dashboard/**` → `dom` WHOLE, bot-named files included —
 * `BOT_GLOB_DOM` excludes `src/**` only. Repo-relative, posix.
 */
export function generalTests(root: string): Map<string, RelatedProject> {
    const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
    const out = new Map<string, RelatedProject>();
    for (const f of collect(path.join(root, "convex"), isTest)) {
        const r = rel(f);
        if (r.endsWith(".test.ts") && !isBot(r)) out.set(r, "node-engine");
    }
    const scripts = splitScriptsTests(root);
    for (const f of scripts.engine) out.set(f, "node-engine");
    for (const f of scripts.tooling) out.set(f, "node-tooling");
    const srcNode = new Set(splitSrcTests(root).node);
    for (const f of collect(path.join(root, "src"), isTest)) {
        const r = rel(f);
        if (!isBot(r)) out.set(r, srcNode.has(r) ? "node-engine" : "dom");
    }
    for (const f of collect(path.join(root, "dashboard"), isTest))
        out.set(rel(f), "dom");
    return out;
}

/**
 * The walk's reusable half: every general test with its project, and a
 * memoised `importsOf` over repo-relative node ids — each module is read once
 * per index, however many diffs ask (`check-lane.test.ts` asks dozens).
 */
export interface ReachIndex {
    tests: Map<string, RelatedProject>;
    importsOf: (id: string) => readonly string[];
}

export function reachIndex(
    root: string,
    tests: Map<string, RelatedProject> = generalTests(root)
): ReachIndex {
    const fileCache = new Map<string, boolean>();
    const isFile = (rel: string): boolean => {
        let known = fileCache.get(rel);
        if (known === undefined) {
            try {
                known = fs.statSync(path.join(root, rel)).isFile();
            } catch {
                known = false;
            }
            fileCache.set(rel, known);
        }
        return known;
    };
    const memo = new Map<string, string[]>();
    const importsOf = (id: string): string[] => {
        const hit = memo.get(id);
        if (hit) return hit;
        const deps = new Set<string>();
        memo.set(id, []);
        if (/\.(tsx?|mjs|js|jsx)$/.test(id) && isFile(id)) {
            const text = fs.readFileSync(path.join(root, id), "utf8");
            const specifiers = [
                ...importSpecifiers(text),
                ...[...text.matchAll(MOCK_SPECIFIER)].map((m) => m[1]),
            ];
            for (const spec of specifiers) {
                const resolved = resolveSpecifier(
                    id,
                    spec,
                    TEST_ALIASES,
                    isFile
                );
                if (resolved !== null) deps.add(resolved);
                else {
                    const base = specifierBase(id, spec, TEST_ALIASES);
                    if (base !== null) deps.add(moduleKey(base));
                }
            }
            for (const name of fileNameLiterals(text, tests.has(id)))
                deps.add(nameNode(name));
        }
        const list = [...deps];
        memo.set(id, list);
        return list;
    };
    return { tests, importsOf };
}

/** The tests in `index` the `changed` (repo-relative) paths reach, per
 *  project. A changed path seeds itself, its extension-less key (a deletion)
 *  and its file name (a literal that names it). */
export function relatedTests(
    index: ReachIndex,
    changed: readonly string[]
): RelatedTests {
    const seeds = changed.flatMap((p) => [
        p,
        moduleKey(p),
        nameNode(path.posix.basename(p)),
    ]);
    const reached = reverseReach(
        [...index.tests.keys()],
        index.importsOf,
        seeds
    );
    const out: RelatedTests = {
        "node-engine": [],
        "node-tooling": [],
        dom: [],
    };
    for (const test of reached) out[index.tests.get(test)!].push(test);
    for (const list of Object.values(out)) list.sort();
    return out;
}
