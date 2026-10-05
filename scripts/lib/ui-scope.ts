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
 *   - the `check:ui` lane itself (`scripts/ui-gate/**`: walks, probe, floors)
 *     → `full`: it changes what every surface's measurement means — EXCEPT
 *     `surfaces.ts`, whose hunks inside `SURFACES` elements select exactly the
 *     surfaces they edit (`ui-surface-edits.ts`, issue #4687); a hunk in a
 *     shared helper, selector or table there is still `full`;
 *   - in the BUILD configuration's closure (`vite.config.ts` and what it
 *     imports, e.g. `scripts/lib/build-define.ts`) → `full`: it shapes the
 *     bundle every route is served from;
 *   - NON-DOM (tests, scripts, markdown) → contributes nothing;
 *   - reachable from the shell, the build or a surface ONLY through
 *     `import type` / `export type` statements → contributes nothing: the
 *     build erases those, so no code of it runs on any screen (issue #4913;
 *     a type change that matters fails `check:ts`, not a walk);
 *   - GLOBAL (`globalReason`) → `full`;
 *   - in the app SHELL's closure (`src/main.tsx`, not descending into route
 *     modules) → `full`: the shell renders around every surface;
 *   - in one or more surfaces' closures → selects those surfaces;
 *   - in no closure at all, and SERVER-ONLY (`isServerOnlyPath`: `convex/**`
 *     or `data/**` outside `convex/_generated/`) → contributes nothing: the
 *     walk runs the tree's frontend against whatever functions the shared
 *     deployment serves, and never pushes Convex functions (ADR 0131
 *     amendment, issue #5074). A module the frontend DOES import is in a
 *     closure and was placed above;
 *   - in no closure at all, but reachable ONLY from a STAFF-ONLY route entry
 *     (`isStaffOnlyRouteEntry`: the admin pages, `/admin/draft-lab`) →
 *     contributes nothing: staff tooling is out of `check:ui`'s scope, so no
 *     surface walks it and its private modules must not force `full` (ADR 0131
 *     amendment, owner ruling issue #5075). A module an admin page SHARES with
 *     a product surface is in that surface's closure and was placed above;
 *   - otherwise → `full`.
 *
 * The tester debug sheet needs no rule of its own: `game.route.tsx` imports it,
 * so its whole subtree sits in the game surfaces' closures and a change there
 * still walks them (they render its edge toggle).
 *
 * A SURFACE'S CLOSURE is its route entries' import closure — except for a
 * SPECIMEN row (issue #4913). `/admin/design-system` mounts ~30 dialogs and
 * pickers one at a time behind openers, and every one of those rows declared
 * the page's route as its entry, so any file in that page's closure walked all
 * of them: PR #4911 changed one admin hook and paid 34 surfaces × 5 viewports.
 * A specimen row (`ScopeSurface.specimen`) is selected by the closure of what
 * it measures instead — three parts, each taken from the same graph:
 *   1. the PAGE scaffolding: its entries' closure, not descending into any
 *      specimen SECTION module (the frame every row shares — the layout, the
 *      census page's own controls);
 *   2. its SECTION's closure, not descending into any row's mount (the openers
 *      and fixture props of that section: a change there selects every row of
 *      the section, and no other section's);
 *   3. its own `mounts` closure — the module the probe photographs.
 * The soundness argument is re-made at this granularity in ADR 0131's
 * amendment; the residual it accepts (a mount a section renders
 * unconditionally, a sibling section's frame under an open layer) is what the
 * full `check:ui --all` walk in batch health exists to catch.
 *
 * An empty `scoped` result is valid: a test-only diff owes no browser time.
 *
 * ACCEPTED HOLE — Tailwind's class scan. `src/index.css` declares no `@source`,
 * so Tailwind v4 builds its utilities from class names found in every
 * non-ignored file. Deleting the LAST literal occurrence of a class from a
 * file outside a surface's closure (a test, another route) can drop a rule a
 * surface only ever assembles at runtime. A class written literally in the
 * surface's own components is in its closure and keeps the rule alive, so the
 * hole is limited to runtime-built class strings; it is recorded, not closed.
 */
import type { ImportGraph } from "./import-graph";
import type { SurfaceEdits } from "./ui-surface-edits";

/** The module that boots the app; its closure, minus route modules, is the shell. */
export const SHELL_ENTRY = "src/main.tsx";
/** The module that mounts every route. A surface entry must be one of its imports. */
export const ROUTER_MODULE = "src/router.tsx";
/** The build configuration; its closure shapes every route's bundle. */
export const BUILD_CONFIG = "vite.config.ts";
/** The lane's own walks, probe and floors. */
export const UI_GATE_DIR = "scripts/ui-gate/";
/** The one lane file that also holds per-surface definitions. */
export const SURFACES_FILE = "scripts/ui-gate/surfaces.ts";

/** A surface as the scoper sees it: an id, its declared route entry modules
 *  and, for a specimen row, what it measures (`Surface` in `surfaces.ts`). */
export interface ScopeSurface {
    id: string;
    entries: readonly string[];
    /** The modules on screen when the probe measures this surface. Read
     *  only for a specimen row; a route surface is its entries' closure. */
    mounts?: readonly string[];
    /** A specimen row (issue #4913): one `mounts` module opened from the
     *  page's `section` module. Scoped by mounts + section + page scaffolding,
     *  never by the whole route closure every row on that page shares. */
    specimen?: { readonly section: string };
}

export type UiScope =
    | { kind: "scoped"; surfaces: string[] }
    | { kind: "full"; reason: string };

/**
 * A route entry that is staff-only tooling (ADR 0131 amendment, issue #5075):
 * a page of the admin layout, except the design-system page — which lives
 * outside `src/routes/admin/` and stays walked, since its specimen rows are how
 * in-game dialogs and pickers are measured — plus `/admin/draft-lab`, mounted
 * under the same layout from a top-level route module. The layout module
 * itself frames the design-system page too, so it is not staff-only.
 */
export function isStaffOnlyRouteEntry(path: string): boolean {
    return (
        /^src\/routes\/admin\/(?!admin-layout\.)[^/]+\.route\.tsx$/.test(
            path
        ) || path === "src/routes/draft-lab.route.tsx"
    );
}

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

/** `data/` directories the client loads through `import.meta.glob` (`?url`,
 *  eager): the import graph follows no glob, so they sit in no closure yet
 *  ship the card data every screen renders. */
const GLOB_LOADED_DATA_DIRS = ["data/catalogue/", "data/full-catalogue/"];

/**
 * A path only the server or tooling reads: `convex/**` or `data/**`, minus
 * `convex/_generated/**` (the frontend imports `api` from it) and the
 * glob-loaded catalogue artifacts. Meaningful only for a path no closure
 * contains — the closure rules run first.
 */
export function isServerOnlyPath(path: string): boolean {
    if (path.startsWith("convex/_generated/")) return false;
    if (GLOB_LOADED_DATA_DIRS.some((dir) => path.startsWith(dir))) return false;
    return path.startsWith("convex/") || path.startsWith("data/");
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
    /** Which surfaces a diff to `SURFACES_FILE` edits, when the caller could
     *  derive it. Absent or `shared` keeps that file a full-lane path. */
    surfaceEdits?: SurfaceEdits | null;
}

export function computeUiScope({
    changed,
    surfaces,
    graph,
    surfaceEdits = null,
}: ComputeUiScopeInput): UiScope {
    const shell = graph.closureOf(SHELL_ENTRY, { prune: isRouteModulePath });
    const build = graph.closureOf(BUILD_CONFIG);
    const specimens = specimenIndex(surfaces);
    const closures = surfaces.map((surface) => ({
        id: surface.id,
        files: surfaceClosure(surface, graph, specimens),
    }));
    // A path the app names ONLY through type-only edges: in the type-inclusive
    // closure of the roots below and NOT in their runtime closure — taken
    // once, and only when a path lands in no surface's closure. The runtime
    // half is what keeps this fail-closed: the same roots reach, at runtime,
    // a route module no surface declares (the shell's closure is pruned at
    // route modules), and a file under such a route must still force FULL,
    // not read as "nothing runs it".
    let reach: { runtime: Set<string>; typed: Set<string> } | null = null;
    const typeOnlyReachable = (path: string): boolean => {
        if (reach === null) {
            const roots = [
                SHELL_ENTRY,
                BUILD_CONFIG,
                ...surfaces.flatMap((s) => [
                    ...s.entries,
                    ...(s.mounts ?? []),
                    ...(s.specimen ? [s.specimen.section] : []),
                ]),
            ];
            reach = { runtime: new Set(), typed: new Set() };
            for (const entry of roots) {
                for (const file of graph.closureOf(entry))
                    reach.runtime.add(file);
                for (const file of graph.closureOf(entry, { types: true }))
                    reach.typed.add(file);
            }
        }
        return reach.typed.has(path) && !reach.runtime.has(path);
    };

    // Everything the staff-only routes reach, type-only edges included — a
    // type change that matters fails `check:ts`, not a walk — MINUS whatever
    // any other router import reaches at runtime: a module an undeclared
    // (orphan) route also renders is walked by nothing and must stay `full`.
    // Built on first use, and only for a path no surface closure contains.
    let staffOnly: Set<string> | null = null;
    const staffOnlyReachable = (path: string): boolean => {
        if (staffOnly === null) {
            staffOnly = new Set();
            const other = new Set<string>();
            for (const entry of graph.importsOf(ROUTER_MODULE)) {
                if (isStaffOnlyRouteEntry(entry)) {
                    for (const file of graph.closureOf(entry, {
                        types: true,
                    })) {
                        staffOnly.add(file);
                    }
                } else {
                    for (const file of graph.closureOf(entry)) other.add(file);
                }
            }
            for (const file of other) staffOnly.delete(file);
        }
        return staffOnly.has(path);
    };

    const selected = new Set<string>();
    for (const path of [...changed].sort()) {
        if (path === SURFACES_FILE && surfaceEdits?.kind === "surfaces") {
            for (const id of surfaceEdits.ids) selected.add(id);
            continue;
        }
        if (path.startsWith(UI_GATE_DIR)) {
            return {
                kind: "full",
                reason: `${path} is the check:ui lane itself (walks, probe, floors)${
                    path === SURFACES_FILE && surfaceEdits?.kind === "shared"
                        ? ` — ${surfaceEdits.reason}`
                        : ""
                }`,
            };
        }
        if (build.has(path)) {
            return {
                kind: "full",
                reason: `${path} is in the build configuration's closure (${BUILD_CONFIG})`,
            };
        }
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
            if (typeOnlyReachable(path)) continue;
            if (staffOnlyReachable(path)) continue;
            if (isServerOnlyPath(path)) continue;
            return {
                kind: "full",
                reason: `${path} is in no surface's closure and no rule places it`,
            };
        }
        for (const hit of hits) selected.add(hit.id);
    }
    return {
        kind: "scoped",
        surfaces: surfaces.map((s) => s.id).filter((id) => selected.has(id)),
    };
}

/** Every specimen section module, and the union of the mounts its rows open. */
interface SpecimenIndex {
    sections: ReadonlySet<string>;
    mountsBySection: ReadonlyMap<string, ReadonlySet<string>>;
}

function specimenIndex(surfaces: readonly ScopeSurface[]): SpecimenIndex {
    const sections = new Set<string>();
    const mountsBySection = new Map<string, Set<string>>();
    for (const surface of surfaces) {
        if (!surface.specimen) continue;
        const { section } = surface.specimen;
        sections.add(section);
        const mounts = mountsBySection.get(section) ?? new Set<string>();
        for (const mount of surface.mounts ?? []) mounts.add(mount);
        mountsBySection.set(section, mounts);
    }
    return { sections, mountsBySection };
}

/**
 * The files a change to which can move `surface`'s measurement: its entries'
 * closure, or — for a specimen row — the three-part closure the header
 * describes (page scaffolding, its section, its own mounts).
 */
function surfaceClosure(
    surface: ScopeSurface,
    graph: ImportGraph,
    { sections, mountsBySection }: SpecimenIndex
): Set<string> {
    const files = new Set<string>();
    const add = (closure: Iterable<string>) => {
        for (const file of closure) files.add(file);
    };
    if (!surface.specimen) {
        for (const entry of surface.entries) add(graph.closureOf(entry));
        return files;
    }
    const { section } = surface.specimen;
    for (const entry of surface.entries) {
        add(graph.closureOf(entry, { prune: (p) => sections.has(p) }));
    }
    const rowMounts = mountsBySection.get(section) ?? new Set<string>();
    add(graph.closureOf(section, { prune: (p) => rowMounts.has(p) }));
    for (const mount of surface.mounts ?? []) add(graph.closureOf(mount));
    return files;
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
