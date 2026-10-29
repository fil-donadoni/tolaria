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
 *     modules nor the catalogue gate) → `full`: the shell renders around
 *     every surface;
 *   - reached from the shell only through the CATALOGUE GATE (the lazy chunk
 *     that loads the catalogue into the card registry, issue #5379) → selects
 *     every surface that reads that registry, or `full` if none does;
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
 *      SECTION module of the page — a specimen section, or a sibling module
 *      named like one (`sections-*.tsx` beside `sections-overlays.tsx`):
 *      the frame every row shares is the layout and the census page's own
 *      controls, never the swatches another section renders (issue #6073);
 *   2. its SECTION's closure, not descending into any row's mount (the openers
 *      and fixture props of that section: a change there selects every row of
 *      the section, and no other section's);
 *   3. its own `mounts` closure — the module the probe photographs.
 * The soundness argument is re-made at this granularity in ADR 0131's
 * amendment; the residual it accepts (a mount a section renders
 * unconditionally, a sibling section's frame under an open layer) only the
 * full `check:ui --all` walk sees — run by hand since issue #6143, with no
 * automated backstop.
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
/** The loading gate the shell mounts, as a lazy chunk, around every route
 *  that is not a `lightSurface`; it fetches the catalogue into the registry. */
export const CATALOGUE_GATE = "src/components/ui/catalogue-gate.tsx";
/** The card registry the gate fills: the only way a surface reads what the
 *  gate loads. */
export const CARD_REGISTRY = "convex/cards/registry.ts";
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

/**
 * Three outcomes (issue #6144). `full` is CERTAINTY: the path is a global input
 * (a stylesheet, the shell, the build config, the lane's own tooling) and every
 * surface can move. `undecided` is DOUBT: no rule places the path, or the
 * scope could not be computed — a question a person answers in seconds, which
 * a 9–22 minute walk must not answer by default. Neither walks anything on its
 * own: `check:ui` prints the impact / the doubt and exits
 * `UI_SCOPE_UNDECIDED_EXIT`; only `--all` or `--surface=` spends browser time.
 */
export type UiScope =
    | { kind: "scoped"; surfaces: string[] }
    | { kind: "full"; reason: string }
    | { kind: "undecided"; reasons: string[] };

/** `check:ui`'s exit when the scope is full or undecided and nobody chose a
 *  walk (issue #6144): nothing ran, no browser started. Distinct from 0–4
 *  and from `MACHINE_SATURATED_EXIT`. */
export const UI_SCOPE_UNDECIDED_EXIT = 5;

/** The AFK marker: the driver (`loop-drain.sh`) and an `afk-pass` job each
 *  set one; `session-origin` reads the first (issue #3144). */
export function isAfkSession(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.TOLARIA_LOOP_DRAIN) || env.GITHUB_ACTIONS === "true";
}

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
        // The headless self-play harness: run by scripts and bot tests, imported
        // by no route (issue #6941).
        path.startsWith("src/lib/ai/selfplay/") ||
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

/** What renders around every surface: the shell entry's runtime closure, not
 *  descending into route modules nor into the lazily-loaded catalogue gate,
 *  which `computeUiScope` places on its own. */
export function shellClosure(graph: ImportGraph): Set<string> {
    return graph.closureOf(SHELL_ENTRY, {
        prune: (p) => isRouteModulePath(p) || p === CATALOGUE_GATE,
    });
}

export interface ComputeUiScopeInput {
    changed: readonly string[];
    surfaces: readonly ScopeSurface[];
    graph: ImportGraph;
    /** Which surfaces a diff to `SURFACES_FILE` edits, when the caller could
     *  derive it. Absent or `shared` keeps that file a full-lane path. */
    surfaceEdits?: SurfaceEdits | null;
}

/** A JS/TS module: what an `import` names, so what `tsc` resolves. */
const MODULE_PATH = /\.(?:[cm]?[jt]sx?)$/;

/** Does a DELETED path — a changed path missing from the graph's tree, so
 *  deleted or renamed away by the diff — need no placement of its own (owner
 *  rule, issue #7459)? A deleted module is in no closure, so it would always read as a
 *  doubt; but every module that imported it must change in the same diff or
 *  `tsc` fails on the dangling import (`check:lane` runs it), and THOSE
 *  importers are placed by their own closures. So the surfaces it reached are
 *  selected through its importers, and a module nothing imported reached
 *  none.
 *
 *  Fail-closed wherever that premise breaks — the path stays a doubt:
 *   - not a JS/TS module: an asset or stylesheet is named by a string `tsc`
 *     never resolves (an `import.meta.glob`, too, names only data artefacts
 *     today, which this excludes);
 *   - a declaration file (`.d.ts`): ambient, imported by no specifier;
 *   - a SIBLING still resolves the same specifier (`foo.ts` deleted beside
 *     `foo/index.ts` or `foo.tsx`): every importer compiles unchanged and now
 *     runs a different module;
 *   - a template `import()` pattern can name it: that edge is in no
 *     importer's text. */
export function placedThroughImporters(
    path: string,
    graph: ImportGraph
): boolean {
    return (
        MODULE_PATH.test(path) &&
        !path.endsWith(".d.ts") &&
        !graph.isFile(path) &&
        !siblingResolves(path, graph) &&
        !graph.namedByPattern(path)
    );
}

const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/** Whether another file still answers the specifier `path` was resolved
 *  from: `stem.<ext>`, `stem/index.<ext>`, and — for `dir/index.<ext>` —
 *  `dir.<ext>`. */
function siblingResolves(path: string, graph: ImportGraph): boolean {
    const stem = path.replace(MODULE_PATH, "");
    const stems = [stem, `${stem}/index`];
    if (stem.endsWith("/index")) stems.push(stem.slice(0, -"/index".length));
    return stems.some((s) =>
        MODULE_EXTENSIONS.some((ext) => graph.isFile(`${s}${ext}`))
    );
}

export function computeUiScope({
    changed,
    surfaces,
    graph,
    surfaceEdits = null,
}: ComputeUiScopeInput): UiScope {
    const shell = shellClosure(graph);
    const build = graph.closureOf(BUILD_CONFIG);
    const specimens = specimenIndex(surfaces);
    const closures = surfaces.map((surface) => ({
        id: surface.id,
        files: surfaceClosure(surface, graph, specimens),
    }));
    // What only the catalogue gate reaches (issue #5379): the catalogue it
    // loads into the registry. A surface observes it solely by reading that
    // registry, and a load that breaks breaks every gated surface alike — so
    // the registry's readers carry it, and with no reader it stays `full`.
    const gateOnly = graph.closureOf(CATALOGUE_GATE);
    for (const file of shell) gateOnly.delete(file);
    const registryReaders = closures
        .filter((c) => c.files.has(CARD_REGISTRY))
        .map((c) => c.id);
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
    // DOUBT, collected: a certain-global path later in the diff still wins.
    const doubts: string[] = [];
    for (const path of [...changed].sort()) {
        if (path === SURFACES_FILE && surfaceEdits?.kind === "surfaces") {
            for (const id of surfaceEdits.ids) selected.add(id);
            continue;
        }
        if (
            path === SURFACES_FILE &&
            surfaceEdits?.kind === "shared" &&
            surfaceEdits.unreadable
        ) {
            doubts.push(`${path}: ${surfaceEdits.reason}`);
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
        if (gateOnly.has(path)) {
            if (registryReaders.length === 0) {
                doubts.push(
                    `${path} is loaded by the catalogue gate (${CATALOGUE_GATE}) and no surface reads ${CARD_REGISTRY}`
                );
                continue;
            }
            for (const id of registryReaders) selected.add(id);
        }
        if (hits.length === 0) {
            if (gateOnly.has(path)) continue;
            if (typeOnlyReachable(path)) continue;
            if (staffOnlyReachable(path)) continue;
            if (isServerOnlyPath(path)) continue;
            if (placedThroughImporters(path, graph)) continue;
            doubts.push(
                `${path} is in no surface's closure and no rule places it`
            );
            continue;
        }
        for (const hit of hits) selected.add(hit.id);
    }
    if (doubts.length > 0) return { kind: "undecided", reasons: doubts };
    return {
        kind: "scoped",
        surfaces: surfaces.map((s) => s.id).filter((id) => selected.has(id)),
    };
}

/** Whether a module is a SECTION of a specimen page — a specimen section, or
 *  a sibling named like one — and the union of the mounts each specimen
 *  section's rows open. */
interface SpecimenIndex {
    isPageSection: (path: string) => boolean;
    mountsBySection: ReadonlyMap<string, ReadonlySet<string>>;
}

/** `src/routes/design-system/sections-overlays.tsx` → the family every
 *  `src/routes/design-system/sections-*` module belongs to: its directory and
 *  the basename up to and including the first `-`. The convention assumes a
 *  specimen section's stem names sections only: a section named `use-foo.tsx`
 *  would prune every `use-*` sibling from its rows' scaffolding. */
function sectionFamily(path: string): string {
    const slash = path.lastIndexOf("/");
    const dash = path.indexOf("-", slash + 1);
    return dash === -1 ? path : path.slice(0, dash + 1);
}

function specimenIndex(surfaces: readonly ScopeSurface[]): SpecimenIndex {
    const sections = new Set<string>();
    const families = new Set<string>();
    const mountsBySection = new Map<string, Set<string>>();
    for (const surface of surfaces) {
        if (!surface.specimen) continue;
        const { section } = surface.specimen;
        sections.add(section);
        families.add(sectionFamily(section));
        const mounts = mountsBySection.get(section) ?? new Set<string>();
        for (const mount of surface.mounts ?? []) mounts.add(mount);
        mountsBySection.set(section, mounts);
    }
    return {
        isPageSection: (p) => sections.has(p) || families.has(sectionFamily(p)),
        mountsBySection,
    };
}

/**
 * The files a change to which can move `surface`'s measurement: its entries'
 * closure, or — for a specimen row — the three-part closure the header
 * describes (page scaffolding, its section, its own mounts).
 */
function surfaceClosure(
    surface: ScopeSurface,
    graph: ImportGraph,
    { isPageSection, mountsBySection }: SpecimenIndex
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
        add(graph.closureOf(entry, { prune: isPageSection }));
    }
    const rowMounts = mountsBySection.get(section) ?? new Set<string>();
    add(graph.closureOf(section, { prune: (p) => rowMounts.has(p) }));
    for (const mount of surface.mounts ?? []) add(graph.closureOf(mount));
    return files;
}

/** Seconds one surface × viewport cell costs, the per-cell figure the impact
 *  estimate multiplies. Derived from the measured uncontended full receipt
 *  (27–30 min over ~155 cells, `ui-gate/phase-timing.ts`): an ESTIMATE, and
 *  printed as one. */
export const ESTIMATED_CELL_SECONDS = 11;

/** What walking `surfaceIds` at `viewportCount` viewports would cost. */
export function walkImpact(
    surfaceIds: readonly string[],
    viewportCount: number
): { surfaces: number; cells: number; minutes: number } {
    const cells = surfaceIds.length * viewportCount;
    return {
        surfaces: surfaceIds.length,
        cells,
        minutes: Math.round((cells * ESTIMATED_CELL_SECONDS) / 60),
    };
}

/** The lines `check:ui` prints when it starts no browser on a `full` or
 *  `undecided` scope (issue #6144): the question, the impact, the ways out. */
export function renderScopeDecision(
    scope: Exclude<UiScope, { kind: "scoped" }>,
    surfaceIds: readonly string[],
    viewportCount: number,
    afk: boolean
): string {
    const impact = walkImpact(surfaceIds, viewportCount);
    const what =
        scope.kind === "full"
            ? `FULL (${scope.reason})`
            : `UNDECIDED (${scope.reasons.join("; ")})`;
    const cost = `walking everything = ${impact.surfaces} surfaces × ${viewportCount} viewports = ${impact.cells} cells, ~${impact.minutes} min (estimated, ${ESTIMATED_CELL_SECONDS}s/cell)`;
    const lines = [`check:ui: ${what} — no browser started`, `  ${cost}`];
    if (afk) {
        lines.push(
            `  AFK pass: walk nothing; the PR body states \`check:ui: scope undecided, not walked (${scope.kind === "full" ? scope.reason : scope.reasons.join("; ")})\``
        );
    } else {
        lines.push(
            '  attended: ask the owner — "reaches no UI" / "reaches these surfaces" (encode the answer as a scoper rule in this PR, then re-run) or "walk everything" (`--all`, encodes nothing; `--surface=a,b` walks a subset as a DIAGNOSTIC)'
        );
    }
    return lines.join("\n");
}

/** The lines `check:ui` prints at the start of every run. */
export function renderUiScope(scope: UiScope, base: string): string {
    const head = `scope (diff base ${base}):`;
    if (scope.kind === "full") return `${head} FULL — ${scope.reason}`;
    if (scope.kind === "undecided") {
        return [
            `${head} UNDECIDED — ${scope.reasons.length} unplaced path(s); no browser started`,
            ...scope.reasons.map((r) => `  · ${r}`),
        ].join("\n");
    }
    if (scope.surfaces.length === 0) {
        return `${head} SCOPED — 0 surfaces (nothing in this diff reaches a walked route)`;
    }
    return [
        `${head} SCOPED — ${scope.surfaces.length} surface(s)`,
        ...scope.surfaces.map((id) => `  · ${id}`),
    ].join("\n");
}

/**
 * Whether a `src/**` diff OWES a `check:ui` walk (issue #5459, PRD #5454): it
 * does only when it can move layout. A measured 6.8 min per scoped run and 57%
 * red (30/53) over 14 days is too dear for a diff that cannot — a leaf
 * component's copy, a handler, a test.
 *
 * FAIL-CLOSED like `computeUiScope`: a path no rule clears but a rule cannot
 * read (a deleted file) is owed. A path is owed by, in this order:
 *   - PATH: a stylesheet, `index.html`, a public asset or the design tokens;
 *     the shell and chrome (`src/components/chrome/`, `main.tsx`, the
 *     routers); a layout component (`*layout*`); a shared UI primitive
 *     (`src/components/ui/`); an overlay / portal / popover / dialog family
 *     component (by name); a viewport or responsive module (by name);
 *   - CONTENT: the changed file declares a `z-index` (`z-10`, `z-[60]`,
 *     `zIndex`), a scroll container (`overflow-auto`, `overflow-y: scroll`,
 *     `ScrollArea`) or a responsive rule (`@media`, `@container`,
 *     `matchMedia`, `useMediaQuery`, `useViewport`). A `.json` file is DATA
 *     and is never content-read (issue #6143): a word in it — "a fixed search
 *     budget" in `tolaria.config.json`'s `$comment` — is prose, not a class
 *     or a style, and owed every diff that touched the config a walk.
 * Tests, markdown, scripts and server-only paths cannot reach the DOM and owe
 * nothing. Content is read from the file AS CHANGED, not its hunks: a leaf
 * file that declares a scroll container anywhere owes a walk — over-owing is
 * the safe side. `land` and `check:ui -- --scope-only` both call this.
 */
export type WalkOwed =
    | { owed: true; rule: string; path: string }
    | { owed: false; reason: string };

const OVERLAY_NAME =
    /(?:dialog|modal|popover|overlay|portal|sheet|drawer|tooltip|dropdown|menu|toast)/i;
const RESPONSIVE_NAME = /(?:viewport|responsive|breakpoint|media-?query)/i;
const Z_INDEX_CONTENT =
    /(?:^|[\s"'`{:!])-?z-(?:\[|\(|\d|auto\b)|\bz-index\b|\bzIndex\b/;
const POSITIONED_CONTENT =
    /(?:^|[\s"'`{:!])(?:fixed|sticky)(?=[\s"'`])|\bposition\s*:\s*["']?(?:fixed|sticky)\b|\bcreatePortal\b/;
const SCROLL_CONTAINER_CONTENT =
    /\boverflow(?:-[xy])?-(?:auto|scroll)\b|\boverflow(?:-?[xyXY])?\s*:\s*["']?(?:auto|scroll)\b|\bScrollArea\b/;
const RESPONSIVE_CONTENT =
    /@media\b|@container\b|\bmatchMedia\b|\buseMediaQuery\b|\buseViewport\w*\b/;

/** The rule that owes a walk for `path` by its name alone, or `null`. */
export function owedByPath(path: string): string | null {
    if (/\.css$/.test(path)) return "a stylesheet";
    if (path === "index.html") return "the HTML document every route loads";
    if (path.startsWith("public/")) return "a public asset";
    if (path === "src/lib/design-tokens.ts") return "a design-token source";
    if (
        path === SHELL_ENTRY ||
        path === "src/app-router.tsx" ||
        path === ROUTER_MODULE ||
        path.startsWith("src/components/chrome/")
    ) {
        return "the app shell / chrome";
    }
    const base = path.slice(path.lastIndexOf("/") + 1);
    if (/layout/i.test(base)) return "a layout component";
    if (path.startsWith("src/components/ui/")) return "a shared UI primitive";
    if (OVERLAY_NAME.test(base))
        return "an overlay / popover / dialog component";
    if (RESPONSIVE_NAME.test(base)) return "a viewport / responsive module";
    return null;
}

/** `source` without its comment-only lines (`//`, `/*`, ` * `). Prose such as
 *  "a fixed count" is not a positioning rule (issue #6941: `bot-view.ts`
 *  owed a walk on the word "fixed" in a JSDoc). Trailing comments stay: a
 *  line that also holds code is never dropped. */
function withoutCommentLines(source: string): string {
    return source
        .split("\n")
        .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
        .join("\n");
}

/** The rule the CONTENT of a changed file trips, or `null`. */
export function owedByContent(rawSource: string): string | null {
    const source = withoutCommentLines(rawSource);
    if (Z_INDEX_CONTENT.test(source)) return "declares a z-index";
    if (POSITIONED_CONTENT.test(source)) {
        return "declares fixed / sticky positioning or a portal";
    }
    if (SCROLL_CONTAINER_CONTENT.test(source))
        return "declares a scroll container";
    if (RESPONSIVE_CONTENT.test(source))
        return "declares a viewport / responsive rule";
    return null;
}

/** A file whose content is data, never markup or style: no content rule
 *  applies to it (`owedByPath` still does — a `public/` JSON is owed). */
function isDataPath(path: string): boolean {
    return /\.json$/.test(path);
}

/** `read(path)` returns the file as changed, or `null` when it is gone/unreadable. */
export function uiWalkOwed(
    changed: readonly string[],
    read: (path: string) => string | null
): WalkOwed {
    const reachable = domReachablePaths([...changed].sort());
    for (const path of reachable) {
        const byPath = owedByPath(path);
        if (byPath) return { owed: true, rule: byPath, path };
        if (isDataPath(path)) continue;
        const source = read(path);
        if (source === null) {
            return {
                owed: true,
                rule: "file gone or unreadable, so its content cannot be cleared",
                path,
            };
        }
        const byContent = owedByContent(source);
        if (byContent) return { owed: true, rule: byContent, path };
    }
    return {
        owed: false,
        reason:
            reachable.length === 0
                ? "no changed path can reach the DOM"
                : "only leaf components, copy or handlers: no stylesheet, shell, layout, overlay, z-index, scroll container or responsive rule",
    };
}

/** `check:ui -- --scope-only`'s verdict line. */
export function renderWalkOwed(result: WalkOwed): string {
    return result.owed
        ? `walk: owed — ${result.path}: ${result.rule}`
        : `walk: not owed — ${result.reason}`;
}

/**
 * The PR-body line an AFK pass states when the scope is `undecided` (or the
 * certain-global `full` one) and nothing was walked (issue #6144). `land`
 * accepts it only against a re-derived scope of those kinds — never for a
 * `scoped` diff that owes a walk.
 */
const SCOPE_UNDECIDED_LINE =
    /^check:ui: scope undecided, not walked \([ \t]*[^\s<)][^)\n]*\)[ \t]*$/m;
export function hasScopeUndecidedLine(prBody: string): boolean {
    return SCOPE_UNDECIDED_LINE.test(prBody);
}

/** The PR-body line that stands in for a receipt when no walk is owed. */
const NO_WALK_OWED_LINE =
    /^check:ui: no walk owed \([ \t]*[^\s<)][^)\n]*\)[ \t]*$/m;
export function hasNoWalkOwedLine(prBody: string): boolean {
    return NO_WALK_OWED_LINE.test(prBody);
}

/**
 * The PR-body line that stands in for a receipt on the RED ladder's revert
 * (issue #6071, ADR 0156 Amendment II): it names the reverted commit, and
 * `land` accepts it only after checking that every DOM-reachable changed path
 * is byte-identical to that commit's parent — the files return to a state
 * that already landed. A claim nobody checks would be the old no-walk line.
 */
export function revertRestoresLine(culpritSha: string): string {
    return `check:ui: revert of ${culpritSha} restores its parent on every DOM path`;
}
const REVERT_RESTORES_LINE =
    /^check:ui: revert of ([0-9a-f]{40}) restores its parent on every DOM path[ \t]*$/m;
/** Every full sha a `revertRestoresLine` names — one per reverted commit of
 *  a revert set (issue #6766) — in body order. */
export function revertedCommitsOf(prBody: string): string[] {
    return [
        ...prBody.matchAll(new RegExp(REVERT_RESTORES_LINE.source, "gm")),
    ].map((m) => m[1]);
}
/** The full sha a `revertRestoresLine` names, or `null` when there is none. */
export function revertedCommitOf(prBody: string): string | null {
    return REVERT_RESTORES_LINE.exec(prBody)?.[1] ?? null;
}

/** The changed paths a walk could care about: the ones `uiWalkOwed` reads. */
export function domReachablePaths(changed: readonly string[]): string[] {
    return changed.filter((p) => !isNonDomPath(p) && !isServerOnlyPath(p));
}
