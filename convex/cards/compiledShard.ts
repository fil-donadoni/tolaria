// A CLIENT shard of the compiled corpus (issue #5616, PRD #5602, ADR 0113
// Amendment VI): the compiled rows of ONE first-printing Set, packed the way
// the server corpus is (`./packedCorpus`), with that Set's slice of the
// compiled Definition Index beside them. A game fetches the shards its
// Definition Manifest names, a whole-catalogue surface every shard.
//
// The server never reads one: it keeps the bundled monolith behind
// `./compiledPool`. Shards are cut from that same file at `vite build`
// (`scripts/lib/vite-compiled-shards.ts`), so no second copy of the corpus is
// committed; this module is the shape and its refusal, shared by the encoder
// (`scripts/lib/compiled-shards.ts`) and the client's loader
// (`src/lib/catalogue/compiled-shards.ts`).
//
// Pure: no JSON import, no module-load work.
import type { CompiledDefinitionIndex } from "./definitionIndex";
import type { PackedBlocks } from "./packedCorpus";

/** One first-printing Set's compiled rows, sorted by id and deflated in
 *  blocks against the SHARD DICTIONARY every shard shares
 *  (`data/catalogue/shard-dictionary.json`) — never the server corpus's own
 *  dictionary, which is resampled from the rows on every regeneration and
 *  would re-point every shard's URL with it. */
export interface CompiledShard
    extends Omit<CompiledDefinitionIndex, "setCodes">, PackedBlocks {
    /** The Set code every row's `setCode` carries: the Manifest's shard key
     *  (`DefinitionManifestEntry.setCode`). The index's per-row `setCodes`
     *  are not on the wire: every one is this key ({@link shardIndexOf}). */
    readonly key: string;
}

/** A shard's slice of the compiled Definition Index, its per-row Set codes
 *  restored — ONE string for every row, not one per row as a parsed array
 *  would hold (at 35k rows that is ~2 MiB of client heap, measured by
 *  `bun run measure:client-heap`). */
export const shardIndexOf = (
    shard: CompiledShard
): CompiledDefinitionIndex => ({
    ids: shard.ids,
    names: shard.names,
    setCodes: new Array<string>(shard.ids.length).fill(shard.key),
    lookups: shard.lookups,
});

/** The fields the decoder and the index read, present and consistent — a
 *  truncated or foreign body is refused by the loader, with its URL, rather
 *  than throwing out of the first `getDefinition` mid-render. */
export function isCompiledDefinitionIndex(
    value: unknown
): value is CompiledDefinitionIndex {
    const p = value as Partial<CompiledDefinitionIndex> | null;
    return (
        typeof p === "object" &&
        p !== null &&
        Array.isArray(p.ids) &&
        Array.isArray(p.names) &&
        Array.isArray(p.setCodes) &&
        typeof p.lookups === "object" &&
        p.lookups !== null &&
        p.ids.length > 0 &&
        p.ids.length === p.names.length &&
        p.ids.length === p.setCodes.length
    );
}

/** A shard's index fields (no `setCodes`: {@link CompiledShard}), plus the
 *  blocks, one first id per block and offsets that tile the block string. */
export function isCompiledShard(value: unknown): value is CompiledShard {
    const p = value as Partial<CompiledShard> | null;
    if (
        typeof p !== "object" ||
        p === null ||
        !Array.isArray(p.ids) ||
        !Array.isArray(p.names) ||
        typeof p.lookups !== "object" ||
        p.lookups === null ||
        p.ids.length === 0 ||
        p.ids.length !== p.names.length
    ) {
        return false;
    }
    if (
        typeof p.key !== "string" ||
        typeof p.blocks !== "string" ||
        typeof p.blockRows !== "number" ||
        !Array.isArray(p.blockOffsets) ||
        !Array.isArray(p.firstIds)
    ) {
        return false;
    }
    const blocks = p.firstIds.length;
    return (
        p.blockOffsets.length === blocks + 1 &&
        p.blockOffsets[blocks] === p.blocks.length &&
        blocks === Math.ceil(p.ids.length / p.blockRows)
    );
}
