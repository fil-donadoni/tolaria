// The dev server's card catalogue as ONE module (issue #5597).
//
// WHY. `convex/cards/catalogue.ts` imports every Set module statically (146
// `import * as <set> from "./sets/<set>/index.cards"`), and those reach the
// 1070 files under `convex/cards/sets/`. A production build folds them into
// one `card-catalogue` chunk; the Vite DEV server serves each one as its own
// request, revalidated (`no-cache`) on every load — 1070 requests per gated
// page load, twice in a game against the Bot, whose Brain worker has its own
// module graph. Measured 2026-10-14: opening `/play/constructed` cost 1374
// requests, 1138 of them catalogue (sets + abilities).
//
// WHAT. In `vite` (dev) only, the catalogue's 146 Set imports are rewritten
// into ONE import of a virtual module whose code is a Rolldown bundle of
// `convex/cards/sets/**`. Every import that LEAVES that subtree — the card
// types, `defineCard`, `convex/cards/abilities/**`, `convex/gre/constants`, …
// — stays EXTERNAL and is emitted as the root-relative URL (`/convex/cards/
// types.ts`) under which Vite already serves that file to the rest of the app,
// so it remains ONE module instance: the engine and the Sets share their
// abilities, their registry, their brand symbols.
//
// SOUND ONLY BECAUSE `catalogue.ts` IS THE SOLE IMPORTER OF A SET MODULE.
// Another importer would load the file a second time, outside the bundle, and
// hold a second `defineCard` factory for the same card. Checked when this was
// written (no `src/`, `convex/gre/` or `convex/cards/` module outside the Sets
// imports one) and asserted on every rewrite: a leftover `./sets/` import in
// the catalogue throws instead of serving a split catalogue.
//
// NOT IN `vite build`, NOT IN VITEST. The build already bundles the Sets into
// `card-catalogue`; and a test compares a Set export with what the catalogue
// resolves BY IDENTITY, which a bundled copy would break.
import { readFileSync } from "node:fs";
import path from "node:path";
import { rolldown } from "rolldown";
import type { Plugin, ViteDevServer } from "vite";

/** The specifier the rewritten catalogue imports its Set namespaces from. */
export const CARD_SETS_DEV_MODULE = "virtual:tolaria-card-sets";
const RESOLVED_ID = `\0${CARD_SETS_DEV_MODULE}`;

/** Repo-relative paths the plugin is keyed on. */
export const CATALOGUE_MODULE = "convex/cards/catalogue.ts";
export const SETS_DIR = "convex/cards/sets";

/** One `import * as <name> from "./sets/<dir>/index.cards";` of the catalogue. */
export interface SetNamespaceImport {
    name: string;
    dir: string;
}

// The exact shape every Set import of `catalogue.ts` has: one per line,
// a namespace import of the Set's `index.cards` module.
const SET_IMPORT_LINE =
    /^import \* as ([A-Za-z_$][\w$]*) from "\.\/sets\/([a-z0-9]+)\/index\.cards";$/gm;
// Any other mention of a Set module path in the catalogue — a side-effect
// import, `import()`, `require`, `import.meta.glob` — once the namespace
// imports are rewritten: the catalogue has no other `./sets/` string.
const ANY_SET_IMPORT = /["'`]\.\/sets\//;

/**
 * Rewrite the catalogue's Set imports into one import of
 * {@link CARD_SETS_DEV_MODULE}. LINE-PRESERVING: the first Set import line
 * becomes the combined import and every other one an empty line, so the rest
 * of the module keeps its line numbers and no sourcemap is owed.
 *
 * Throws when there is no Set import to rewrite (the catalogue changed shape:
 * the dev server would silently fall back to 1070 requests) and when a Set
 * module is still named some other way after the rewrite (it would load a
 * second instance beside the bundled one).
 */
export function rewriteCatalogueSetImports(code: string): {
    code: string;
    sets: SetNamespaceImport[];
} {
    const sets: SetNamespaceImport[] = [];
    for (const match of code.matchAll(SET_IMPORT_LINE)) {
        sets.push({ name: match[1]!, dir: match[2]! });
    }
    if (sets.length === 0) {
        throw new Error(
            `${CATALOGUE_MODULE} has no \`import * as <set> from "./sets/<set>/index.cards"\` line: ` +
                "the card-sets dev bundle no longer recognises it (scripts/lib/vite-card-sets-dev-bundle.ts)"
        );
    }
    const combined = `import { ${sets.map((s) => s.name).join(", ")} } from "${CARD_SETS_DEV_MODULE}";`;
    let first = true;
    const rewritten = code.replace(SET_IMPORT_LINE, () => {
        if (!first) return "";
        first = false;
        return combined;
    });
    if (ANY_SET_IMPORT.test(rewritten)) {
        throw new Error(
            `${CATALOGUE_MODULE} names a Set module outside the one-per-line namespace imports: ` +
                "bundling the Sets would load that module twice"
        );
    }
    return { code: rewritten, sets };
}

/** The bundle's entry: one namespace re-export per Set, by absolute path. */
export function cardSetsEntrySource(
    root: string,
    sets: readonly SetNamespaceImport[]
): string {
    return sets
        .map(
            ({ name, dir }) =>
                `export * as ${name} from ${JSON.stringify(path.join(root, SETS_DIR, dir, "index.cards.ts"))};`
        )
        .join("\n");
}

/** Whether `file` (absolute) lies under `convex/cards/sets/` of `root`. */
export function isInsideSets(root: string, file: string): boolean {
    return path.resolve(file).startsWith(path.join(root, SETS_DIR) + path.sep);
}

export interface CardSetsBundle {
    code: string;
    /** With `sourcesContent`: Vite fills in any source a map leaves out by
     *  reading it from disk, and warns when the path is not one, so a map
     *  without it saves nothing. `sources` are the root-relative URLs the Set
     *  files have in the dev server. */
    map: string;
    /** Root-relative URLs the bundle imports (everything outside the Sets). */
    externals: string[];
    /** Absolute paths of the modules with code in the bundle. */
    modules: string[];
    /** Absolute paths of every file the bundle was built from — `modules`
     *  plus the empty `export {}` colour shims it drops. What a change must
     *  touch to make the bundle stale. */
    watched: string[];
}

const ENTRY_ID = "\0tolaria-card-sets-entry";

/**
 * Bundle every Set module of `sets` into one ESM module. A module outside
 * `convex/cards/sets/` is never folded in: it is emitted as an external
 * root-relative URL, the one Vite serves it under.
 */
export async function bundleCardSets(
    root: string,
    sets: readonly SetNamespaceImport[]
): Promise<CardSetsBundle> {
    const bundle = await rolldown({
        input: ENTRY_ID,
        logLevel: "silent",
        plugins: [
            {
                name: "tolaria-card-sets-boundary",
                resolveId: {
                    order: "pre",
                    async handler(source, importer) {
                        if (source === ENTRY_ID) return ENTRY_ID;
                        if (importer === undefined || importer === ENTRY_ID)
                            return null;
                        const resolved = await this.resolve(source, importer, {
                            skipSelf: true,
                        });
                        if (resolved === null) return null;
                        if (isInsideSets(root, resolved.id)) return resolved;
                        if (!path.isAbsolute(resolved.id)) {
                            throw new Error(
                                `card-sets dev bundle: ${importer} imports ${source}, which is no file — a Set module may import only repo files`
                            );
                        }
                        return {
                            id: `/${path.relative(root, resolved.id).split(path.sep).join("/")}`,
                            external: "absolute",
                        };
                    },
                },
                load(id) {
                    return id === ENTRY_ID
                        ? cardSetsEntrySource(root, sets)
                        : null;
                },
            },
        ],
    });
    try {
        const { output } = await bundle.generate({
            format: "esm",
            // `hidden`: Vite inlines the map it is handed; no comment of ours.
            sourcemap: "hidden",
            sourcemapPathTransform: (relative, mapPath) =>
                `/${path
                    .relative(
                        root,
                        path.resolve(path.dirname(mapPath), relative)
                    )
                    .split(path.sep)
                    .join("/")}`,
        });
        const chunk = output[0];
        const inputs = (ids: Iterable<string>) =>
            // `\0` ids are the bundler's own (the entry, Rolldown's runtime).
            [...ids].filter((m) => !m.startsWith("\0"));
        return {
            code: chunk.code,
            map: chunk.map ? chunk.map.toString() : "",
            externals: [...chunk.imports],
            modules: inputs(Object.keys(chunk.modules)),
            watched: inputs(await bundle.watchFiles),
        };
    } finally {
        await bundle.close();
    }
}

/** Whether the plugin runs: the dev server only — never `vite build`, never
 *  vitest (which also runs Vite as `serve`). */
export function cardSetsDevBundleApplies(
    env: { command: string; mode: string },
    processEnv: Readonly<Record<string, string | undefined>> = process.env
): boolean {
    return env.command === "serve" && env.mode !== "test" && !processEnv.VITEST;
}

/**
 * The plugin. Built lazily on the first request for the virtual module and
 * kept until a file under `convex/cards/sets/` (or the catalogue itself)
 * changes, which drops it and reloads the page: a Set edit has no HMR
 * boundary to stop at, so a full reload is what the app did before too.
 */
export function cardSetsDevBundle(): Plugin {
    let root = process.cwd();
    let cataloguePath = path.join(root, CATALOGUE_MODULE);
    let building: Promise<CardSetsBundle> | null = null;
    /** The files the LAST finished build read; `null` while one is in flight
     *  (or none ran), when any change under the Sets counts. */
    let watched: ReadonlySet<string> | null = null;
    let pendingReload: ReturnType<typeof setTimeout> | null = null;

    const build = (): Promise<CardSetsBundle> => {
        if (building === null) {
            const started = performance.now();
            const { sets } = rewriteCatalogueSetImports(
                readFileSync(cataloguePath, "utf8")
            );
            watched = null;
            const current = bundleCardSets(root, sets).then((bundle) => {
                if (building === current) watched = new Set(bundle.watched);
                console.log(
                    `card-sets dev bundle: ${bundle.watched.length} Set files → 1 module in ${(performance.now() - started).toFixed(0)} ms`
                );
                return bundle;
            });
            building = current;
            current.catch(() => {
                if (building === current) building = null;
            });
        }
        return building;
    };

    /** Whether a change to `file` makes the bundle stale: the catalogue, or a
     *  file the bundle was built from — never a Set's `__tests__`. */
    const isStaleBy = (file: string): boolean => {
        const abs = path.resolve(file);
        if (abs === cataloguePath) return true;
        if (!isInsideSets(root, abs)) return false;
        return watched === null || watched.has(abs);
    };

    // Trailing-debounced: a `git checkout` touching many Sets costs one
    // rebuild and one reload, not one per file.
    const invalidate = (server: ViteDevServer): void => {
        building = null;
        watched = null;
        if (pendingReload !== null) clearTimeout(pendingReload);
        pendingReload = setTimeout(() => {
            pendingReload = null;
            for (const environment of Object.values(server.environments)) {
                const mod = environment.moduleGraph.getModuleById(RESOLVED_ID);
                if (mod) environment.moduleGraph.invalidateModule(mod);
            }
            server.ws.send({ type: "full-reload" });
        }, 100);
    };

    return {
        name: "tolaria-card-sets-dev-bundle",
        enforce: "pre",
        apply: (_config, env) => cardSetsDevBundleApplies(env),
        configResolved(config) {
            root = config.root;
            cataloguePath = path.join(root, CATALOGUE_MODULE);
        },
        configureServer(server) {
            server.watcher.on("all", (_event, file) => {
                if (isStaleBy(file)) invalidate(server);
            });
        },
        resolveId(source) {
            return source === CARD_SETS_DEV_MODULE ? RESOLVED_ID : null;
        },
        async load(id) {
            if (id !== RESOLVED_ID) return null;
            const { code, map } = await build();
            return { code, map };
        },
        transform(code, id) {
            if (path.resolve(id.split("?")[0]!) !== cataloguePath) return null;
            // Line-preserving: `map: null` keeps the existing mappings.
            return { code: rewriteCatalogueSetImports(code).code, map: null };
        },
    };
}
