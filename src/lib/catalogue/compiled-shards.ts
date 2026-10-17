// The CLIENT's compiled corpus, a shard at a time (issue #5616, PRD #5602,
// ADR 0113 Amendment VI): fetching a first-printing Set's shard, the shard
// dictionary every shard decodes against, or the compiled index alone, and
// installing each in the catalogue. The page and the Brain worker each run it
// in their own graph; `./definitionShards` is the one loader that decides
// WHAT to install.
//
// The URLs come from `virtual:compiled-shards`
// (`scripts/lib/vite-compiled-shards.ts`): content-addressed assets cut at
// `vite build` from the server's packed corpus, so a release re-points only
// the shards whose cards changed.
//
// Nothing here is memoised on failure: a retry (the gate's button, the
// board's hold) really re-fetches.
import { dictionaryUrl, indexUrl, shardUrls } from "virtual:compiled-shards";
import { decodeBase64 } from "@convex/cards/packedCorpus";
import {
    isCompiledDefinitionIndex,
    isCompiledShard,
} from "@convex/cards/compiledShard";
import {
    isCompiledIndexInstalled,
    isCompiledShardInstalled,
    registerCompiledIndex,
    registerCompiledShard,
} from "@convex/cards/catalogue";
import { fetchJsonAsset } from "~/lib/fetchJsonAsset";
import { noteResident } from "./residency";

const urls: Readonly<Record<string, string>> = shardUrls;

/** Every compiled shard this build serves, by key (a first-printing Set
 *  code), in key order. */
export const compiledShardKeys: readonly string[] = Object.keys(urls).sort();

/** Whether this build serves a compiled shard keyed `key`. A Manifest's
 *  `setCode` is a hint from the server's index, and server and client
 *  deploys are not atomic: an unknown key is dropped, and the card behind
 *  it is caught by the board's hold instead. */
export function isKnownCompiledShard(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(urls, key);
}

/** The emitted URL of shard `key` — for a test and the measurement. */
export function compiledShardUrl(key: string): string | undefined {
    return isKnownCompiledShard(key) ? urls[key] : undefined;
}

export { dictionaryUrl as shardDictionaryUrl, indexUrl as compiledIndexUrl };

let dictionary: Uint8Array | null = null;
let dictionaryLoad: Promise<Uint8Array> | null = null;

/** Whether the shard dictionary is decoded in this graph. */
export function isShardDictionaryLoaded(): boolean {
    return dictionary !== null;
}

/** Fetch and decode the shard dictionary, once per graph: what every shard's
 *  blocks inflate against. Small and stable across releases — the game
 *  route's gate and the Setup flow's prefetch warm it before any Manifest
 *  exists. */
export function loadShardDictionary(): Promise<Uint8Array> {
    if (dictionary !== null) return Promise.resolve(dictionary);
    if (dictionaryLoad === null) {
        dictionaryLoad = fetchJsonAsset(dictionaryUrl, "shard dictionary")
            .then((body) => {
                const text = (body as { dictionary?: unknown } | null)
                    ?.dictionary;
                if (typeof text !== "string" || text.length === 0) {
                    throw new Error(
                        `shard dictionary ${dictionaryUrl} holds no dictionary`
                    );
                }
                dictionary = decodeBase64(text);
                return dictionary;
            })
            .catch((error: unknown) => {
                dictionaryLoad = null;
                throw error;
            });
    }
    return dictionaryLoad;
}

const shardLoads = new Map<string, Promise<number>>();

/**
 * Make compiled shard `key` resident: fetch it (and the dictionary), install
 * it in the catalogue. Resolves with how many compiled cards it added — `0`
 * for a shard already resident. Rejects for a key this build does not serve.
 */
export function installCompiledShard(key: string): Promise<number> {
    if (isCompiledShardInstalled(key)) return Promise.resolve(0);
    const inFlight = shardLoads.get(key);
    if (inFlight !== undefined) return inFlight;
    const url = compiledShardUrl(key);
    if (url === undefined) {
        return Promise.reject(
            new Error(`Unknown compiled shard: ${key} (not in this build)`)
        );
    }
    const load = Promise.all([
        fetchJsonAsset(url, "compiled shard"),
        loadShardDictionary(),
    ]).then(
        ([shard, bytes]) => {
            shardLoads.delete(key);
            if (!isCompiledShard(shard) || shard.key !== key) {
                throw new Error(
                    `compiled shard ${url} is not the shard ${key}`
                );
            }
            const added = registerCompiledShard(shard, () => bytes);
            noteResident();
            return added;
        },
        (cause: unknown) => {
            shardLoads.delete(key);
            throw cause;
        }
    );
    shardLoads.set(key, load);
    return load;
}

/** WHOLE mode: every compiled shard resident. Resolves with how many
 *  compiled cards were added. */
export async function installAllCompiledShards(): Promise<number> {
    const added = await Promise.all(
        compiledShardKeys.map(installCompiledShard)
    );
    return added.reduce((a, b) => a + b, 0);
}

let indexLoad: Promise<void> | null = null;

/**
 * The compiled index resident: every compiled card's name, Set and lookups,
 * no row. What a surface that lists or resolves NAMES loads on demand — the
 * name-a-card prompt, the strict Import deck, the debug name fields — and
 * what the board's hold loads to learn which shard a compiled card outside
 * the Manifest lives in.
 */
export function installCompiledIndex(): Promise<void> {
    if (isCompiledIndexInstalled()) return Promise.resolve();
    if (indexLoad === null) {
        indexLoad = fetchJsonAsset(indexUrl, "compiled index")
            .then((index) => {
                if (!isCompiledDefinitionIndex(index)) {
                    throw new Error(
                        `compiled index ${indexUrl} is not a Definition Index`
                    );
                }
                registerCompiledIndex(index);
                noteResident();
            })
            .finally(() => {
                indexLoad = null;
            });
    }
    return indexLoad;
}
