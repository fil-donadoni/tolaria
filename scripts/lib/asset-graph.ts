/**
 * Static reachability over a built `dist/` (issue #4854).
 *
 * "Reachable from the login page" means what the browser fetches before any
 * route chunk is requested: the entry script, every `modulepreload` in
 * `index.html`, and everything those import STATICALLY (`import … from "./x.js"`
 * / `import "./x.js"`). A `import("./x.js")` is deliberately not an edge — that
 * is the lazy boundary this graph exists to check.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `from"./x.js"` / `from "./x.js"` / `import"./x.js"` — a static edge. */
const STATIC_EDGE = /(?:\bfrom|\bimport)\s*["']\.\/([^"']+\.js)["']/g;

export function entryAssets(distDir: string): string[] {
    const html = readFileSync(join(distDir, "index.html"), "utf8");
    const out = new Set<string>();
    for (const m of html.matchAll(
        /<(?:script|link)\b[^>]*\b(?:src|href)="\/(assets\/[^"]+\.js)"[^>]*>/g
    )) {
        const tag = m[0];
        if (tag.startsWith("<script") || /rel="modulepreload"/.test(tag)) {
            out.add(m[1]!.replace(/^assets\//, ""));
        }
    }
    return [...out];
}

export function staticImports(distDir: string, chunk: string): string[] {
    const source = readFileSync(join(distDir, "assets", chunk), "utf8");
    return [...source.matchAll(STATIC_EDGE)].map((m) => m[1]!);
}

/** Every chunk reachable from `roots` through static imports. */
export function reachableChunks(distDir: string, roots: string[]): Set<string> {
    const seen = new Set<string>();
    const queue = [...roots];
    while (queue.length > 0) {
        const chunk = queue.pop()!;
        if (seen.has(chunk)) continue;
        seen.add(chunk);
        queue.push(...staticImports(distDir, chunk));
    }
    return seen;
}

/** The chunk-name prefix that must stay out of a light surface: the card set
 *  modules (`card-catalogue`, `vite.config.ts` → `codeSplitting`). */
export const HEAVY_CHUNK_PREFIXES = ["card-catalogue-"] as const;

/** A literal only the rules engine carries (`convex/gre/activation.ts`), so a
 *  chunk holding it IS an engine chunk whatever the bundler named it. The
 *  engine is not a named chunk on purpose: a `codeSplitting` group for it
 *  makes chunk cycles that leave a set helper `undefined` at load time
 *  (issue #4854, found in a built bundle, never in dev). A reworded message
 *  is caught by `lightSurfaceViolations` itself: no chunk holding it at all is
 *  a violation, so the guard cannot go quietly vacuous. */
export const ENGINE_SENTINEL = "Target spell is no longer on the stack";

/** The route chunks a "light surface" adds on top of the entry. The login page
 *  is the entry alone; the lobby is the entry plus its own route chunk. */
export const LIGHT_SURFACES: Record<string, string[]> = {
    login: [],
    lobby: ["lobby.route-"],
};

/** Hashed asset files of the compiled catalogue — the one-file artifact the
 *  gate fetches (`src/lib/catalogueArtifact.ts`) and the full-catalogue gzip. */
const CATALOGUE_ASSET =
    /(?:^|["'/])(?:full-)?catalogue-[0-9a-f]{8,}[^"']*\.(?:json|gz)/;

export interface LightSurfaceViolation {
    surface: string;
    chunk: string;
    reason: string;
}

/**
 * Every way a light surface reaches the engine or the catalogue in `distDir`:
 * a reachable heavy chunk, or a reachable chunk that names the catalogue
 * artifact (the only way a chunk can fetch it).
 */
export function lightSurfaceViolations(
    distDir: string,
    surfaces: Record<string, string[]> = LIGHT_SURFACES
): LightSurfaceViolation[] {
    const assets = readdirSync(join(distDir, "assets"));
    const out: LightSurfaceViolation[] = [];
    if (
        !assets.some(
            (f) =>
                f.endsWith(".js") &&
                readFileSync(join(distDir, "assets", f), "utf8").includes(
                    ENGINE_SENTINEL
                )
        )
    ) {
        out.push({
            surface: "(all)",
            chunk: "*.js",
            reason: `no chunk carries the engine sentinel "${ENGINE_SENTINEL}" — the engine check is vacuous; update ENGINE_SENTINEL`,
        });
    }
    for (const [surface, routePrefixes] of Object.entries(surfaces)) {
        const routeChunks = routePrefixes.flatMap((prefix) => {
            const found = assets.filter(
                (f) => f.startsWith(prefix) && f.endsWith(".js")
            );
            if (found.length === 0) {
                out.push({
                    surface,
                    chunk: `${prefix}*.js`,
                    reason: "route chunk not found in dist/assets — the surface is not split out",
                });
            }
            return found;
        });
        const reachable = reachableChunks(distDir, [
            ...entryAssets(distDir),
            ...routeChunks,
        ]);
        for (const chunk of [...reachable].sort()) {
            if (HEAVY_CHUNK_PREFIXES.some((p) => chunk.startsWith(p))) {
                out.push({
                    surface,
                    chunk,
                    reason: "heavy chunk reachable by static import or modulepreload",
                });
            }
            const source = readFileSync(join(distDir, "assets", chunk), "utf8");
            if (source.includes(ENGINE_SENTINEL)) {
                out.push({
                    surface,
                    chunk,
                    reason: "carries the rules engine and is reachable by static import or modulepreload",
                });
            }
            if (CATALOGUE_ASSET.test(source)) {
                out.push({
                    surface,
                    chunk,
                    reason: "names the compiled catalogue asset, so it can fetch it",
                });
            }
        }
    }
    return out;
}

/**
 * The chunks whose static imports lead back to themselves. A cycle through
 * `card-catalogue` is the failure issue #4854 hit in a built bundle only: a
 * helper the sets share sat in a chunk that imported the sets back, so the
 * route that loaded first evaluated a set while its helper was still
 * `undefined` (`TypeError: … is not a function`) — green in dev, in tsc and in
 * every unit test.
 */
export function chunksInStaticCycle(distDir: string, prefix: string): string[] {
    const assets = readdirSync(join(distDir, "assets")).filter((f) =>
        f.endsWith(".js")
    );
    return assets
        .filter((f) => f.startsWith(prefix))
        .filter((chunk) => {
            const seen = new Set<string>();
            const queue = staticImports(distDir, chunk);
            while (queue.length > 0) {
                const next = queue.pop()!;
                if (next === chunk) return true;
                if (seen.has(next)) continue;
                seen.add(next);
                queue.push(...staticImports(distDir, next));
            }
            return false;
        });
}
