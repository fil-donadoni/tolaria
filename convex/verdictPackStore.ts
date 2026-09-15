// Writing a Verdict pack into the store (issue #3583, PRD #3574, ADR 0128 §7 /
// §9) — the deployment half of `bun run verdicts:promote`.
//
// WHY A DEPLOYMENT WRITES IT. Two credentials, never one: a development
// machine decides WHICH verdicts a lock names, but it holds only the reader's
// key. So it hands the ids to `verdictsPack:writePack`, and this module reads
// each object back out of the bucket, builds the pack with the SAME encoder the
// reader parses (`pack.ts`), and stores it under the hash of its text. Nothing
// a caller sends becomes a payload: the pack's bytes are a function of the ids
// and the bucket alone, and the machine — which derived the same hash from its
// own snapshot — refuses to write a lock when the two disagree.
//
// THE STORED OBJECT IS RE-READ. A put that answered "created" or "exists" is
// believed only once the bytes under the name gunzip to text hashing to that
// name, the outbox's discipline (`verdictsOutbox.ts`) applied to the pack.
//
// Pure: gzip and gunzip are injected (the action binds `node:zlib`), so the
// in-memory store carries every test.

import {
    encodeVerdictPack,
    verdictPackObjectName,
} from "./gre/ai/verdicts/pack";
import type { StoredVerdictPayload } from "./gre/ai/verdicts/lockSource";
import { sha256Hex } from "./gre/ai/verdicts/sha256";
import {
    VerdictStoreIntegrityError,
    readVerdict,
    verdictObjectName,
    type VerdictStorePutOutcome,
    type VerdictStoreWriter,
} from "./verdictStore";

const VERDICT_PACK_CONTENT_TYPE = "application/gzip";

/** Verdict objects read at once while building a pack. */
const READ_CONCURRENCY = 16;

export type VerdictPackCodec = {
    gzip(text: string): Uint8Array;
    gunzip(bytes: Uint8Array): string;
};

export type StoredVerdictPack = {
    packHash: string;
    name: string;
    verdicts: number;
    outcome: VerdictStorePutOutcome;
};

/**
 * Store the pack carrying `verdictIds`, in that order, and return its hash.
 * Idempotent: the same ids against the same bucket are the same name, which
 * answers `"exists"`.
 *
 * Throws when an id is named twice, when the store has no object for one, when
 * an object is not what its name promises, or when what the store holds under
 * the pack's name does not read back as the pack.
 */
export async function storeVerdictPack(
    store: VerdictStoreWriter,
    verdictIds: readonly string[],
    codec: VerdictPackCodec
): Promise<StoredVerdictPack> {
    const seen = new Set<string>();
    for (const verdictId of verdictIds) {
        if (seen.has(verdictId)) {
            throw new Error(
                `${verdictId}: named twice — a pack carries a verdict once`
            );
        }
        seen.add(verdictId);
    }
    // Read in bounded parallel batches: one GET at a time is thousands of
    // round trips inside one action's time limit, an unbounded fan-out a
    // self-inflicted rate limit. Order is the ids', whatever order they land.
    const entries: StoredVerdictPayload[] = [];
    for (let i = 0; i < verdictIds.length; i += READ_CONCURRENCY) {
        const batch = verdictIds.slice(i, i + READ_CONCURRENCY);
        const judgements = await Promise.all(
            batch.map((verdictId) => readVerdict(store, verdictId))
        );
        batch.forEach((verdictId, j) => {
            const judgement = judgements[j];
            if (judgement === null) {
                throw new Error(
                    `the Verdict Store has no ${verdictObjectName(verdictId)}, so no pack can carry it`
                );
            }
            entries.push({ verdictId, payload: judgement });
        });
    }

    const text = encodeVerdictPack(entries);
    const packHash = sha256Hex(text);
    const name = verdictPackObjectName(packHash);
    const outcome = await store.put(
        name,
        codec.gzip(text),
        VERDICT_PACK_CONTENT_TYPE
    );

    const back = await store.get(name);
    if (back === null) {
        throw new VerdictStoreIntegrityError(
            name,
            "was put, but is not there on re-read"
        );
    }
    let actual: string;
    try {
        actual = sha256Hex(codec.gunzip(back));
    } catch (error) {
        throw new VerdictStoreIntegrityError(
            name,
            `unreadable on re-read (${error instanceof Error ? error.message : String(error)})`
        );
    }
    if (actual !== packHash) {
        throw new VerdictStoreIntegrityError(
            name,
            `reads back as content hashing to ${actual}, not the pack it is named for`
        );
    }
    return { packHash, name, verdicts: entries.length, outcome };
}
