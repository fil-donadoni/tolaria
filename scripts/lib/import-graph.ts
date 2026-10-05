/**
 * The static import graph of the client app, and the closure of one module
 * (issue #3627, PRD #3625 slice B).
 *
 * `check:ui` scopes its walk to the surfaces a diff can reach, and "can reach"
 * is answered here: a surface's rendered layout is a function of its route
 * module's import closure (plus global styling and deployment data, which the
 * scoper handles separately). A glob list would answer the same question and
 * rot the first time a component moved; the graph is re-derived from the
 * source on every run, so it cannot.
 *
 * WHAT IS FOLLOWED — the edges Vite itself follows when it builds the page:
 *   - static `import … from "x"`, `export … from "x"`, side-effect `import "x"`
 *     — but not `import type` / `export type`, which the build erases;
 *   - dynamic `import("x")` with a LITERAL specifier (the verdict quiz loads its
 *     builder that way — a non-literal specifier cannot be resolved statically
 *     and is ignored);
 *   - `new URL("x", import.meta.url)`, the form the Brain worker is spawned
 *     with;
 *   - relative specifiers, and the app's path aliases (`APP_ALIASES`, kept
 *     equal to `vite.config.ts` by `import-graph.test.ts`).
 *
 * Bare package specifiers resolve to nothing: `node_modules` is not a diff
 * this lane scopes. A Vite query suffix (`?worker`, `?url`) is dropped before
 * resolving.
 *
 * DELIBERATELY AN OVER-APPROXIMATION. Specifiers are found by pattern over the
 * raw source, so an import written inside a comment is followed too, and so is
 * a type-only import. Both can only ADD files to a closure — a larger closure
 * selects more surfaces, never fewer — so the error runs in the fail-closed
 * direction, which is the only direction a scoper may err in.
 */
import { readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

/**
 * One path alias, Vite semantics (`@rollup/plugin-alias`): a string `find`
 * matches the specifier itself or the specifier followed by `/`; a RegExp is
 * `specifier.replace(find, replacement)`. First match wins. `replacement` is
 * REPO-RELATIVE here, where the Vite config writes an absolute path.
 */
export interface ImportAlias {
    find: string | RegExp;
    replacement: string;
}

/** `vite.config.ts` `resolve.alias`, in the same order. */
export const APP_ALIASES: readonly ImportAlias[] = [
    { find: "~", replacement: "src" },
    { find: "@", replacement: "src" },
    { find: /^@convex\/cards$/, replacement: "convex/cards/client.ts" },
    { find: "@convex", replacement: "convex" },
    {
        find: /^\.\/compiledPool$/,
        replacement: "src/lib/catalogue/compiled-pool.browser.ts",
    },
];

const SPECIFIER_PATTERNS: readonly RegExp[] = [
    // import x from "y" · import { a, b } from "y" · export … from "y".
    // `import type … from` / `export type … from` are matched too (group 1)
    // and DROPPED: the statement is erased at build time, so no code of "y"
    // runs on the importer's account (issue #4913). A mixed `import { a,
    // type B }` keeps the edge — `a` is a runtime binding.
    /\b(?:import|export)\s+(type\s+)?[^'"`;]*?\bfrom\s*["']([^"'\n]+)["']/g,
    // import "y"
    /\bimport\s*["']([^"'\n]+)["']/g,
    // import("y")
    /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
    // new URL("y", import.meta.url)
    /\bnew\s+URL\(\s*["']([^"'\n]+)["']\s*,\s*import\.meta\.url\s*\)/g,
];

/** Every module specifier `source` names at RUNTIME, in no particular order,
 *  deduped — a type-only statement contributes nothing (`typeOnlySpecifiers`). */
export function importSpecifiers(source: string): string[] {
    return [...specifiersOf(source).runtime];
}

/** The specifiers `source` names ONLY in `import type` / `export type`
 *  statements: modules whose code never runs on `source`'s account, though a
 *  change to their types can still fail `check:ts`. A module named both ways
 *  is a runtime import and is not here. */
export function typeOnlySpecifiers(source: string): string[] {
    const { runtime, typeOnly } = specifiersOf(source);
    return [...typeOnly].filter((s) => !runtime.has(s));
}

function specifiersOf(source: string): {
    runtime: Set<string>;
    typeOnly: Set<string>;
} {
    const runtime = new Set<string>();
    const typeOnly = new Set<string>();
    for (const [i, pattern] of SPECIFIER_PATTERNS.entries()) {
        for (const match of source.matchAll(pattern)) {
            if (i !== 0) runtime.add(match[1]);
            else if (match[1] === undefined) runtime.add(match[2]);
            else typeOnly.add(match[2]);
        }
    }
    return { runtime, typeOnly };
}

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];

function applyAlias(
    specifier: string,
    aliases: readonly ImportAlias[]
): string | null {
    for (const { find, replacement } of aliases) {
        if (typeof find === "string") {
            if (specifier === find) return replacement;
            if (specifier.startsWith(`${find}/`)) {
                return replacement + specifier.slice(find.length);
            }
        } else if (find.test(specifier)) {
            return specifier.replace(find, replacement);
        }
    }
    return null;
}

/**
 * The repo-relative file `specifier` (written in `fromFile`) names, or `null`
 * for a bare package or a path that exists nowhere. `isFile` is injected so the
 * resolution rule is testable without a disk.
 */
export function resolveSpecifier(
    fromFile: string,
    specifier: string,
    aliases: readonly ImportAlias[],
    isFile: (repoPath: string) => boolean
): string | null {
    const bare = specifier.replace(/[?#].*$/, "");
    const aliased = applyAlias(bare, aliases);
    let base: string;
    if (aliased !== null) base = posix.normalize(aliased);
    else if (bare.startsWith("./") || bare.startsWith("../")) {
        base = posix.normalize(posix.join(posix.dirname(fromFile), bare));
    } else return null;
    if (base.startsWith("../")) return null;

    const candidates = [base, ...EXTENSIONS.map((ext) => base + ext)];
    // TypeScript ESM style: `./x.js` names `./x.ts`.
    const jsExt = /\.(jsx?)$/.exec(base);
    if (jsExt) {
        const stem = base.slice(0, -jsExt[0].length);
        candidates.push(`${stem}.ts`, `${stem}.tsx`);
    }
    candidates.push(...EXTENSIONS.map((ext) => `${base}/index${ext}`));
    return candidates.find(isFile) ?? null;
}

export interface ClosureOptions {
    /**
     * A file for which this returns true is neither included nor traversed
     * (the entry itself is never pruned). The scoper uses it to take the app
     * shell's closure WITHOUT descending into the route modules it mounts.
     */
    prune?: (repoPath: string) => boolean;
    /**
     * Follow type-only edges too (`typeImportsOf`). Off by default: the
     * closure is what RUNS. The scoper takes the type-inclusive closure once,
     * to tell a module nothing runs from a module nothing places (issue
     * #4913) — the first contributes no surface, the second forces FULL.
     */
    types?: boolean;
}

export interface ImportGraph {
    /** The files `repoPath` imports directly at runtime, resolved. */
    importsOf(repoPath: string): readonly string[];
    /** The files `repoPath` names only in type-only statements, resolved. */
    typeImportsOf(repoPath: string): readonly string[];
    /** `entry` plus every file reachable from it. */
    closureOf(entry: string, options?: ClosureOptions): Set<string>;
}

/** Where a graph reads files from: the disk under `root` by default, or any
 *  other tree (a git revision — `health-robustness-trigger.ts`, issue #5078). */
export interface ImportGraphSource {
    isFile(repoPath: string): boolean;
    readFile(repoPath: string): string;
}

export interface ImportGraphOptions {
    /** Absolute path every repo-relative path is resolved against. */
    root: string;
    aliases?: readonly ImportAlias[];
    /** Overrides the disk reads at `root`. */
    source?: ImportGraphSource;
}

/**
 * A lazily-built graph over the tree at `root`: a file is read the first time
 * a closure reaches it, and its edges are memoised for every later closure.
 */
export function createImportGraph({
    root,
    aliases = APP_ALIASES,
    source,
}: ImportGraphOptions): ImportGraph {
    const edges = new Map<string, readonly string[]>();
    const typeEdges = new Map<string, readonly string[]>();
    const fileCache = new Map<string, boolean>();

    const isFile = (repoPath: string): boolean => {
        let known = fileCache.get(repoPath);
        if (known === undefined) {
            try {
                known = source
                    ? source.isFile(repoPath)
                    : statSync(join(root, repoPath)).isFile();
            } catch {
                known = false;
            }
            fileCache.set(repoPath, known);
        }
        return known;
    };

    const read = (repoPath: string): void => {
        if (edges.has(repoPath)) return;
        let runtime: string[] = [];
        let typeOnly: string[] = [];
        if (isFile(repoPath) && !repoPath.endsWith(".json")) {
            const text = source
                ? source.readFile(repoPath)
                : readFileSync(join(root, repoPath), "utf8");
            const resolve = (specifiers: string[]) =>
                specifiers
                    .map((s) => resolveSpecifier(repoPath, s, aliases, isFile))
                    .filter((p): p is string => p !== null);
            runtime = resolve(importSpecifiers(text));
            typeOnly = resolve(typeOnlySpecifiers(text));
        }
        edges.set(repoPath, [...new Set(runtime)]);
        typeEdges.set(repoPath, [...new Set(typeOnly)]);
    };

    const importsOf = (repoPath: string): readonly string[] => {
        read(repoPath);
        return edges.get(repoPath)!;
    };

    const typeImportsOf = (repoPath: string): readonly string[] => {
        read(repoPath);
        return typeEdges.get(repoPath)!;
    };

    const closureOf = (entry: string, options: ClosureOptions = {}) => {
        const seen = new Set<string>([entry]);
        const queue = [entry];
        while (queue.length > 0) {
            const file = queue.pop()!;
            const nexts = options.types
                ? [...importsOf(file), ...typeImportsOf(file)]
                : importsOf(file);
            for (const next of nexts) {
                if (seen.has(next) || options.prune?.(next)) continue;
                seen.add(next);
                queue.push(next);
            }
        }
        return seen;
    };

    return { importsOf, typeImportsOf, closureOf };
}
