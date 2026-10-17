// The client's compiled corpus as per-Set SHARD ASSETS (issue #5616, PRD
// #5602, ADR 0113 Amendment VI) — the Vite side, for `vite.config.ts`.
//
// WHAT. `src/lib/catalogue/compiled-shards.ts` imports the virtual module
// `virtual:compiled-shards`: the URL of the shard dictionary, of the compiled
// index, and of every shard by key. Under `vite build` this plugin cuts the
// shards from the server's own `data/catalogue/packed-corpus.json`
// (`./compiled-shards`) and EMITS each as an asset whose file name carries
// its CONTENT hash (`assets/compiled-shard-<key>-<hash>.json`,
// `contentAddressedName`): immutable by construction, and a release that
// changes one Set's compiled cards re-points that Set's URL only. Under the
// dev server the URLs name this plugin's middleware instead, which cuts the
// same bytes on first request.
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
//
// THE ENCODER RUNS IN A SUBPROCESS (`scripts/compiled-client-assets.ts`),
// never in this module's import graph: it reaches `convex/cards/**`, and in
// `vite.config.ts`'s static closure that made every engine module part of
// "the build configuration" — `check:ui` scoped every engine diff to the full
// walk (`scripts/lib/ui-scope.ts`, pinned by `ui-scope-shell.test.ts`) — and
// in a vitest config it made Set installs ten times slower. The cut runs ONCE
// per process per input (a build and its worker build share it), into a
// fresh temporary directory nobody else writes, and is refused unless the
// cutter read exactly the bytes this process hashed. No cache survives the
// process: the cut is ~1 s, and an on-disk cache keyed by the inputs alone
// would keep serving the old format after a change to the encoder itself.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import type { CompiledClientAssets } from "./compiled-shards";
import {
    COMPILED_SHARDS_MODULE,
    DEV_DICTIONARY_PATH,
    DEV_INDEX_PATH,
    DEV_PATH,
    DICTIONARY_ASSET_NAME,
    INDEX_ASSET_NAME,
    RESOLVED_COMPILED_SHARDS_ID,
    SHARD_ASSET_NAME,
    compiledShardsModuleSource,
    contentAddressedName,
    devModuleSource,
    loadFilter,
    readCompiledInputs,
    resolveFilter,
} from "./vite-compiled-shard-urls";
import {
    PACKED_CORPUS_PATH,
    SHARD_DICTIONARY_PATH,
} from "./compiled-asset-inputs";

/** The assets cut from the committed inputs — memoised on the inputs, so a
 *  build that runs the plugin in its main and worker graphs cuts once, and
 *  on their mtimes first, so the dev middleware does not re-hash the corpus
 *  on each of a page's 223 shard requests. */
let memo: { stamp: string; key: string; assets: CompiledClientAssets } | null =
    null;

/** The hash the cutter must report back: the bytes it read. Same function
 *  as `scripts/compiled-client-assets.ts` computes. */
export const inputsHash = (packed: string, dictionary: string): string =>
    createHash("sha256")
        .update(packed)
        .update("\0")
        .update(dictionary)
        .digest("hex");

function assetsOf(root: string): CompiledClientAssets {
    const stamp = [PACKED_CORPUS_PATH, SHARD_DICTIONARY_PATH]
        .map((p) => {
            const st = statSync(path.join(root, p));
            return `${st.mtimeMs}:${st.size}`;
        })
        .join("|");
    if (memo !== null && memo.stamp === stamp) return memo.assets;
    const { packed, dictionary } = readCompiledInputs(root);
    const key = inputsHash(packed, dictionary);
    if (memo !== null && memo.key === key) {
        memo = { ...memo, stamp };
        return memo.assets;
    }
    const dir = mkdtempSync(path.join(tmpdir(), "tolaria-compiled-shards-"));
    try {
        const cut = spawnSync(
            "bun",
            [path.join(root, "scripts/compiled-client-assets.ts"), dir],
            { cwd: root, encoding: "utf8" }
        );
        if (cut.status !== 0) {
            throw new Error(
                `compiled shards: the cut failed (status ${cut.status}): ${cut.stderr}`
            );
        }
        const read = (file: string) =>
            readFileSync(path.join(dir, file), "utf8");
        if (read("inputs.sha256") !== key) {
            throw new Error(
                "compiled shards: the inputs changed during the cut — run the build again"
            );
        }
        const keys = JSON.parse(read("keys.json")) as string[];
        const assets: CompiledClientAssets = {
            dictionary: read("dictionary.json"),
            index: read("index.json"),
            shards: new Map(keys.map((k) => [k, read(`shard-${k}.json`)])),
        };
        memo = { stamp, key, assets };
        return assets;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

export function compiledShards(): Plugin {
    let config: ResolvedConfig;
    return {
        name: "tolaria-compiled-shards",
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
            handler(id) {
                if (id !== RESOLVED_COMPILED_SHARDS_ID) return null;
                if (config.command !== "build") {
                    // A regenerated corpus (a new Set code) re-renders the
                    // URL module, instead of a 404 until a restart.
                    this.addWatchFile(
                        path.join(config.root, PACKED_CORPUS_PATH)
                    );
                    return devModuleSource(config.root, config.base);
                }
                const assets = assetsOf(config.root);
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
                            [key, emit(SHARD_ASSET_NAME(key), json)] as const
                    )
                );
            },
        },
        configureServer(server) {
            const prefix = `${server.config.base}${DEV_PATH}`;
            const bodyAt = (url: string) => {
                const assets = assetsOf(server.config.root);
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
                const body = bodyAt(url);
                if (body === undefined) {
                    res.statusCode = 404;
                    res.end();
                    return;
                }
                res.setHeader("Content-Type", "application/json");
                res.end(body);
            });
        },
    };
}
