// The dev server's card catalogue as ONE module (issue #5597).
//
// WHY. `convex/cards/setModules.ts` imports every Set module statically (146
// `import * as <set> from "./sets/<set>/index.cards"`), and those reach the
// 1070 files under `convex/cards/sets/`. A production build makes one lazily
// imported chunk per Set (issue #5615); the Vite DEV server would serve each
// file as its own request, revalidated (`no-cache`) on every load — 1070
// requests per gated page load, twice in a game against the Bot, whose Brain
// worker has its own module graph. Measured 2026-10-14: opening
// `/play/constructed` cost 1374 requests, 1138 of them catalogue (sets +
// abilities).
//
// WHAT. In `vite` (dev) only, the client's Set loader
// (`src/lib/catalogue/set-chunk-loader.ts`, the `./set-chunk-loader` the
// browser seam imports) is swapped for a loader over ONE virtual module whose
// code is a Rolldown bundle of `convex/cards/sets/**`. Every import that
// LEAVES that subtree — the card types, `defineCard`, `convex/cards/
// abilities/**`, `convex/gre/constants`, … — stays EXTERNAL and is emitted as
// the root-relative URL (`/convex/cards/types.ts`) under which Vite already
// serves that file to the rest of the app, so it remains ONE module instance:
// the engine and the Sets share their abilities, their registry, their brand
// symbols. The loader keeps its contract — one Set's exports per code — so
// the catalogue, the shard loader and the gate run the same code in dev as in
// a build; only where a Set's module comes from differs.
//
// SOUND ONLY BECAUSE A SET MODULE HAS TWO IMPORTERS: the server's static list
// (`convex/cards/setModules.ts`, which `vite.config.ts` aliases away from
// every client graph) and the client's one `import()` (the loader this plugin
// swaps). Another importer would load the file a second time, outside the
// bundle, and hold a second `defineCard` factory for the same card. Asserted
// by `scripts/__tests__/vite-card-sets-dev-bundle.test.ts` over the import
// graph.
//
// NOT IN `vite build`, NOT IN VITEST. The build emits the per-Set chunks; and
// a test compares a Set export with what the catalogue resolves BY IDENTITY,
// which a bundled copy would break.
import { readFileSync } from "node:fs";
import path from "node:path";
import { rolldown } from "rolldown";
import type { Plugin, ViteDevServer } from "vite";

/** The virtual module holding every Set, one namespace export per Set. */
export const CARD_SETS_DEV_MODULE = "virtual:tolaria-card-sets";
const RESOLVED_ID = `\0${CARD_SETS_DEV_MODULE}`;
/** The virtual loader the browser seam gets in place of its chunk loader. */
export const CARD_SETS_DEV_LOADER = "virtual:tolaria-card-sets-loader";
const RESOLVED_LOADER_ID = `\0${CARD_SETS_DEV_LOADER}`;

/** Repo-relative paths the plugin is keyed on. */
export const SET_MODULES_MODULE = "convex/cards/setModules.ts";
export const SETS_DIR = "convex/cards/sets";
/** The browser seam, the one importer of the chunk loader, and how it spells
 *  the specifier (`src/lib/catalogue/set-modules.browser.ts`). */
export const SET_MODULES_BROWSER_SEAM =
    "src/lib/catalogue/set-modules.browser.ts";
export const SET_CHUNK_LOADER_SPECIFIER = "./set-chunk-loader";

/** One `import * as <name> from "./sets/<dir>/index.cards";` of the server's
 *  Set list. */
export interface SetNamespaceImport {
    name: string;
    dir: string;
}

// The exact shape every Set import of `setModules.ts` has: one per line, a
// namespace import of the Set's `index.cards` module.
const SET_IMPORT_LINE =
    /^import \* as ([A-Za-z_$][\w$]*) from "\.\/sets\/([a-z0-9]+)\/index\.cards";$/gm;
// `{ code: "<code>", exports: <name> }` — the Set code each namespace is
// listed under (`5dn` is `fifthDawn`).
const SET_CODE_ENTRY =
    /\{ code: "([a-z0-9]+)", exports: ([A-Za-z_$][\w$]*) \}/g;

/**
 * The Set list of the server module: every namespace import, each with the
 * Set code its list entry gives it (the code is what the loader is asked
 * for; the directory is what the bundle reads).
 *
 * Throws when there is no Set import to read (the module changed shape: the
 * dev server would silently fall back to 1070 requests) and when an import
 * has no list entry or an entry no import (the bundle would serve a Set the
 * catalogue cannot name, or name one it cannot serve).
 */
export function parseSetModuleImports(code: string): SetNamespaceImport[] {
    const sets: SetNamespaceImport[] = [];
    for (const match of code.matchAll(SET_IMPORT_LINE)) {
        sets.push({ name: match[1]!, dir: match[2]! });
    }
    if (sets.length === 0) {
        throw new Error(
            `${SET_MODULES_MODULE} has no \`import * as <set> from "./sets/<set>/index.cards"\` line: ` +
                "the card-sets dev bundle no longer recognises it (scripts/lib/vite-card-sets-dev-bundle.ts)"
        );
    }
    const codeByName = new Map<string, string>();
    for (const match of code.matchAll(SET_CODE_ENTRY)) {
        codeByName.set(match[2]!, match[1]!);
    }
    for (const set of sets) {
        const setCode = codeByName.get(set.name);
        if (setCode === undefined) {
            throw new Error(
                `${SET_MODULES_MODULE} imports ${set.name} (./sets/${set.dir}) but lists no \`{ code, exports: ${set.name} }\` entry for it`
            );
        }
        if (setCode !== set.dir) {
            throw new Error(
                `${SET_MODULES_MODULE} lists ${set.name} under code "${setCode}" but imports it from ./sets/${set.dir}`
            );
        }
    }
    if (codeByName.size !== sets.length) {
        throw new Error(
            `${SET_MODULES_MODULE} lists ${codeByName.size} Set entries but imports ${sets.length} Set modules`
        );
    }
    return sets;
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

/** The dev loader: `loadSetModule(code)` answered from the one bundle. The
 *  same contract as `src/lib/catalogue/set-chunk-loader.ts`, which it
 *  replaces: one Set's exports per code, a rejection for a code the server
 *  module does not list. */
export function cardSetsLoaderSource(
    sets: readonly SetNamespaceImport[]
): string {
    const byCode = Object.fromEntries(sets.map((s) => [s.dir, s.name]));
    return [
        `const byCode = ${JSON.stringify(byCode)};`,
        "let bundle = null;",
        "export function loadSetModule(code) {",
        "    const name = Object.prototype.hasOwnProperty.call(byCode, code) ? byCode[code] : undefined;",
        "    if (name === undefined) return Promise.reject(new Error(`Unknown Set module: ${code}`));",
        `    bundle ??= import(${JSON.stringify(CARD_SETS_DEV_MODULE)});`,
        "    return bundle.then((m) => m[name]);",
        "}",
        "",
    ].join("\n");
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

/** Whether `importer` is the browser seam — the one module whose
 *  `./set-chunk-loader` import the plugin swaps. */
export function isSetModulesBrowserSeam(importer: string | undefined): boolean {
    return (
        importer !== undefined &&
        importer
            .split("?")[0]!
            .replaceAll("\\", "/")
            .endsWith(`/${SET_MODULES_BROWSER_SEAM}`)
    );
}

/**
 * The plugin. Built lazily on the first request for the virtual module and
 * kept until a file under `convex/cards/sets/` (or the server's Set list
 * itself) changes, which drops it and reloads the page: a Set edit has no HMR
 * boundary to stop at, so a full reload is what the app did before too.
 */
export function cardSetsDevBundle(): Plugin {
    let root = process.cwd();
    let setModulesPath = path.join(root, SET_MODULES_MODULE);
    let building: Promise<CardSetsBundle> | null = null;
    /** The files the LAST finished build read; `null` while one is in flight
     *  (or none ran), when any change under the Sets counts. */
    let watched: ReadonlySet<string> | null = null;
    let pendingReload: ReturnType<typeof setTimeout> | null = null;

    const sets = (): SetNamespaceImport[] =>
        parseSetModuleImports(readFileSync(setModulesPath, "utf8"));

    const build = (): Promise<CardSetsBundle> => {
        if (building === null) {
            const started = performance.now();
            const list = sets();
            watched = null;
            const current = bundleCardSets(root, list).then((bundle) => {
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

    /** Whether a change to `file` makes the bundle stale: the Set list, or a
     *  file the bundle was built from — never a Set's `__tests__`. */
    const isStaleBy = (file: string): boolean => {
        const abs = path.resolve(file);
        if (abs === setModulesPath) return true;
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
                for (const id of [RESOLVED_ID, RESOLVED_LOADER_ID]) {
                    const mod = environment.moduleGraph.getModuleById(id);
                    if (mod) environment.moduleGraph.invalidateModule(mod);
                }
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
            setModulesPath = path.join(root, SET_MODULES_MODULE);
        },
        configureServer(server) {
            server.watcher.on("all", (_event, file) => {
                if (isStaleBy(file)) invalidate(server);
            });
        },
        resolveId(source, importer) {
            if (source === CARD_SETS_DEV_MODULE) return RESOLVED_ID;
            if (source === CARD_SETS_DEV_LOADER) return RESOLVED_LOADER_ID;
            if (
                source === SET_CHUNK_LOADER_SPECIFIER &&
                isSetModulesBrowserSeam(importer)
            ) {
                return RESOLVED_LOADER_ID;
            }
            return null;
        },
        async load(id) {
            if (id === RESOLVED_LOADER_ID) return cardSetsLoaderSource(sets());
            if (id !== RESOLVED_ID) return null;
            const { code, map } = await build();
            return { code, map };
        },
    };
}
