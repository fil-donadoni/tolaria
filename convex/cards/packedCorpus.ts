// The PACKED server corpus — its shape and its decoder (issue #4165, PRD
// #4161, ADR 0113 Amendment III). The ENCODER stays with the generator
// (`scripts/lib/packed-corpus.ts`, issue #4164); everything a request needs to
// read a row back lives here, so the gate decodes with the server's own code
// rather than a copy of its primitives.
//
// Pure: no JSON import, no module-load work. The one module that imports the
// committed artefact is `./compiledPool` — the seam the client build aliases
// away (`scripts/__tests__/compiled-pool-client-seam.test.ts`) — so no byte of
// it reaches a client chunk through this file.
//
// Runtime: only `atob`, `TextDecoder` and `fflate`'s synchronous inflate — what
// the Convex runtime offers (no native zlib, no async).
import { inflateSync } from "fflate";
import type { CardDefinition } from "./types";

export interface PackedCorpus {
    /** The ONE source hash — the same value `data/catalogue/source-hash.json`
     *  holds and the client asset carries in its file name. */
    readonly sourceHash: string;
    readonly blockRows: number;
    readonly rowCount: number;
    /** base64 of the raw deflate dictionary. */
    readonly dictionary: string;
    /** Every block's base64, concatenated. */
    readonly blocks: string;
    /** `blocks.slice(blockOffsets[k], blockOffsets[k + 1])` is block `k`;
     *  one more entry than there are blocks. */
    readonly blockOffsets: readonly number[];
    /** The first row's id of every block, ascending in code-point order. */
    readonly firstIds: readonly string[];
    /** Every row's name, in row order: row `i` lives in block
     *  `floor(i / blockRows)`. */
    readonly names: readonly string[];
}

export function decodeBase64(text: string): Uint8Array {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** Inflate ONE block — the unit a server lookup pays for. */
export function inflateBlock(
    packed: PackedCorpus,
    block: number,
    dictionary: Uint8Array = decodeBase64(packed.dictionary)
): CardDefinition[] {
    const text = packed.blocks.slice(
        packed.blockOffsets[block],
        packed.blockOffsets[block + 1]
    );
    const bytes = inflateSync(decodeBase64(text), { dictionary });
    return JSON.parse(new TextDecoder().decode(bytes)) as CardDefinition[];
}

/** The block that holds `id` if any block does: the last block whose first id
 *  is `<=` it, by binary search over `firstIds` (code-point order, which is
 *  the order the generator's structural guard pins). `-1` when `id` sorts
 *  before the first row. */
export function blockFor(packed: PackedCorpus, id: string): number {
    let lo = 0;
    let hi = packed.firstIds.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (packed.firstIds[mid]! <= id) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found;
}

/** Compiled rows are keyed by a Scryfall UUID (ADR 0108) — lowercase,
 *  which is why code-point order and the merge's sort agree. Anything else (a
 *  `token:` id, `face-down:…`, a test's synthetic id) can never be a packed
 *  row, so it is refused before a block is chosen: tokens and hand-written
 *  definitions pay nothing new for the fallback. */
const PACKED_ROW_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PackedLookup {
    /** The packed row for `id`, or `null` — a non-UUID id inflates nothing,
     *  an absent UUID inflates the one block it would live in. */
    readonly lookup: (id: string) => CardDefinition | null;
    /** How many inflates this lookup has run — one per block while the memo
     *  holds, which is what a test bounds it by. */
    readonly inflations: () => number;
}

/**
 * A lookup over `packed` with a block memo: a block is inflated the first time
 * any of its rows is asked for, and every later ask — the same id or a
 * neighbour — reads the memo.
 *
 * The memo needs no invalidation. On the server it lives in a module global,
 * and module globals do not survive a request (ADR 0113 Amendment III), so it
 * is per-request by construction; the artefact it reads is immutable for the
 * lifetime of the deployment.
 */
export function createPackedLookup(packed: PackedCorpus): PackedLookup {
    const blocks = new Map<number, ReadonlyMap<string, CardDefinition>>();
    let dictionary: Uint8Array | null = null;
    let inflated = 0;
    const rowsOf = (block: number): ReadonlyMap<string, CardDefinition> => {
        const memo = blocks.get(block);
        if (memo) return memo;
        dictionary ??= decodeBase64(packed.dictionary);
        inflated++;
        const rows = new Map(
            inflateBlock(packed, block, dictionary).map((row) => [row.id, row])
        );
        blocks.set(block, rows);
        return rows;
    };
    return {
        lookup: (id) => {
            if (!PACKED_ROW_ID.test(id)) return null;
            const block = blockFor(packed, id);
            if (block < 0) return null;
            return rowsOf(block).get(id) ?? null;
        },
        inflations: () => inflated,
    };
}
