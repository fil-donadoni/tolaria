// The client's compiled assets as a test serves them (issue #5616): cut from
// the committed packed corpus and shard dictionary by the build's own encoder
// (`scripts/lib/compiled-shards.ts`), keyed by the URLs the client's loader
// reads off `virtual:compiled-shards` — the dev middleware's, under vitest.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";
import {
    compiledClientAssets,
    type CompiledClientAssets,
} from "../../../../scripts/lib/compiled-shards";
import {
    compiledIndexUrl,
    compiledShardUrl,
    shardDictionaryUrl,
} from "../compiled-shards";
import { decodeBase64, type PackedCorpus } from "@convex/cards/packedCorpus";
import type { CompiledShard } from "@convex/cards/compiledShard";

const REPO = resolve(__dirname, "../../../..");

export const PACKED_TEXT = readFileSync(
    resolve(REPO, "data/catalogue/packed-corpus.json"),
    "utf8"
);
export const PACKED = JSON.parse(PACKED_TEXT) as PackedCorpus;
const DICTIONARY_TEXT = readFileSync(
    resolve(REPO, "data/catalogue/shard-dictionary.json"),
    "utf8"
);

let assets: CompiledClientAssets | null = null;

/** Every compiled asset, cut once per test file. */
export function compiledAssets(): CompiledClientAssets {
    assets ??= compiledClientAssets(PACKED_TEXT, DICTIONARY_TEXT);
    return assets;
}

/** The shards as objects, in key order. */
export function compiledShards(): CompiledShard[] {
    return [...compiledAssets().shards.values()].map(
        (json) => JSON.parse(json) as CompiledShard
    );
}

/** The shard dictionary's bytes. */
export const shardDictionary = (): Uint8Array =>
    decodeBase64(
        (JSON.parse(DICTIONARY_TEXT) as { dictionary: string }).dictionary
    );

/** URL → body, for every asset the loader can ask for. */
function bodies(): Map<string, string> {
    const a = compiledAssets();
    const out = new Map<string, string>([
        [shardDictionaryUrl, a.dictionary],
        [compiledIndexUrl, a.index],
    ]);
    for (const [key, json] of a.shards) out.set(compiledShardUrl(key)!, json);
    return out;
}

/** A `fetch` stub serving every compiled asset by URL — a fresh parse per
 *  call, as a real fetch gives — and 404 for anything else. */
export function serveCompiledAssets() {
    const served = bodies();
    return vi.fn((url: string) => {
        const body = served.get(url);
        return Promise.resolve({
            ok: body !== undefined,
            status: body === undefined ? 404 : 200,
            statusText: body === undefined ? "Not Found" : "OK",
            json: () =>
                body === undefined
                    ? Promise.reject(new Error("no body"))
                    : Promise.resolve(JSON.parse(body) as unknown),
        } as Response);
    });
}

/** The URLs a fetch stub was asked for. */
export const fetchedUrls = (mock: ReturnType<typeof serveCompiledAssets>) =>
    mock.mock.calls.map(([url]) => url);
