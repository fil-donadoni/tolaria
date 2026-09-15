// The Verdict Store port (issue #3576, ADR 0128 §1/§3).
//
// One private bucket every deployment writes to and every machine reads from,
// reached through three verbs and nothing else: `get`, `put`, `list`. Two
// implementations stand behind it — the in-memory fake every test in PRD #3574
// runs against (`verdictStoreMemory.ts`) and the thin GCS transport
// (`verdictStoreGcs.ts`). Every DECISION about what goes in the store — which
// name an object gets, which bytes, whether what came back is what was asked
// for — lives HERE, above the port, so it is exercised against the fake and
// the transport carries nothing worth testing (the convention
// `scripts/lib/seed-scenario-run.ts` documents).
//
// THE PORT'S CONTRACT, which both implementations honour:
//
//  - `put` never overwrites. A name that already exists answers `"exists"`,
//    is not an error, and leaves the stored bytes untouched. Objects are
//    content-addressed (ADR 0128 §3), so a second `put` of a verdict name is
//    the same judgement recorded again — on another deployment, or by a drain
//    that retried — and there is nothing to write.
//  - `get` of a missing name is `null`, never a throw: absence is an answer
//    the caller branches on (the outbox's re-read, the pack's cache miss).
//  - `list` returns names only, sorted, under a prefix.
//
// A READER has no `put`. The type split is the code half of ADR 0128's "two
// credentials, never one": what a development machine is handed is a
// `VerdictStoreReader`, so writing from one is a type error before it is an
// IAM refusal.

import {
    VERDICT_HASH_PATTERN,
    canonicalJson,
    verdictIdOf,
    type VerdictJudgement,
} from "./gre/ai/verdicts/identity";
import { utf8Bytes } from "./gre/ai/verdicts/sha256";

/** What a `put` did. `"exists"` is success: the name was already stored. */
export type VerdictStorePutOutcome = "created" | "exists";

/** The read half of the port — all a development machine ever holds. */
export interface VerdictStoreReader {
    /** The object's bytes, or `null` when no object has that name. */
    get(name: string): Promise<Uint8Array | null>;
    /** Every object name under `prefix`, sorted. */
    list(prefix: string): Promise<string[]>;
}

/** The whole port — held only where the write credential lives. */
export interface VerdictStoreWriter extends VerdictStoreReader {
    /** Create `name` with `bytes`, or answer `"exists"` without touching it. */
    put(
        name: string,
        bytes: Uint8Array,
        contentType: string
    ): Promise<VerdictStorePutOutcome>;
}

/** Where verdict objects live in the bucket (ADR 0128 § store layout). */
export const VERDICT_OBJECT_PREFIX = "verdicts/";

const VERDICT_OBJECT_SUFFIX = ".json";
const VERDICT_CONTENT_TYPE = "application/json";

/** A stored object that is not what its name promises. Loud by design: the
 *  name IS the hash, so a mismatch is corruption or tampering, never a
 *  format quirk to shrug past. */
export class VerdictStoreIntegrityError extends Error {
    readonly objectName: string;

    constructor(objectName: string, detail: string) {
        super(`Verdict Store object ${objectName}: ${detail}`);
        this.name = "VerdictStoreIntegrityError";
        this.objectName = objectName;
    }
}

/** `verdicts/v1-<sha256>.json` for a verdict id. Throws on anything that is
 *  not a verdict id, so a position key or a stray string can never be turned
 *  into an object name. */
export function verdictObjectName(verdictId: string): string {
    if (!VERDICT_HASH_PATTERN.test(verdictId)) {
        throw new Error(`Not a verdict id: ${JSON.stringify(verdictId)}`);
    }
    return `${VERDICT_OBJECT_PREFIX}${verdictId}${VERDICT_OBJECT_SUFFIX}`;
}

/** The verdict id a `verdicts/…` object name carries, or `null` when the name
 *  is not a verdict object's. */
export function verdictIdOfObjectName(name: string): string | null {
    if (
        !name.startsWith(VERDICT_OBJECT_PREFIX) ||
        !name.endsWith(VERDICT_OBJECT_SUFFIX)
    ) {
        return null;
    }
    const id = name.slice(
        VERDICT_OBJECT_PREFIX.length,
        name.length - VERDICT_OBJECT_SUFFIX.length
    );
    return VERDICT_HASH_PATTERN.test(id) ? id : null;
}

/** The fields a verdict object carries: the judgement, and nothing that is
 *  not in the hash's domain or beside it. Author, note, timestamps and origin
 *  belong to the ATTESTATION (ADR 0128 §4) — an object that carried them
 *  would differ between two deployments recording the same judgement, and
 *  the whole point of the name is that it does not. Candidate descriptions
 *  stay: they are not hashed, but a rebuilt position needs them to be read. */
function judgementPayload(verdict: VerdictJudgement): VerdictJudgement {
    return {
        spec: verdict.spec,
        ...(verdict.setup !== undefined ? { setup: verdict.setup } : {}),
        seat: verdict.seat,
        ...(verdict.deckKnowledge !== undefined
            ? { deckKnowledge: verdict.deckKnowledge }
            : {}),
        candidates: verdict.candidates,
        answer: verdict.answer,
    };
}

/** A verdict as the object the store holds: its id, its name, its bytes. */
export function encodeVerdictObject(verdict: VerdictJudgement): {
    verdictId: string;
    name: string;
    bytes: Uint8Array;
} {
    const payload = judgementPayload(verdict);
    const verdictId = verdictIdOf(payload);
    return {
        verdictId,
        name: verdictObjectName(verdictId),
        bytes: utf8Bytes(canonicalJson(payload)),
    };
}

/** The judgement stored under `name`, verified: the bytes must decode, parse,
 *  and RE-HASH to the id the name carries. Anything else throws a
 *  `VerdictStoreIntegrityError` naming the object. */
export function decodeVerdictObject(
    name: string,
    bytes: Uint8Array
): VerdictJudgement {
    const expected = verdictIdOfObjectName(name);
    if (expected === null) {
        throw new VerdictStoreIntegrityError(name, "not a verdict object name");
    }
    let verdict: VerdictJudgement;
    let actual: string;
    try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        verdict = JSON.parse(text) as VerdictJudgement;
        actual = verdictIdOf(verdict);
    } catch (error) {
        throw new VerdictStoreIntegrityError(
            name,
            `unreadable (${error instanceof Error ? error.message : String(error)})`
        );
    }
    if (actual !== expected) {
        throw new VerdictStoreIntegrityError(
            name,
            `content hashes to ${actual}, not to the ${expected} its name promises`
        );
    }
    return verdict;
}

/** Store one verdict. Idempotent: the same judgement a second time — from
 *  another deployment, or a retried drain — answers `"exists"`. */
export async function putVerdict(
    store: VerdictStoreWriter,
    verdict: VerdictJudgement
): Promise<{
    verdictId: string;
    name: string;
    outcome: VerdictStorePutOutcome;
}> {
    const { verdictId, name, bytes } = encodeVerdictObject(verdict);
    const outcome = await store.put(name, bytes, VERDICT_CONTENT_TYPE);
    return { verdictId, name, outcome };
}

/** Read one verdict back by id, verified against that id. `null` when the
 *  store has no such object; a throw when it has one that is not it. */
export async function readVerdict(
    store: VerdictStoreReader,
    verdictId: string
): Promise<VerdictJudgement | null> {
    const name = verdictObjectName(verdictId);
    const bytes = await store.get(name);
    return bytes === null ? null : decodeVerdictObject(name, bytes);
}
