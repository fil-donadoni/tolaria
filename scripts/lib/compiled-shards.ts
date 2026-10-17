/**
 * The CLIENT's compiled corpus, cut into per-Set shards (issue #5616, PRD
 * #5602, ADR 0113 Amendment VI) — the encoder. The decoder and the shape live
 * in `convex/cards/compiledShard.ts` / `convex/cards/packedCorpus.ts`.
 *
 * ── What a client fetches ─────────────────────────────────────────────────
 *
 *   - one SHARD per first-printing Set (`CardDefinition.setCode`, the key the
 *     Definition Manifest already carries): that Set's rows, sorted by id,
 *     in the server corpus's block format, beside its slice of the compiled
 *     Definition Index. A game fetches the shards its Manifest names.
 *   - the SHARD DICTIONARY every shard's blocks are deflated against.
 *   - the compiled INDEX alone (ids, names, Sets, lookups; no row), fetched
 *     only by a surface that lists or resolves NAMES.
 *
 * Nothing here is committed but the dictionary: `vite build` cuts the shards
 * from the server's own `data/catalogue/packed-corpus.json`
 * (`./vite-compiled-shards`), so the corpus has one committed copy.
 *
 * ── Why Set, and why a FROZEN dictionary ──────────────────────────────────
 *
 * Decks cluster by Set; the server corpus's blocks are in UUID order, which
 * would scatter one deck over ≈ 60 blocks. Measured at 5,560 rows: 223 Sets,
 * the largest 111 rows.
 *
 * A shard's URL is its content hash, and a release must re-point only the
 * shards whose cards changed. So a shard's bytes must depend on its own rows
 * and NOTHING else — not on the server corpus's dictionary, which
 * `sampleDictionary` resamples from every row at every regeneration. The
 * shards share one dictionary that is committed once and never regenerated
 * by `catalogue:pack` (`SHARD_DICTIONARY_PATH`, written by
 * `bun run catalogue:shard-dictionary`). What it is sampled from barely
 * matters: at 5,560 rows, 8-row blocks over every shard came to 619 KB gzip
 * against a dictionary sampled from every row, 619 KB from a third of them,
 * 613 KB from the first thousand, and 1,048 KB with none.
 *
 * Deterministic: the same rows and dictionary give the same bytes (sorted
 * rows, sorted keys, `fflate` pinned — see `./packed-corpus`).
 */
import type { CardDefinition } from "../../convex/cards/types";
import type { CompiledShard } from "../../convex/cards/compiledShard";
import {
    buildIndexLookups,
    type CompiledDefinitionIndex,
} from "../../convex/cards/definitionIndex";
import { decodeBase64 } from "../../convex/cards/packedCorpus";
import {
    packBlocks,
    sampleDictionary,
    toBase64,
    unpackCorpus,
    type PackedCorpus,
} from "./packed-corpus";

/** The committed shard dictionary: `{ "dictionary": "<base64>" }`, served
 *  as its own asset and decoded once per graph. */
export const SHARD_DICTIONARY_PATH = "data/catalogue/shard-dictionary.json";

export interface ShardDictionaryFile {
    /** base64 of the raw deflate dictionary. */
    readonly dictionary: string;
}

/** The dictionary file `catalogue:shard-dictionary` writes from `rows`. */
export const serializeShardDictionary = (
    rows: readonly CardDefinition[]
): string =>
    JSON.stringify({
        dictionary: toBase64(sampleDictionary(rows)),
    } satisfies ShardDictionaryFile) + "\n";

/**
 * Every shard of `rows` (sorted by id, as the server corpus holds them), in
 * key order: one per distinct `setCode`, its rows in id order, blocks
 * deflated against `dictionary`.
 */
export function buildCompiledShards(
    rows: readonly CardDefinition[],
    dictionary: Uint8Array
): CompiledShard[] {
    const bySet = new Map<string, CardDefinition[]>();
    for (const row of rows) {
        const key = row.setCode ?? "";
        const group = bySet.get(key);
        if (group) group.push(row);
        else bySet.set(key, [row]);
    }
    return [...bySet.keys()]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((key) => {
            const group = bySet.get(key)!;
            return {
                key,
                ...packBlocks(group, dictionary),
                ids: group.map((r) => r.id),
                names: group.map((r) => r.name),
                lookups: buildIndexLookups(group),
            };
        });
}

/** The compiled Definition Index alone — the server corpus's index fields,
 *  no row. */
export const compiledIndexOf = (
    packed: PackedCorpus
): CompiledDefinitionIndex => ({
    ids: packed.ids,
    names: packed.names,
    setCodes: packed.setCodes,
    lookups: packed.lookups,
});

/** Every file a client build serves for the compiled corpus, as text. */
export interface CompiledClientAssets {
    readonly dictionary: string;
    readonly index: string;
    /** Shard key → the shard's JSON. */
    readonly shards: ReadonlyMap<string, string>;
}

/** The client's compiled assets, cut from the committed server corpus and
 *  the committed shard dictionary (both as file text). */
export function compiledClientAssets(
    packedText: string,
    dictionaryText: string
): CompiledClientAssets {
    const packed = JSON.parse(packedText) as PackedCorpus;
    const { dictionary } = JSON.parse(dictionaryText) as ShardDictionaryFile;
    const shards = buildCompiledShards(
        unpackCorpus(packed),
        decodeBase64(dictionary)
    );
    return {
        dictionary: dictionaryText,
        index: JSON.stringify(compiledIndexOf(packed)),
        shards: new Map(shards.map((s) => [s.key, JSON.stringify(s)])),
    };
}

/** The shard keys of the committed corpus, read off its index — no row
 *  decoded. What the dev server and the tests name URLs from. */
export const compiledShardKeys = (packedText: string): string[] =>
    [...new Set((JSON.parse(packedText) as PackedCorpus).setCodes)].sort(
        (a, b) => (a < b ? -1 : a > b ? 1 : 0)
    );
