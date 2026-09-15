/**
 * Which `check:ui` surfaces a diff can reach (issue #3627, PRD #3625 slice B).
 *
 * THE ARGUMENT. A surface's rendered layout is a function of three inputs:
 *   1. its route module's import closure — scoped EXACTLY, by `import-graph.ts`;
 *   2. the global styling inputs (stylesheets, design tokens, shared UI
 *      primitives, the shell every route renders inside) — which always force
 *      the full run, because they can move every surface;
 *   3. deployment data — pinned by the per-run lane account (issue #3626).
 *
 * FAIL-CLOSED, like `check:lane`'s `classifyPath`: a changed path narrows the
 * run only when a rule affirmatively places it. Anything no rule places and no
 * entry closure contains forces `full`. "Unknown" means "run everything".
 *
 * A path is placed, in this order:
 *   - NON-DOM (tests, scripts, markdown) → contributes nothing;
 *   - GLOBAL (`globalReason`) → `full`;
 *   - in the app SHELL's closure (`src/main.tsx`, not descending into route
 *     modules) → `full`: the shell renders around every surface;
 *   - in one or more surfaces' entry closures → selects those surfaces;
 *   - otherwise → `full`.
 *
 * An empty `scoped` result is valid: a test-only diff owes no browser time.
 */
import type { ImportGraph } from "./import-graph";

/** The module that boots the app; its closure, minus route modules, is the shell. */
export const SHELL_ENTRY = "src/main.tsx";
/** The module that mounts every route. A surface entry must be one of its imports. */
export const ROUTER_MODULE = "src/router.tsx";

/** A surface as the scoper sees it: an id and its declared route entry modules. */
export interface ScopeSurface {
    id: string;
    entries: readonly string[];
}

export type UiScope =
    | { kind: "scoped"; surfaces: string[] }
    | { kind: "full"; reason: string };

/** `src/routes/**\/*.route.tsx` — the naming the router's route modules carry. */
export function isRouteModulePath(path: string): boolean {
    return /^src\/routes\/(?:[^/]+\/)*[^/]+\.route\.tsx$/.test(path);
}

/** Paths that cannot reach the DOM at all. Anchored narrowly on purpose. */
export function isNonDomPath(path: string): boolean {
    return (
        /(?:^|\/)__tests__\//.test(path) ||
        /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) ||
        /^scripts\//.test(path) ||
        /\.md$/.test(path)
    );
}

/**
 * Why `path` can move every surface, or `null`. These are the inputs no import
 * closure accounts for (a stylesheet is applied by the cascade, a public asset
 * by URL) or that every route shares by construction.
 */
export function globalReason(path: string): string | null {
    if (path === "index.html") return "the HTML document every route loads";
    if (path.startsWith("public/")) return "a public asset, served by URL";
    if (/\.css$/.test(path)) return "a stylesheet";
    if (path === "src/lib/design-tokens.ts") return "a design-token source";
    if (path.startsWith("src/components/ui/")) return "a shared UI primitive";
    if (path === SHELL_ENTRY || path === "src/app-router.tsx") {
        return "the app shell";
    }
    if (path === ROUTER_MODULE) return "the router";
    return null;
}

export interface ComputeUiScopeInput {
    changed: readonly string[];
    surfaces: readonly ScopeSurface[];
    graph: ImportGraph;
}

export function computeUiScope({
    changed,
    surfaces,
    graph,
}: ComputeUiScopeInput): UiScope {
    const shell = graph.closureOf(SHELL_ENTRY, { prune: isRouteModulePath });
    const closures = surfaces.map((surface) => {
        const files = new Set<string>();
        for (const entry of surface.entries) {
            for (const file of graph.closureOf(entry)) files.add(file);
        }
        return { id: surface.id, files };
    });

    const selected = new Set<string>();
    for (const path of [...changed].sort()) {
        if (isNonDomPath(path)) continue;
        const global = globalReason(path);
        if (global) return { kind: "full", reason: `${path} is ${global}` };
        if (shell.has(path)) {
            return {
                kind: "full",
                reason: `${path} is imported by the app shell (${SHELL_ENTRY}) outside any route module`,
            };
        }
        const hits = closures.filter((c) => c.files.has(path));
        if (hits.length === 0) {
            return {
                kind: "full",
                reason: `${path} is in no surface's entry closure and no rule places it`,
            };
        }
        for (const hit of hits) selected.add(hit.id);
    }
    return {
        kind: "scoped",
        surfaces: surfaces.map((s) => s.id).filter((id) => selected.has(id)),
    };
}

/** The lines `check:ui` prints at the start of every run. */
export function renderUiScope(scope: UiScope, base: string): string {
    const head = `scope (diff base ${base}):`;
    if (scope.kind === "full") return `${head} FULL — ${scope.reason}`;
    if (scope.surfaces.length === 0) {
        return `${head} SCOPED — 0 surfaces (nothing in this diff reaches a walked route)`;
    }
    return [
        `${head} SCOPED — ${scope.surfaces.length} surface(s)`,
        ...scope.surfaces.map((id) => `  · ${id}`),
    ].join("\n");
}
