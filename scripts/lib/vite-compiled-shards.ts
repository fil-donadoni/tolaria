// The client's compiled corpus as per-Set SHARD ASSETS (issue #5616, PRD
// #5602, ADR 0113 Amendment VI) — the Vite side.
//
// WHAT. `src/lib/catalogue/compiled-shards.ts` imports the virtual module
// `virtual:compiled-shards`: the URL of the shard dictionary, of the compiled
// index, and of every shard by key. Under `vite build` this plugin cuts the
// shards from the server's own `data/catalogue/packed-corpus.json`
// (`./compiled-shards`) and EMITS each as an asset, so its file name carries
// its CONTENT hash (`assets/compiled-shard-<key>-<hash>.json`): immutable by
// construction, and a release that changes one Set's compiled cards re-points
// that Set's URL only. Under the dev server and vitest the URLs name this
// plugin's middleware instead, which cuts the same bytes on first request.
//
// No second copy of the corpus is committed: the shards exist only in `dist/`
// (ADR 0113 Amendment VI). The one committed input of their bytes besides the
// corpus is the frozen shard dictionary (`SHARD_DICTIONARY_PATH`).
//
// BOTH BUILDS. `vite.config.ts` lists this plugin under `plugins` AND
// `worker.plugins` — the Brain worker has its own module graph and plugins
// are not shared with it (`resolve.alias` is). The two builds emit the same
// bytes under the same hashed name; the cut is memoised per input, so it is
// paid once per process.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import {
    PACKED_CORPUS_PATH,
    SHARD_DICTIONARY_PATH,
    compiledShardKeys,
} from "./compiled-asset-inputs";
// TYPE-only, on purpose. The encoder reaches `convex/cards/**`; loaded into
// the server process vitest runs its tests through, it made every test that
// loads the hand-written Sets ten times slower (a whole hydration 4 s → 40 s,
// measured — `./compiled-asset-inputs`). So serving reads only the leaf
// above, and the encoder is `import()`ed where bytes are cut: a build, and
// the dev middleware's first request.
import type { CompiledClientAssets } from "./compiled-shards";

const encoder = () => import("./compiled-shards");

export const COMPILED_SHARDS_MODULE = "virtual:compiled-shards";
const RESOLVED_ID = `\0${COMPILED_SHARDS_MODULE}`;

/** Asset base names; Vite appends `-<hash>.json`. The asset-graph check keys
 *  on the prefix (`scripts/lib/asset-graph.ts` → `CATALOGUE_ASSET`). */
export const COMPILED_ASSET_PREFIX = "compiled-";
export const SHARD_ASSET_NAME = (key: string) =>
    `${COMPILED_ASSET_PREFIX}shard-${key}.json`;
export const INDEX_ASSET_NAME = `${COMPILED_ASSET_PREFIX}index.json`;
export const DICTIONARY_ASSET_NAME = `${COMPILED_ASSET_PREFIX}dictionary.json`;

/** Where the dev server's middleware serves them (and what vitest's module
 *  names): `<base>@compiled-shards/…`. */
export const DEV_PATH = "@compiled-shards/";
export const devShardPath = (key: string) => `${DEV_PATH}shard/${key}.json`;
export const DEV_INDEX_PATH = `${DEV_PATH}index.json`;
export const DEV_DICTIONARY_PATH = `${DEV_PATH}dictionary.json`;

/** `<assetsDir>/<base>-<hash>.json`: the hash is the first 12 hex digits of
 *  the asset's sha256, so the name IS the content — the same bytes always get
 *  the same URL, in the page's build and the worker's alike.
 *
 *  Named here rather than left to the bundler (`[hash]` +
 *  `import.meta.ROLLUP_FILE_URL_*`): the Brain worker is an `iife` bundle,
 *  where that URL is built from `import.meta.url` — rewritten to `{}.url`,
 *  `undefined`, so every shard URL threw in the worker (seen in the first
 *  build). A root-relative string is right in both graphs. */
export function contentAddressedName(
    assetsDir: string,
    name: string,
    source: string
): string {
    const hash = createHash("sha256").update(source).digest("hex");
    const stem = name.replace(/\.json$/, "");
    return `${assetsDir}/${stem}-${hash.slice(0, 12)}.json`;
}

/** The module's source, given each URL as a JS expression (a string
 *  literal). */
export function compiledShardsModuleSource(
    dictionary: string,
    index: string,
    shards: readonly (readonly [key: string, url: string])[]
): string {
    const entries = shards
        .map(([key, url]) => `    ${JSON.stringify(key)}: ${url},`)
        .join("\n");
    return [
        `export const dictionaryUrl = ${dictionary};`,
        `export const indexUrl = ${index};`,
        `export const shardUrls = {\n${entries}\n};`,
        "",
    ].join("\n");
}

/** The two committed inputs, as text, and the assets cut from them —
 *  memoised on the inputs, so a build that runs the plugin in its main and
 *  worker graphs cuts once. */
let memo: { key: string; assets: CompiledClientAssets } | null = null;

function readInputs(root: string): { packed: string; dictionary: string } {
    return {
        packed: readFileSync(path.join(root, PACKED_CORPUS_PATH), "utf8"),
        dictionary: readFileSync(
            path.join(root, SHARD_DICTIONARY_PATH),
            "utf8"
        ),
    };
}

async function assetsOf(root: string): Promise<CompiledClientAssets> {
    const { packed, dictionary } = readInputs(root);
    const { compiledClientAssets } = await encoder();
    const key = createHash("sha256")
        .update(packed)
        .update("\0")
        .update(dictionary)
        .digest("hex");
    if (memo === null || memo.key !== key) {
        memo = { key, assets: compiledClientAssets(packed, dictionary) };
    }
    return memo.assets;
}

export function compiledShards(): Plugin {
    let config: ResolvedConfig;
    return {
        name: "tolaria-compiled-shards",
        configResolved(resolved) {
            config = resolved;
        },
        // Hook FILTERS, not an early return: an unfiltered JS hook is called
        // for every module of the graph, and under vitest that made each of
        // the 1,070 Set modules a round trip into this plugin — a whole
        // hydration test went from 4 s to 40 s (measured).
        resolveId: {
            filter: { id: new RegExp(`^${COMPILED_SHARDS_MODULE}$`) },
            handler(source) {
                return source === COMPILED_SHARDS_MODULE ? RESOLVED_ID : null;
            },
        },
        load: {
            filter: { id: new RegExp(`^${RESOLVED_ID}$`) },
            async handler(id) {
                if (id !== RESOLVED_ID) return null;
                const root = config.root;
                if (config.command === "build") {
                    const assets = await assetsOf(root);
                    const emit = (name: string, source: string) => {
                        const fileName = contentAddressedName(
                            config.build.assetsDir,
                            name,
                            source
                        );
                        this.emitFile({ type: "asset", fileName, source });
                        return JSON.stringify(`${config.base}${fileName}`);
                    };
                    return compiledShardsModuleSource(
                        emit(DICTIONARY_ASSET_NAME, assets.dictionary),
                        emit(INDEX_ASSET_NAME, assets.index),
                        [...assets.shards].map(
                            ([key, json]) =>
                                [
                                    key,
                                    emit(SHARD_ASSET_NAME(key), json),
                                ] as const
                        )
                    );
                }
                const url = (p: string) => JSON.stringify(`${config.base}${p}`);
                const { packed } = readInputs(root);
                return compiledShardsModuleSource(
                    url(DEV_DICTIONARY_PATH),
                    url(DEV_INDEX_PATH),
                    compiledShardKeys(packed).map(
                        (key) => [key, url(devShardPath(key))] as const
                    )
                );
            },
        },
        configureServer(server) {
            const prefix = `${server.config.base}${DEV_PATH}`;
            const bodyAt = async (url: string) => {
                const assets = await assetsOf(server.config.root);
                const rest = url.slice(server.config.base.length);
                const shard = /^@compiled-shards\/shard\/([^/]+)\.json$/.exec(
                    rest
                );
                return rest === DEV_DICTIONARY_PATH
                    ? assets.dictionary
                    : rest === DEV_INDEX_PATH
                      ? assets.index
                      : shard
                        ? assets.shards.get(shard[1]!)
                        : undefined;
            };
            server.middlewares.use((req, res, next) => {
                const url = req.url?.split("?")[0];
                if (url === undefined || !url.startsWith(prefix)) return next();
                bodyAt(url).then((body) => {
                    if (body === undefined) {
                        res.statusCode = 404;
                        res.end();
                        return;
                    }
                    res.setHeader("Content-Type", "application/json");
                    res.end(body);
                }, next);
            });
        },
    };
}
