import * as fs from "fs";
import * as path from "path";
// The route-module naming has ONE definition (`check:ui`'s own scoper); a
// second copy here would let the census and the scoper disagree about what a
// screen is.
import { isRouteModulePath } from "./ui-scope";

/**
 * The `check:ui` coverage census (issue #3420).
 *
 * THE HOLE THIS CLOSES. The UI gate walks a hand-written list of surfaces
 * (`scripts/ui-gate/surfaces.ts`). Nothing connected that list to the app's
 * real UI inventory, so adding a screen or a modal added no coverage and
 * reddened nothing: the gate stayed green while the new element was measured
 * at no viewport. Observed on the resolve-time Cast/Decline prompt — it gained
 * a card image, the gate was green, and the regression class the gate exists
 * to catch (a clipped or occluded element at a small viewport) was
 * unobservable by construction.
 *
 * This module is the third input those two lists never had: a mechanical
 * enumeration of the app's censused UI elements, resolved against what the
 * lane actually measures. It is a pure scan in the `raw-card-display-scan.ts`
 * mould — no browser, no deployment, no network — so its guard
 * (`scripts/__tests__/ui-census.test.ts`) runs offline inside `check:all`.
 *
 * ── THE TWO CENSUSED KINDS ───────────────────────────────────────────────
 *
 * `route` — a `src/routes/**\/*.route.tsx` module: a SCREEN. The router
 *   mounts it, a user can be standing on it, and nothing else in the tree
 *   describes its layout.
 *
 * `overlay` — a component that paints a layer of its OWN over the page:
 *   `GameDialog`, a shadcn `DialogContent`/`SheetContent`, `ActionSheet`,
 *   `BottomSheet`, `AnchoredPicker`, `CommandDialog`, or a literal
 *   `role="dialog"`. These are censused because their layout is a function of
 *   the VIEWPORT rather than of the page that opened them — the failure shape
 *   is a body that outgrows a phone screen, a footer plate pushed off the
 *   bottom, a scroll port with no room to scroll.
 *
 * ── THE BOUNDARY, STATED RATHER THAN LEFT SILENT ─────────────────────────
 *
 * `Popover`, `Tooltip` and `ContextMenu` are NOT censused. They are anchored
 * to a trigger and sized by their content: they carry no independent
 * viewport-scale layout, and their risk class is hit-testing (does the anchor
 * land on screen), which the Floors already measure through the trigger on
 * its own surface. This is a recorded boundary, not an oversight — widen it
 * by adding the primitive to `OVERLAY_PRIMITIVES` and paying the debt the
 * scan then reports, never by quietly reading this list as exhaustive.
 *
 * ── WHAT COUNTS AS COVERED ───────────────────────────────────────────────
 *
 * Coverage means MEASURED, never "reachable in principle":
 *
 *   `walked`   — a surface the lane walks declares the file in `mounts`: it
 *                is on screen when the probe measures. A surface listed in
 *                `UNWALKED_SURFACES` covers NOTHING — an element whose only
 *                home is an unwalked surface is uncovered, and this scan says
 *                so. That is the whole point: declared debt must not launder
 *                itself into coverage.
 *   `specimen` — the design-system census page mounts it. That page is walked
 *                at all five viewports with no live game, which is why "it
 *                lives on the board" routes an element TO a specimen rather
 *                than out of the census.
 *   `exempt`   — reviewed: the element needs no measurement because it paints
 *                no layout of its own. The reason must say WHY, never where.
 *   `debt`     — reviewed: it DOES need measurement and has none, recorded
 *                against the issue that owns closing it. Frozen at the shape
 *                HEAD honestly had; it may shrink, never grow.
 *
 * Anything else is `uncensused` and reds the guard.
 *
 * The import closure of a walked surface's route is deliberately NOT a
 * coverage signal. The game route imports every board dialog; taking that as
 * coverage would report the whole board censused while measuring one screen,
 * which is precisely the false green this module exists to remove.
 */

/** JSX tags that paint an independent layer. See the boundary note above. */
export const OVERLAY_PRIMITIVES = [
    "GameDialog",
    "DialogContent",
    "SheetContent",
    "ActionSheet",
    "BottomSheet",
    "AnchoredPicker",
    "CommandDialog",
] as const;

const OVERLAY_TAG_RE = new RegExp(`<(${OVERLAY_PRIMITIVES.join("|")})[\\s/>]`);
const ROLE_DIALOG_RE = /role=["']dialog["']/;

/**
 * The modules that DEFINE the overlay vocabulary. They are the census's own
 * nouns — counting them as occurrences would make the primitive a permanent
 * entry describing itself rather than a screen. Each is measured through the
 * design-system specimen that mounts it.
 */
export const OVERLAY_PRIMITIVE_MODULES = new Set([
    "src/components/ui/game-dialog.tsx",
    "src/components/ui/dialog.tsx",
    "src/components/ui/sheet.tsx",
    "src/components/ui/action-sheet.tsx",
    "src/components/ui/bottom-sheet.tsx",
    "src/components/ui/anchored-picker.tsx",
    "src/components/ui/command.tsx",
]);

/**
 * The `src/` path aliases, as every `tsconfig*.json` in the repo declares them
 * (`"~/*"` and `"@/*"` both map to `./src/*`). BOTH, from one table: `~/` is
 * the prevailing convention and `@/` the minority one, so resolving only the
 * one the census page happens to use today would make the next specimen wired
 * up the ordinary way register as no specimen at all — and the guard would
 * then tell its author to add the specimen that already exists.
 */
const SRC_ALIASES = ["~/", "@/"] as const;

/** The census page whose direct imports are its live specimens. */
export const SPECIMEN_ROUTE = "src/routes/design-system.route.tsx";
/** Where that page's section modules live; their imports are specimens too. */
export const SPECIMEN_SECTION_DIR = "src/routes/design-system/";

export type CensusKind = "route" | "overlay";

export interface CensusElement {
    /** Repo-relative, forward-slash separated. */
    file: string;
    kind: CensusKind;
    /** What made it censused — the primitive tag, or the route naming. */
    evidence: string;
}

export type CensusStatus =
    | "walked"
    | "specimen"
    | "exempt"
    | "debt"
    | "uncensused";

export interface CensusRow {
    file: string;
    kind: CensusKind;
    status: CensusStatus;
    /** Who covers it, or why it is excused. Empty for `uncensused`. */
    by: string;
}

function walkSrc(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "__tests__" || entry.name === "node_modules") {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkSrc(full, out);
        } else if (
            entry.name.endsWith(".tsx") &&
            !entry.name.endsWith(".test.tsx")
        ) {
            out.push(full);
        }
    }
}

function rel(repoRoot: string, file: string): string {
    return path.relative(repoRoot, file).split(path.sep).join("/");
}

/**
 * Enumerate the censused UI elements of `src/`.
 *
 * A file that is BOTH a route and an overlay host — a route module rendering
 * its own dialog — yields TWO rows, because a walked surface naming the route
 * in `entries` photographs the screen and not the modal over it. Reporting
 * only the route would let the route's coverage hide the layer, which is the
 * exact fail-open this census exists to remove. No route module does this
 * today (one component per file sends the dialog to its own file); the second
 * row is what makes the first one to try it visible.
 */
export function scanCensusElements(repoRoot: string): CensusElement[] {
    const files: string[] = [];
    walkSrc(path.join(repoRoot, "src"), files);
    const out: CensusElement[] = [];
    for (const file of files.sort()) {
        const name = rel(repoRoot, file);
        const isRoute = isRouteModulePath(name);
        if (isRoute) {
            out.push({ file: name, kind: "route", evidence: "route module" });
        }
        if (!isRoute && OVERLAY_PRIMITIVE_MODULES.has(name)) continue;
        const text = fs.readFileSync(file, "utf8");
        const tag = OVERLAY_TAG_RE.exec(text);
        if (tag) {
            out.push({ file: name, kind: "overlay", evidence: `<${tag[1]}>` });
        } else if (ROLE_DIALOG_RE.test(text)) {
            out.push({
                file: name,
                kind: "overlay",
                evidence: `role="dialog"`,
            });
        }
    }
    return out;
}

const IMPORT_RE = /from\s+["']([^"']+)["']/g;

/**
 * The files the design-system census page mounts as live specimens: its own
 * direct imports and those of its section modules, `@/`-resolved.
 *
 * DIRECT imports only, never a closure: the page's job is to MOUNT what it
 * imports, and a transitive import is something a specimen happens to use, not
 * a specimen. A closure here would re-open the false green this scan closes.
 */
export function scanSpecimenFiles(repoRoot: string): Set<string> {
    const roots = [path.join(repoRoot, SPECIMEN_ROUTE)];
    const sectionDir = path.join(repoRoot, SPECIMEN_SECTION_DIR);
    if (fs.existsSync(sectionDir)) {
        for (const entry of fs.readdirSync(sectionDir)) {
            if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
                roots.push(path.join(sectionDir, entry));
            }
        }
    }
    const out = new Set<string>();
    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        const text = fs.readFileSync(root, "utf8");
        for (const m of text.matchAll(IMPORT_RE)) {
            const spec = m[1];
            let base: string | null = null;
            const alias = SRC_ALIASES.find((a) => spec.startsWith(a));
            if (alias) {
                base = path.join(repoRoot, "src", spec.slice(alias.length));
            } else if (spec.startsWith(".")) {
                base = path.resolve(path.dirname(root), spec);
            }
            if (!base) continue;
            for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
                const candidate = base.endsWith(ext) ? base : base + ext;
                if (fs.existsSync(candidate)) {
                    out.add(rel(repoRoot, candidate));
                    break;
                }
            }
        }
    }
    return out;
}

/** A surface as the census sees it (`scripts/ui-gate/surfaces.ts`). */
export interface CensusSurface {
    id: string;
    entries: readonly string[];
    /** Files ON SCREEN when the probe measures this surface. */
    mounts?: readonly string[];
    /** False for a surface declared in `UNWALKED_SURFACES`. */
    walked: boolean;
}

export interface ResolveCensusInput {
    elements: readonly CensusElement[];
    surfaces: readonly CensusSurface[];
    specimens: ReadonlySet<string>;
    /** `<file>` → why it paints no layout of its own. */
    exempt: Readonly<Record<string, string>>;
    /** `<file>` → the recorded debt (reason + owning issue). */
    debt: Readonly<Record<string, string>>;
}

export function resolveCensus({
    elements,
    surfaces,
    specimens,
    exempt,
    debt,
}: ResolveCensusInput): CensusRow[] {
    const walked = surfaces.filter((s) => s.walked);
    const byRoute = new Map<string, string>();
    const byMount = new Map<string, string>();
    for (const surface of walked) {
        for (const entry of surface.entries) {
            if (!byRoute.has(entry)) byRoute.set(entry, surface.id);
        }
        for (const mount of surface.mounts ?? []) {
            if (!byMount.has(mount)) byMount.set(mount, surface.id);
        }
    }
    return elements.map(({ file, kind }) => {
        const mount = byMount.get(file);
        if (mount) return { file, kind, status: "walked" as const, by: mount };
        if (kind === "route") {
            const route = byRoute.get(file);
            if (route) {
                return { file, kind, status: "walked" as const, by: route };
            }
        }
        if (specimens.has(file)) {
            return {
                file,
                kind,
                status: "specimen" as const,
                by: SPECIMEN_ROUTE,
            };
        }
        if (file in exempt) {
            return { file, kind, status: "exempt" as const, by: exempt[file] };
        }
        if (file in debt) {
            return { file, kind, status: "debt" as const, by: debt[file] };
        }
        return { file, kind, status: "uncensused" as const, by: "" };
    });
}

/**
 * A reason that says WHERE the element lives instead of WHY it needs no
 * measurement. "It lives on the board" is not an exemption — it is a routing
 * instruction to the design-system specimen page, which measures a modal at
 * all five viewports with no live game.
 */
const LOCATIONAL_RE =
    /\b(?:lives? (?:on|in)|only (?:on|in) the|board-only|it is (?:on|in) the)\b/i;

/** Why this EXEMPT row is not admissible, or `null`. */
export function exemptionFault(file: string, reason: string): string | null {
    if (reason.trim() === "") return `${file}: empty EXEMPT reason`;
    if (LOCATIONAL_RE.test(reason)) {
        return `${file}: "${reason}" says where the element lives, not why it paints no layout of its own`;
    }
    return null;
}

/** Why this DEBT row is not admissible, or `null`. Recorded debt names its owner. */
export function debtFault(file: string, reason: string): string | null {
    if (reason.trim() === "") return `${file}: empty DEBT reason`;
    if (!/#\d+/.test(reason)) {
        return `${file}: "${reason}" names no owning issue`;
    }
    return null;
}
