// The client's compiled shards (issue #5616, PRD #5602, ADR 0113 Amendment
// VI), proven against the server's packed corpus they are cut from.
//
//  1. EQUIVALENCE over the whole compiled Definition Index: every compiled
//     Card ID decodes through its shard to the very row the packed-corpus
//     path decodes it to. Prior art: issue #4165, issue #4861.
//  2. PARTITION: every row lives in exactly one shard, the one its
//     first-printing Set keys — the key the Definition Manifest carries — and
//     each shard's index slice is the corpus index's.
//  3. STABLE URLS: a release that changes one Set's compiled cards changes
//     that Set's shard bytes, hence its content-addressed URL, and no other.
//     Shown by cutting twice with one card changed, and with one card added.
//  4. The frozen dictionary is committed, decodes, and fits deflate's window.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    createBlockLookup,
    createPackedLookup,
    decodeBase64,
    type PackedCorpus,
} from "../../convex/cards/packedCorpus";
import { isCompiledShard } from "../../convex/cards/compiledShard";
import { buildIndexLookups } from "../../convex/cards/definitionIndex";
import type { CardDefinition } from "../../convex/cards/types";
import {
    PACKED_CORPUS_PATH,
    PACKED_DICTIONARY_BYTES,
    unpackCorpus,
} from "../lib/packed-corpus";
import {
    SHARD_DICTIONARY_PATH,
    buildCompiledShards,
    compiledClientAssets,
    compiledIndexOf,
    compiledShardKeys,
    type ShardDictionaryFile,
} from "../lib/compiled-shards";
import {
    SHARD_ASSET_NAME,
    contentAddressedName,
} from "../lib/vite-compiled-shard-urls";

const ROOT = resolve(__dirname, "..", "..");
const PACKED_TEXT = readFileSync(join(ROOT, PACKED_CORPUS_PATH), "utf8");
const PACKED = JSON.parse(PACKED_TEXT) as PackedCorpus;
const DICTIONARY_TEXT = readFileSync(join(ROOT, SHARD_DICTIONARY_PATH), "utf8");
const DICTIONARY = decodeBase64(
    (JSON.parse(DICTIONARY_TEXT) as ShardDictionaryFile).dictionary
);
const ROWS = unpackCorpus(PACKED);
const SHARDS = buildCompiledShards(ROWS, DICTIONARY);

/** Shard key → its content-addressed asset file name, as the build names it. */
const urlsOf = (rows: readonly CardDefinition[]): Map<string, string> =>
    new Map(
        buildCompiledShards(rows, DICTIONARY).map((s) => [
            s.key,
            contentAddressedName(
                "assets",
                SHARD_ASSET_NAME(s.key),
                JSON.stringify(s)
            ),
        ])
    );

describe("compiled shards — equivalence with the packed corpus", () => {
    it("every compiled Card ID decodes through its shard to the row the packed-corpus path decodes", () => {
        const monolith = createPackedLookup(PACKED);
        let checked = 0;
        for (const shard of SHARDS) {
            expect(isCompiledShard(shard), shard.key).toBe(true);
            const lookup = createBlockLookup(shard, () => DICTIONARY);
            for (const id of shard.ids) {
                expect(lookup.lookup(id), id).toEqual(monolith.lookup(id));
                checked++;
            }
        }
        expect(checked).toBe(PACKED.ids.length);
    });

    it("a shard serves only its own rows", () => {
        const [first, second] = SHARDS;
        const lookup = createBlockLookup(first!, () => DICTIONARY);
        expect(lookup.lookup(second!.ids[0]!)).toBeNull();
    });
});

describe("compiled shards — one shard per first-printing Set", () => {
    it("partitions the corpus by the Set the Definition Manifest keys a card with", () => {
        const placed = new Map<string, string>();
        for (const shard of SHARDS) {
            for (let i = 0; i < shard.ids.length; i++) {
                expect(placed.has(shard.ids[i]!), shard.ids[i]).toBe(false);
                placed.set(shard.ids[i]!, shard.key);
            }
        }
        expect(placed.size).toBe(PACKED.ids.length);
        PACKED.ids.forEach((id, row) =>
            expect(placed.get(id), id).toBe(PACKED.setCodes[row])
        );
        expect(SHARDS.map((s) => s.key)).toEqual(
            compiledShardKeys(PACKED_TEXT)
        );
    });

    it("each shard's index slice is the corpus index's: names in id order, lookups its rows'", () => {
        const nameOf = new Map(
            PACKED.ids.map((id, i) => [id, PACKED.names[i]])
        );
        for (const shard of SHARDS) {
            expect([...shard.ids].sort()).toEqual(shard.ids);
            expect(shard.names).toEqual(shard.ids.map((id) => nameOf.get(id)));
            const own = new Set(shard.ids);
            const rows = ROWS.filter((r) => own.has(r.id));
            expect(shard.lookups).toEqual(buildIndexLookups(rows));
        }
    });

    it("the compiled index asset is the corpus's index, no row", () => {
        const assets = compiledClientAssets(PACKED_TEXT, DICTIONARY_TEXT);
        expect(JSON.parse(assets.index)).toEqual({
            ids: PACKED.ids,
            names: PACKED.names,
            setCodes: PACKED.setCodes,
            lookups: PACKED.lookups,
        });
        expect(compiledIndexOf(PACKED)).not.toHaveProperty("blocks");
        expect(assets.dictionary).toBe(DICTIONARY_TEXT);
        expect([...assets.shards.keys()]).toEqual(SHARDS.map((s) => s.key));
    });
});

describe("compiled shards — a release re-points only the shards whose cards changed", () => {
    const before = urlsOf(ROWS);

    it("cutting twice gives the same bytes, hence the same URLs", () => {
        expect(urlsOf(ROWS)).toEqual(before);
    });

    it("one card changed: its Set's shard URL changes, no other", () => {
        const target = ROWS[Math.floor(ROWS.length / 2)]!;
        const changed = ROWS.map((r) =>
            r.id === target.id ? { ...r, name: `${r.name} (errata)` } : r
        );
        const after = urlsOf(changed);
        const moved = [...after].filter(
            ([key, url]) => before.get(key) !== url
        );
        expect(moved.map(([key]) => key)).toEqual([target.setCode]);
    });

    it("one card added to a Set: that Set's shard URL changes, no other", () => {
        const sibling = ROWS.find((r) => r.setCode === SHARDS[0]!.key)!;
        const added = [
            ...ROWS,
            {
                ...sibling,
                id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                name: "New Card",
            },
        ];
        const after = urlsOf(added);
        const moved = [...after].filter(
            ([key, url]) => before.get(key) !== url
        );
        expect(moved.map(([key]) => key)).toEqual([SHARDS[0]!.key]);
    });

    it("a URL is its bytes: a different shard body is a different name", () => {
        expect(
            contentAddressedName("assets", "compiled-shard-x.json", "a")
        ).not.toBe(
            contentAddressedName("assets", "compiled-shard-x.json", "b")
        );
        expect(
            contentAddressedName("assets", "compiled-shard-x.json", "a")
        ).toMatch(/^assets\/compiled-shard-x-[0-9a-f]{12}\.json$/);
    });
});

describe("compiled shards — the frozen dictionary, and the shape refusal", () => {
    it("is committed, decodes, and fits deflate's 32 KiB window", () => {
        expect(DICTIONARY.length).toBeGreaterThan(0);
        expect(DICTIONARY.length).toBeLessThanOrEqual(PACKED_DICTIONARY_BYTES);
    });

    it("a truncated or foreign body is refused before it reaches the catalogue", () => {
        const shard = SHARDS[0]!;
        expect(isCompiledShard({ ...shard, firstIds: [] })).toBe(false);
        expect(
            isCompiledShard({ ...shard, blocks: shard.blocks.slice(1) })
        ).toBe(false);
        expect(isCompiledShard({ ...shard, key: undefined })).toBe(false);
        expect(isCompiledShard(PACKED)).toBe(false);
    });
});
