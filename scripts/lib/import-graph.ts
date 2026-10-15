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
 *   - dynamic `import(\`./dir/${x}/file.ts\`)` with a TEMPLATE specifier, the
 *     way Vite's dynamic-import-vars reads it: each `${…}` is one path
 *     segment's wildcard, and the edge fans out to every file the pattern
 *     matches on disk (the per-Set chunk loader, issue #5615 — one Set file
 *     per directory under `convex/cards/sets/`). A `source` with no `listDir`
 *     cannot expand it and follows nothing there;
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
import { readdirSync, readFileSync, statSync } from "node:fs";
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

/**
 * An importer-specific substitution: `importer` writing `specifier` gets
 * `replacement`, as a Vite `resolveId` plugin does in the browser build. Not
 * an alias — the same specifier from any other importer resolves normally.
 */
export interface ImportSeam {
    importer: string;
    specifier: string;
    replacement: string;
}

/**
 * `vite.config.ts`'s importer-specific seams (its `formats-cards-browser-seam`
 * plugin, issue #4854): the browser build gives `convex/formats.ts` a
 * catalogue-free stand-in for `./cards`. OPT-IN (`ImportGraphOptions.seams`):
 * the scoper's graph keeps the server edge, an over-approximation in the
 * fail-closed direction; a guard on what a browser route LOADS passes these.
 */
export const BROWSER_SEAMS: readonly ImportSeam[] = [
    {
        importer: "convex/formats.ts",
        specifier: "./cards",
        replacement: "src/lib/catalogue/deck-card-meta.browser.ts",
    },
];

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
    // Issue #5615 — the hand-written half of the same asymmetry.
    {
        find: /^\.\/setModules$/,
        replacement: "src/lib/catalogue/set-modules.browser.ts",
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
    // import(`./y/${z}.ts`) — the specifier is kept with each `${…}` as `*`.
    /\bimport\s*\(\s*`([^`\n]+)`\s*\)/g,
    // new URL("y", import.meta.url)
    /\bnew\s+URL\(\s*["']([^"'\n]+)["']\s*,\s*import\.meta\.url\s*\)/g,
];

/** The wildcard a template specifier's `${…}` becomes (Vite's
 *  dynamic-import-vars): one path segment, never crossing a `/`. */
const TEMPLATE_WILDCARD = "*";

/** Whether `specifier` is a template pattern to fan out (`expandPattern`). */
export function isPatternSpecifier(specifier: string): boolean {
    return specifier.includes(TEMPLATE_WILDCARD);
}

/** Every module specifier `source` names at RUNTIME, in no particular order,
 *  deduped — a type-only statement contributes nothing (`typeOnlySpecifiers`). */
export function importSpecifiers(source: string): string[] {
    return [...specifiersOf(source).runtime];
}

/** The runtime specifiers `source` names STATICALLY — `import … from`,
 *  `export … from`, side-effect `import "x"` — leaving out `import("x")` and
 *  `new URL("x", import.meta.url)`, which load later, on demand. What a module
 *  costs the moment it is evaluated (issue #5584). */
export function staticImportSpecifiers(source: string): string[] {
    return [...specifiersOf(source).static];
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
    static: Set<string>;
    typeOnly: Set<string>;
} {
    const runtime = new Set<string>();
    const statics = new Set<string>();
    const typeOnly = new Set<string>();
    for (const [i, pattern] of SPECIFIER_PATTERNS.entries()) {
        for (const match of source.matchAll(pattern)) {
            if (i === 0 && match[1] !== undefined) {
                typeOnly.add(match[2]);
                continue;
            }
            let specifier = i === 0 ? match[2] : match[1];
            if (i === 3) {
                // A template with no `${…}` is a plain literal; one with any
                // is a pattern — relative only, as Vite requires of it.
                specifier = specifier.replaceAll(
                    /\$\{[^}]*\}/g,
                    TEMPLATE_WILDCARD
                );
                if (
                    isPatternSpecifier(specifier) &&
                    !specifier.startsWith("./") &&
                    !specifier.startsWith("../")
                )
                    continue;
            }
            runtime.add(specifier);
            // Patterns 0 and 1 are the static forms; 2, 3 and 4 load on demand.
            if (i <= 1) statics.add(specifier);
        }
    }
    return { runtime, static: statics, typeOnly };
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
    const base = specifierBase(fromFile, specifier, aliases);
    if (base === null) return null;

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

/**
 * The repo-relative location a LOCAL specifier names before any extension or
 * `index` probing — query suffix dropped, alias applied — or `null` for a bare
 * package or a path above the repo. `resolveSpecifier` probes from here; a
 * caller that must match a file the specifier names even when it no longer
 * exists (a deletion, `lib/test-reach.ts`) keys on it directly.
 */
export function specifierBase(
    fromFile: string,
    specifier: string,
    aliases: readonly ImportAlias[]
): string | null {
    const bare = specifier.replace(/[?#].*$/, "");
    const aliased = applyAlias(bare, aliases);
    let base: string;
    if (aliased !== null) base = posix.normalize(aliased);
    else if (bare.startsWith("./") || bare.startsWith("../")) {
        base = posix.normalize(posix.join(posix.dirname(fromFile), bare));
    } else return null;
    return base.startsWith("../") ? null : base;
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
    /**
     * Follow STATIC edges only (`staticImportSpecifiers`): no `import()`, no
     * `new URL(…, import.meta.url)`. The closure is then what loads the
     * moment the entry is evaluated, not what it may load later (issue #5584).
     */
    staticOnly?: boolean;
}

export interface ImportGraph {
    /** The files `repoPath` imports directly at runtime, resolved. */
    importsOf(repoPath: string): readonly string[];
    /** The files `repoPath` names only in type-only statements, resolved. */
    typeImportsOf(repoPath: string): readonly string[];
    /** The files `repoPath` imports STATICALLY at runtime, resolved. */
    staticImportsOf(repoPath: string): readonly string[];
    /** `entry` plus every file reachable from it. */
    closureOf(entry: string, options?: ClosureOptions): Set<string>;
}

/** Where a graph reads files from: the disk under `root` by default, or any
 *  other tree (a git revision — `health-robustness-trigger.ts`, issue #5078). */
export interface ImportGraphSource {
    isFile(repoPath: string): boolean;
    readFile(repoPath: string): string;
    /** The entries of a directory, or `[]` for none. Without it a template
     *  `import(\`…${x}…\`)` fans out to nothing. */
    listDir?(repoPath: string): readonly string[];
}

/**
 * Every existing file the repo-relative pattern `base` names — a `*`
 * segment matching one directory entry (Vite's dynamic-import-vars) — in
 * no particular order.
 */
export function expandPattern(
    base: string,
    listDir: (repoPath: string) => readonly string[],
    isFile: (repoPath: string) => boolean
): string[] {
    const segments = base.split("/");
    let partials = [""];
    for (const [i, segment] of segments.entries()) {
        const last = i === segments.length - 1;
        const next: string[] = [];
        for (const partial of partials) {
            const names = segment.includes(TEMPLATE_WILDCARD)
                ? listDir(partial === "" ? "." : partial).filter((name) =>
                      segmentMatcher(segment).test(name)
                  )
                : [segment];
            for (const name of names) {
                const path = partial === "" ? name : `${partial}/${name}`;
                if (!last || isFile(path)) next.push(path);
            }
        }
        partials = next;
    }
    return partials;
}

function segmentMatcher(segment: string): RegExp {
    const escaped = segment
        .split(TEMPLATE_WILDCARD)
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*");
    return new RegExp(`^${escaped}$`);
}

export interface ImportGraphOptions {
    /** Absolute path every repo-relative path is resolved against. */
    root: string;
    aliases?: readonly ImportAlias[];
    /** Overrides the disk reads at `root`. */
    source?: ImportGraphSource;
    /** Importer-specific substitutions (`BROWSER_SEAMS`). None by default. */
    seams?: readonly ImportSeam[];
}

/**
 * A lazily-built graph over the tree at `root`: a file is read the first time
 * a closure reaches it, and its edges are memoised for every later closure.
 */
export function createImportGraph({
    root,
    aliases = APP_ALIASES,
    source,
    seams = [],
}: ImportGraphOptions): ImportGraph {
    const edges = new Map<string, readonly string[]>();
    const staticEdges = new Map<string, readonly string[]>();
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

    const listDir = (repoPath: string): readonly string[] => {
        try {
            if (source) return source.listDir?.(repoPath) ?? [];
            return readdirSync(join(root, repoPath));
        } catch {
            return [];
        }
    };

    const read = (repoPath: string): void => {
        if (edges.has(repoPath)) return;
        let runtime: string[] = [];
        let statics: string[] = [];
        let typeOnly: string[] = [];
        if (isFile(repoPath) && !repoPath.endsWith(".json")) {
            const text = source
                ? source.readFile(repoPath)
                : readFileSync(join(root, repoPath), "utf8");
            const resolve = (specifiers: string[]) =>
                specifiers
                    .flatMap((s) => {
                        if (isPatternSpecifier(s)) {
                            const base = specifierBase(repoPath, s, aliases);
                            return base === null
                                ? []
                                : expandPattern(base, listDir, isFile);
                        }
                        return [
                            seams.find(
                                (seam) =>
                                    seam.importer === repoPath &&
                                    seam.specifier === s
                            )?.replacement ??
                                resolveSpecifier(repoPath, s, aliases, isFile),
                        ];
                    })
                    .filter((p): p is string => p !== null);
            runtime = resolve(importSpecifiers(text));
            statics = resolve(staticImportSpecifiers(text));
            typeOnly = resolve(typeOnlySpecifiers(text));
        }
        edges.set(repoPath, [...new Set(runtime)]);
        staticEdges.set(repoPath, [...new Set(statics)]);
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

    const staticImportsOf = (repoPath: string): readonly string[] => {
        read(repoPath);
        return staticEdges.get(repoPath)!;
    };

    const closureOf = (entry: string, options: ClosureOptions = {}) => {
        const seen = new Set<string>([entry]);
        const queue = [entry];
        while (queue.length > 0) {
            const file = queue.pop()!;
            const runtime = options.staticOnly
                ? staticImportsOf(file)
                : importsOf(file);
            const nexts = options.types
                ? [...runtime, ...typeImportsOf(file)]
                : runtime;
            for (const next of nexts) {
                if (seen.has(next) || options.prune?.(next)) continue;
                seen.add(next);
                queue.push(next);
            }
        }
        return seen;
    };

    return { importsOf, typeImportsOf, staticImportsOf, closureOf };
}
