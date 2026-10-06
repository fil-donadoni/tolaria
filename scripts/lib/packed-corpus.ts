/**
 * The PACKED server corpus — the server's rendering of the one catalogue
 * merge (issue #4164, ADR 0113 Amendment III, PRD issue #4161).
 *
 * Until issue #4168 the server bundled the compiled rows as an object literal
 * (`data/oracle-compiled-pool.json`), and module globals do not survive a
 * request: every mutation and query evaluated the whole literal again,
 * +9.6 ms on cloud at 3,144 rows and growing with every row. The packed form
 * costs nothing until a definition is asked for, and then only the block
 * holding it.
 *
 * ── The shape ──────────────────────────────────────────────────────────────
 *
 * The catalogue's server rows (`merge.serverRows`: compiled-only, sorted
 * by id), each serialised exactly as the client asset serialises it, grouped
 * into {@link PACKED_BLOCK_ROWS}-row blocks. Each block is raw-deflated against
 * ONE shared dictionary sampled from the rows, base64-encoded, and the blocks
 * are concatenated into one string; {@link PackedCorpus.blockOffsets} cuts it
 * back up without a split. Beside it:
 *
 *   - `firstIds` — the id of every block's first row, so a lookup
 *     binary-searches to the one block it has to inflate;
 *   - `names` — every row's name in row order, so a name is validated, and its
 *     block found, without inflating anything.
 *
 * The server reads it through `getDefinition`'s packed lookup, built in
 * `convex/cards/compiledPool.ts` (issue #4165; unconditional since #4168).
 *
 * ── Deterministic by construction ──────────────────────────────────────────
 *
 * Same rows in, same bytes out: the rows arrive sorted, the dictionary is a
 * fixed-stride sample of them, the block grouping is fixed-size and deflate is
 * a pure function of its input and options. Nothing reads a clock, a random
 * source or the file system. `fflate` is pinned to an exact version in
 * `package.json`: its deflate output IS the committed bytes, so a silent bump
 * would repack the whole file with no source change.
 *
 * The DECODER lives in `convex/cards/packedCorpus.ts` (issue #4165), beside
 * the server lookup that reads the file, so the guard below decodes with the
 * server's own code rather than a copy of its primitives.
 */
import { deflateSync } from "fflate";
import type { CardDefinition } from "../../convex/cards/types";
import {
    decodeBase64,
    inflateBlock,
    type PackedCorpus,
} from "../../convex/cards/packedCorpus";
import { buildIndexLookups } from "../../convex/cards/definitionIndex";
import { firstIdentityDrift, describeIdentityDrift } from "./catalogue-merge";

/** Where the packed rendering lives. Inside `data/catalogue/` beside the
 *  source hash, under a name the client's `catalogue-*.json` glob does not
 *  match — so no client chunk can pick it up. */
export const PACKED_CORPUS_PATH = "data/catalogue/packed-corpus.json";

/**
 * Rows per deflate block — the trade between bundle bytes (bigger blocks
 * compress better) and the inflate a lookup pays (it inflates the whole
 * block). Chosen from the CLOUD sweep of issue #4167
 * (`bun run perf:catalogue-cloud`, 35,000 synthetic rows, median added
 * latency of a mutation resolving 76 definitions in 76 blocks): 4 → +30 ms /
 * 7.99 MB, 8 → +38 ms / 7.54 MB, 16 → +48 ms / 7.28 MB, 32 → +62 ms /
 * 7.14 MB, 64 → +95 ms / 7.07 MB. Each halving below 64 buys fewer
 * milliseconds for more bytes; 8 is the last step that still buys ~10 ms for
 * a quarter-megabyte, and bytes are isolate heap on every request. It is
 * recorded in the artefact so a decoder never assumes it.
 */
export const PACKED_BLOCK_ROWS = 8;

/** The shared dictionary's size. Deflate's window is 32 KiB, so a longer
 *  dictionary would never be referenced. */
export const PACKED_DICTIONARY_BYTES = 32 * 1024;

/** How many rows the dictionary samples, at a fixed stride across the sorted
 *  rows — enough to cover the field vocabulary, few enough to fit the window. */
const DICTIONARY_SAMPLE_ROWS = 96;

export { inflateBlock, type PackedCorpus };

const toBase64 = (bytes: Uint8Array): string =>
    Buffer.from(bytes).toString("base64");

/**
 * The shared dictionary: rows sampled at a fixed stride, serialised as the
 * blocks serialise them, and the LAST {@link PACKED_DICTIONARY_BYTES} kept —
 * deflate reaches the end of a dictionary with the shortest distances, so the
 * tail is the part worth keeping.
 */
export function sampleDictionary(rows: readonly CardDefinition[]): Uint8Array {
    const stride = Math.max(
        1,
        Math.floor(rows.length / DICTIONARY_SAMPLE_ROWS)
    );
    const sample: string[] = [];
    for (let i = 0; i < rows.length; i += stride) {
        sample.push(JSON.stringify(rows[i]));
    }
    const bytes = new TextEncoder().encode(sample.join(","));
    return bytes.slice(Math.max(0, bytes.length - PACKED_DICTIONARY_BYTES));
}

/** Pack the server rows. `rows` must already be sorted by id — they are
 *  `merge.serverRows`, which is. */
export function packCorpus(
    rows: readonly CardDefinition[],
    sourceHash: string,
    blockRows: number = PACKED_BLOCK_ROWS
): PackedCorpus {
    const dictionary = sampleDictionary(rows);
    const encoder = new TextEncoder();
    const encoded: string[] = [];
    const blockOffsets: number[] = [0];
    const firstIds: string[] = [];
    let offset = 0;
    for (let start = 0; start < rows.length; start += blockRows) {
        const block = rows.slice(start, start + blockRows);
        firstIds.push(block[0]!.id);
        const deflated = deflateSync(encoder.encode(JSON.stringify(block)), {
            level: 9,
            dictionary,
        });
        const text = toBase64(deflated);
        encoded.push(text);
        offset += text.length;
        blockOffsets.push(offset);
    }
    return {
        sourceHash,
        blockRows,
        rowCount: rows.length,
        dictionary: toBase64(dictionary),
        blocks: encoded.join(""),
        blockOffsets,
        firstIds,
        names: rows.map((r) => r.name),
        // The compiled section of the Definition Index (issue #4856,
        // `convex/cards/definitionIndex.ts`): what the catalogue reads at load
        // instead of walking the rows.
        ids: rows.map((r) => r.id),
        setCodes: rows.map((r) => r.setCode ?? ""),
        lookups: buildIndexLookups(rows),
    };
}

/** The committed bytes: minified, newline-terminated, keys in declaration
 *  order. `data/catalogue/` is in `.prettierignore`. */
export const serializePackedCorpus = (packed: PackedCorpus): string =>
    JSON.stringify(packed) + "\n";

/** Every row, in order — the guard's view, never a request's. */
export function unpackCorpus(packed: PackedCorpus): CardDefinition[] {
    const dictionary = decodeBase64(packed.dictionary);
    const rows: CardDefinition[] = [];
    for (let k = 0; k < packed.firstIds.length; k++) {
        rows.push(...inflateBlock(packed, k, dictionary));
    }
    return rows;
}

/**
 * The shape a lookup relies on before it inflates anything: one offset per
 * block plus the end, offsets that tile the whole string, one first id per
 * block, and first ids strictly ascending in CODE-POINT order — the order a
 * binary search with `<` assumes, which `localeCompare` (the merge's sort)
 * only agrees with because every id is a lowercase UUID.
 */
function structuralDrift(packed: PackedCorpus): string | null {
    const blocks = Math.ceil(packed.rowCount / packed.blockRows);
    if (packed.firstIds.length !== blocks) {
        return `first-id index holds ${packed.firstIds.length} ids for ${blocks} blocks of ${packed.blockRows}`;
    }
    const offsets = packed.blockOffsets;
    if (
        offsets.length !== blocks + 1 ||
        offsets[0] !== 0 ||
        offsets[blocks] !== packed.blocks.length
    ) {
        return `block offsets do not tile the ${packed.blocks.length}-character block string in ${blocks} blocks`;
    }
    for (let k = 1; k < blocks; k++) {
        if (offsets[k]! <= offsets[k - 1]!) {
            return `block ${k} starts at ${offsets[k]}, not after block ${k - 1} (${offsets[k - 1]})`;
        }
        if (!(packed.firstIds[k - 1]! < packed.firstIds[k]!)) {
            return `first-id index is not in code-point order at block ${k}: ${packed.firstIds[k - 1]} then ${packed.firstIds[k]}`;
        }
    }
    return null;
}

/**
 * The first way the packed rendering disagrees with the rows it must carry,
 * as one gate line naming the card — or `null` when it decodes to exactly
 * `expected`, under `sourceHash`, with both indexes true to the rows.
 *
 * A block that does not inflate is named by its first row's card (from the
 * name index, which needs no inflate), because "block 41" is not a diagnosis.
 */
export function packedCorpusDrift(
    packed: PackedCorpus,
    expected: readonly CardDefinition[],
    sourceHash: string
): string | null {
    if (packed.sourceHash !== sourceHash) {
        return `source hash ${packed.sourceHash} is not the catalogue's ${sourceHash}`;
    }
    const structural = structuralDrift(packed);
    if (structural !== null) return structural;
    const dictionary = decodeBase64(packed.dictionary);
    const rows: CardDefinition[] = [];
    for (let k = 0; k < packed.firstIds.length; k++) {
        try {
            rows.push(...inflateBlock(packed, k, dictionary));
        } catch (error) {
            const name = packed.names[k * packed.blockRows] ?? "?";
            return (
                `block ${k} (first row ${name}, ${packed.firstIds[k]}) does not decode: ` +
                (error instanceof Error ? error.message : String(error))
            );
        }
    }
    const drift = firstIdentityDrift(rows, expected);
    if (drift !== null) return describeIdentityDrift(drift);
    if (packed.rowCount !== rows.length) {
        return `rowCount says ${packed.rowCount}, the blocks hold ${rows.length}`;
    }
    for (let i = 0; i < rows.length; i++) {
        if (packed.ids[i] !== rows[i]!.id) {
            return `id index row ${i} says ${packed.ids[i]}, the row is ${rows[i]!.name} (${rows[i]!.id})`;
        }
        if (packed.setCodes[i] !== (rows[i]!.setCode ?? "")) {
            return `set index row ${i} says ${packed.setCodes[i]}, the row ${rows[i]!.name} is from ${rows[i]!.setCode ?? "no Set"}`;
        }
        if (packed.names[i] !== rows[i]!.name) {
            return `name index row ${i} says ${packed.names[i]}, the row is ${rows[i]!.name} (${rows[i]!.id})`;
        }
        if (i % packed.blockRows === 0) {
            const k = i / packed.blockRows;
            if (packed.firstIds[k] !== rows[i]!.id) {
                return `first-id index block ${k} says ${packed.firstIds[k]}, the block starts with ${rows[i]!.name} (${rows[i]!.id})`;
            }
        }
    }
    if (packed.names.length !== rows.length) {
        return `name index holds ${packed.names.length} names for ${rows.length} rows`;
    }
    if (
        packed.ids.length !== rows.length ||
        packed.setCodes.length !== rows.length
    ) {
        return `id/set indexes hold ${packed.ids.length}/${packed.setCodes.length} entries for ${rows.length} rows`;
    }
    if (
        JSON.stringify(packed.lookups) !==
        JSON.stringify(buildIndexLookups(rows))
    ) {
        return "the Definition Index lookups (twin names, choosable names, back-face triggers) are not the rows' — run `bun run catalogue:pack`";
    }
    return null;
}
