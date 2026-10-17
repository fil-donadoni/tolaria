// The URL half of the client's compiled shards (issue #5616, ADR 0113
// Amendment VI): `virtual:compiled-shards`'s name and source, the asset and
// dev-server paths, and a SERVE-ONLY plugin naming the dev URLs — what vitest
// loads.
//
// A LEAF on purpose: no `convex/` import, not even through `import()`
// (esbuild bundles that into a config). The encoder (`./compiled-shards`)
// reaches `convex/cards/**`, and a vitest config that imports it — measured:
// every test that loads the hand-written Sets went from 0.4 s to 40 s of Set
// installs, a whole hydration test from 4 s to over 30 s. The full plugin,
// which cuts bytes in a build and on the dev middleware, is
// `./vite-compiled-shards`, for `vite.config.ts` only.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import {
    PACKED_CORPUS_PATH,
    SHARD_DICTIONARY_PATH,
    compiledShardKeys,
} from "./compiled-asset-inputs";

export const COMPILED_SHARDS_MODULE = "virtual:compiled-shards";

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

export const RESOLVED_COMPILED_SHARDS_ID = `\0${COMPILED_SHARDS_MODULE}`;

/** The committed inputs of the shards' bytes, as text. */
export function readCompiledInputs(root: string): {
    packed: string;
    dictionary: string;
} {
    return {
        packed: readFileSync(path.join(root, PACKED_CORPUS_PATH), "utf8"),
        dictionary: readFileSync(
            path.join(root, SHARD_DICTIONARY_PATH),
            "utf8"
        ),
    };
}

/** The module source naming the dev middleware's URLs under `base`. */
export function devModuleSource(root: string, base: string): string {
    const url = (p: string) => JSON.stringify(`${base}${p}`);
    return compiledShardsModuleSource(
        url(DEV_DICTIONARY_PATH),
        url(DEV_INDEX_PATH),
        compiledShardKeys(readCompiledInputs(root).packed).map(
            (key) => [key, url(devShardPath(key))] as const
        )
    );
}

/** Hook FILTERS, so only the virtual id reaches this plugin's JS — not every
 *  module of the graph. */
export const resolveFilter = {
    id: new RegExp(`^${COMPILED_SHARDS_MODULE}$`),
};
export const loadFilter = {
    id: new RegExp(`^${RESOLVED_COMPILED_SHARDS_ID.replace("\0", "\\0")}$`),
};

/** SERVE-ONLY: `virtual:compiled-shards` naming the dev URLs. vitest's
 *  plugin — a test serves the bytes through a `fetch` stub. */
export function compiledShardUrls(): Plugin {
    let config: ResolvedConfig;
    return {
        name: "tolaria-compiled-shard-urls",
        configResolved(resolved) {
            config = resolved;
        },
        resolveId: {
            filter: resolveFilter,
            handler: (source) =>
                source === COMPILED_SHARDS_MODULE
                    ? RESOLVED_COMPILED_SHARDS_ID
                    : null,
        },
        load: {
            filter: loadFilter,
            handler: (id) =>
                id === RESOLVED_COMPILED_SHARDS_ID
                    ? devModuleSource(config.root, config.base)
                    : null,
        },
    };
}
