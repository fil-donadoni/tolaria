/**
 * The dashboard's build manifest, read as a serving allow-list (ADR 0117).
 *
 * ## Why this replaced a list of literals
 *
 * Until PRD #3148 the dashboard was 37 plain ES modules and `telemetry-serve`
 * served them from `DASHBOARD_ASSET_NAMES`, an EXACT-MATCH map of hand-written
 * names. A bundle's filenames carry content hashes, so that list cannot
 * survive: nobody can write `main-B7fQ2p1x.js` in advance.
 *
 * ## The property that must not weaken
 *
 * The old list was an allow-list, not sanitisation, and the replacement is the
 * same shape: **the request contributes a lookup KEY and nothing else.** The
 * key is never joined with a path, never decoded, never normalised, never
 * compared with `startsWith` against a root — so `..`, an encoded `%2e%2e%2f`,
 * an absolute path, a backslash, a symlink or a null byte are all simply keys
 * that are not in the map, and a traversal is refused BY CONSTRUCTION rather
 * than by a filter that has to be right about every spelling.
 *
 * What changed is only WHERE the names come from: Vite's `manifest.json`
 * instead of a literal array. Every path in the map is built HERE, once, by
 * joining the output directory with a name the BUILD wrote — never with a name
 * a request supplied.
 *
 * `Map`, not a plain object, so `__proto__` / `constructor` / `toString` are
 * ordinary missing keys rather than inherited truthy values.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** What an operator has to type when the build is missing. */
export const DASHBOARD_BUILD_COMMAND = "bun run telemetry:dash:build";

/** Where `vite.dashboard.config.ts` writes the build, relative to the repo. */
export const DASHBOARD_OUT_DIR = "dashboard/dist";

/** Vite writes the manifest here whenever `build.manifest` is on. */
const MANIFEST_RELATIVE = join(".vite", "manifest.json");

const CONTENT_TYPES: Record<string, string> = {
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    map: "application/json; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
    json: "application/json; charset=utf-8",
};

/** The one type a name the build wrote but this table does not know gets. It
 *  is deliberately NOT a guess: a wrong `text/*` would be interpreted. */
const FALLBACK_CONTENT_TYPE = "application/octet-stream";

export interface DashboardAsset {
    /** Absolute, built here from the manifest's name — never from a request. */
    path: string;
    type: string;
}

export interface DashboardBuild {
    /** Exact-match lookup, keyed by the name that follows `/assets/`. */
    assets: ReadonlyMap<string, DashboardAsset>;
    /** The built document served at `/`, before the token injection. */
    htmlPath: string;
}

/** One manifest chunk, narrowed to the three fields that name files. */
interface ManifestChunk {
    file?: unknown;
    css?: unknown;
    assets?: unknown;
}

const namesOf = (chunk: ManifestChunk): string[] => {
    const out: string[] = [];
    if (typeof chunk.file === "string") out.push(chunk.file);
    for (const key of ["css", "assets"] as const) {
        const list = chunk[key];
        if (!Array.isArray(list)) continue;
        for (const name of list) if (typeof name === "string") out.push(name);
    }
    return out;
};

/** A manifest name that would resolve outside `outDir` once joined. */
export function escapesOutDir(name: string): boolean {
    if (name.startsWith("/") || name.startsWith("\\")) return true;
    if (/^[a-zA-Z]:/.test(name)) return true;
    return name.split(/[/\\]/).includes("..");
}

export function contentTypeFor(name: string): string {
    const ext = name.includes(".") ? name.split(".").pop()! : "";
    return CONTENT_TYPES[ext] ?? FALLBACK_CONTENT_TYPE;
}

/**
 * Reads the build's manifest and returns the serving map, or `null` when the
 * dashboard has not been built. `null` is a first-class answer, not an error:
 * a fresh checkout has no build, and the server's job there is to say which
 * command makes one — never to crash, and never to serve a blank page.
 *
 * `outDir` is absolute and comes from the caller's project root, so a test can
 * point it at a directory it wrote itself.
 */
export function readDashboardBuild(outDir: string): DashboardBuild | null {
    const manifestPath = join(outDir, MANIFEST_RELATIVE);
    if (!existsSync(manifestPath)) return null;

    let manifest: unknown;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
        // A half-written or corrupt manifest is a missing build, not a
        // 500: the operator's next move is the same either way.
        return null;
    }
    if (typeof manifest !== "object" || manifest === null) return null;

    const assets = new Map<string, DashboardAsset>();
    for (const chunk of Object.values(manifest as Record<string, unknown>)) {
        if (typeof chunk !== "object" || chunk === null) continue;
        for (const name of namesOf(chunk as ManifestChunk)) {
            // The document is served at `/` with the token injected, never
            // as a raw asset — keeping it out of the map is what stops
            // `/assets/index.html` from handing out an un-tokenised shell.
            if (name.endsWith(".html")) continue;
            // The map's paths are only ever as trustworthy as the BUILD that
            // named them, so the one thing a name may not do is leave the
            // output directory. Refused, not clamped: a name like this means
            // the build config is wrong, and serving a "repaired" version of
            // it would hide that. (Vite emits flat, relative names — this has
            // never fired; it is here so the containment property is TOTAL
            // rather than conditional on the bundler's good behaviour.)
            if (escapesOutDir(name)) continue;
            assets.set(name, {
                path: join(outDir, name),
                type: contentTypeFor(name),
            });
        }
    }

    const htmlPath = join(outDir, "index.html");
    if (!existsSync(htmlPath)) return null;
    return { assets, htmlPath };
}
