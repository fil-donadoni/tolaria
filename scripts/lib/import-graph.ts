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
 *   - static `import … from "x"`, `export … from "x"`, side-effect `import "x"`;
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
    // import x from "y" · import { a, b } from "y" · import type … · export … from "y"
    /\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\bfrom\s*["']([^"'\n]+)["']/g,
    // import "y"
    /\bimport\s*["']([^"'\n]+)["']/g,
    // import("y")
    /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
    // new URL("y", import.meta.url)
    /\bnew\s+URL\(\s*["']([^"'\n]+)["']\s*,\s*import\.meta\.url\s*\)/g,
];

/** Every module specifier `source` names, in no particular order, deduped. */
export function importSpecifiers(source: string): string[] {
    const out = new Set<string>();
    for (const pattern of SPECIFIER_PATTERNS) {
        for (const match of source.matchAll(pattern)) out.add(match[1]);
    }
    return [...out];
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
}

export interface ImportGraph {
    /** The files `repoPath` imports directly, resolved. */
    importsOf(repoPath: string): readonly string[];
    /** `entry` plus every file reachable from it. */
    closureOf(entry: string, options?: ClosureOptions): Set<string>;
}

export interface ImportGraphOptions {
    /** Absolute path every repo-relative path is resolved against. */
    root: string;
    aliases?: readonly ImportAlias[];
}

/**
 * A lazily-built graph over the tree at `root`: a file is read the first time
 * a closure reaches it, and its edges are memoised for every later closure.
 */
export function createImportGraph({
    root,
    aliases = APP_ALIASES,
}: ImportGraphOptions): ImportGraph {
    const edges = new Map<string, readonly string[]>();
    const fileCache = new Map<string, boolean>();

    const isFile = (repoPath: string): boolean => {
        let known = fileCache.get(repoPath);
        if (known === undefined) {
            try {
                known = statSync(join(root, repoPath)).isFile();
            } catch {
                known = false;
            }
            fileCache.set(repoPath, known);
        }
        return known;
    };

    const importsOf = (repoPath: string): readonly string[] => {
        const cached = edges.get(repoPath);
        if (cached) return cached;
        let resolved: string[] = [];
        if (isFile(repoPath) && !repoPath.endsWith(".json")) {
            const source = readFileSync(join(root, repoPath), "utf8");
            resolved = importSpecifiers(source)
                .map((s) => resolveSpecifier(repoPath, s, aliases, isFile))
                .filter((p): p is string => p !== null);
        }
        const unique = [...new Set(resolved)];
        edges.set(repoPath, unique);
        return unique;
    };

    const closureOf = (entry: string, options: ClosureOptions = {}) => {
        const seen = new Set<string>([entry]);
        const queue = [entry];
        while (queue.length > 0) {
            const file = queue.pop()!;
            for (const next of importsOf(file)) {
                if (seen.has(next) || options.prune?.(next)) continue;
                seen.add(next);
                queue.push(next);
            }
        }
        return seen;
    };

    return { importsOf, closureOf };
}
