// The Verdict pack — the READ rendering of a locked corpus (issue #3581,
// PRD #3574, ADR 0128 §9).
//
// The per-verdict objects (`verdicts/v1-<sha256>.json`) are the store's WRITE
// form: immutable, deduplicating, writable from several deployments at once.
// Reading a corpus of thousands through them would be thousands of GETs, so a
// promotion also writes ONE object holding every verdict its lock names —
// `packs/<packHash>.jsonl.gz` — and a machine reads that instead.
//
// THE PACK IS DERIVED AND UNBELIEVED. Nothing in it is trusted because it is
// in the bucket: the committed lock is the only authority. A pack is accepted
// only when (a) its content hashes to the lock's `packHash` (the caller's
// check — hashing and gzip need a runtime this module does not assume), (b) it
// carries EXACTLY the ids the lock names, no more, no fewer, none twice (this
// module), and (c) every payload re-hashes to the id it is carried under
// (`verdictsFromLock`, which the caller runs over what this returns).
//
// THE HASH IS OVER THE JSONL, NOT THE GZIP. Deflate output is not a function
// of its input alone — zlib builds differ, and the gzip header records the
// operating system — so a hash over the compressed bytes would name the same
// corpus differently on two machines, and a promotion on one would never
// verify on the other. Compression is the transport's encoding of the pack;
// the pack is the text. The object is named by that hash, which makes it
// content-addressed exactly the way a verdict object is (ADR 0128 §3): the
// name is derivable from the lock alone, and a cache keyed by it never needs
// invalidating.
//
// ONE LINE, ONE VERDICT: `{"payload":…,"verdictId":…}` in canonical JSON. The
// id travels beside the payload rather than being recomputed from it, because
// the id is taken over the judgement AFTER the upcast (`lockSource.ts`): an
// old-schema payload does not hash to its own name until it has been lifted.
//
// Pure, like every module under `gre/`: text in, payloads out.

import { canonicalJson, VERDICT_HASH_PATTERN } from "./identity";
import { isJsonObject } from "./judgement";
import type { StoredVerdictPayload, VerdictLock } from "./lockSource";

/** Where packs live in the Verdict Store. */
export const VERDICT_PACK_PREFIX = "packs/";

const VERDICT_PACK_SUFFIX = ".jsonl.gz";
const PACK_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** `packs/<packHash>.jsonl.gz` — the one object a lock's corpus is read from.
 *  Throws on anything that is not a sha256 hex digest, so no other string can
 *  become a pack name. */
export function verdictPackObjectName(packHash: string): string {
    if (!PACK_HASH_PATTERN.test(packHash)) {
        throw new Error(`Not a pack hash: ${JSON.stringify(packHash)}`);
    }
    return `${VERDICT_PACK_PREFIX}${packHash}${VERDICT_PACK_SUFFIX}`;
}

/** The pack's text for `entries`, one canonical line each, in the order given
 *  (a promotion passes lock order). The caller hashes and compresses it. */
export function encodeVerdictPack(
    entries: readonly StoredVerdictPayload[]
): string {
    return entries
        .map(({ verdictId, payload }) => canonicalJson({ payload, verdictId }))
        .map((line) => `${line}\n`)
        .join("");
}

/**
 * The payloads a pack's text carries, accepted only if the ids are EXACTLY
 * the lock's. Throws, naming the pack, on a malformed line, an id carried
 * twice, an id the lock does not name, or an id the lock names that the pack
 * lacks.
 *
 * An EXTRA id is refused even though `verdictsFromLock` would never read it:
 * a pack is promoted FOR one lock, so an unselected line means the pack and
 * the lock disagree about what the corpus is, and that disagreement is the
 * thing to surface — not a line to skip.
 *
 * What this does NOT check is that each payload hashes to its id; the caller
 * hands the result to `verdictsFromLock`, which does.
 */
export function parseVerdictPack(
    lock: VerdictLock,
    text: string
): StoredVerdictPayload[] {
    const where = verdictPackObjectName(lock.packHash);
    const bad = (why: string): never => {
        throw new Error(`${where}: ${why}`);
    };

    const entries: StoredVerdictPayload[] = [];
    const seen = new Set<string>();
    const lines = text.split("\n");
    // The encoding ends every line with "\n", so the final split element is
    // empty; any OTHER empty line is not something `encodeVerdictPack` wrote.
    if (lines[lines.length - 1] === "") lines.pop();
    lines.forEach((line, i) => {
        let raw: unknown;
        try {
            raw = JSON.parse(line);
        } catch {
            bad(`line ${i + 1} is not valid JSON`);
        }
        if (
            !isJsonObject(raw) ||
            typeof raw.verdictId !== "string" ||
            !VERDICT_HASH_PATTERN.test(raw.verdictId) ||
            !("payload" in raw)
        ) {
            bad(`line ${i + 1} is not a {verdictId, payload} entry`);
        }
        const { verdictId, payload } = raw as StoredVerdictPayload;
        if (seen.has(verdictId)) bad(`carries ${verdictId} twice`);
        seen.add(verdictId);
        entries.push({ verdictId, payload });
    });

    const named = new Set(lock.verdictIds);
    for (const { verdictId } of entries) {
        if (!named.has(verdictId)) {
            bad(`carries ${verdictId}, which the lock does not name`);
        }
    }
    for (const id of lock.verdictIds) {
        if (!seen.has(id)) bad(`lacks ${id}, which the lock names`);
    }
    return entries;
}
