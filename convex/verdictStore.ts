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
import type { VerdictAttestation } from "./gre/ai/verdicts/types";

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
    // An empty `setup` / `deckKnowledge` is dropped exactly as `identity.ts`
    // drops it from the hash, so one judgement has ONE byte encoding whichever
    // deployment writes it first.
    return {
        spec: verdict.spec,
        ...(verdict.setup?.length ? { setup: verdict.setup } : {}),
        seat: verdict.seat,
        ...(verdict.deckKnowledge?.length
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

/** The judgement stored under `name`, verified twice: the bytes must RE-HASH
 *  to the id the name carries, AND they must be exactly the canonical encoding
 *  of the judgement they parse to — so an added field, a reformatting or a
 *  corrupted byte fails even where the hash alone would not see it. Anything
 *  else throws a `VerdictStoreIntegrityError` naming the object.
 *
 *  What neither check can vouch for: a candidate's `description`. It is
 *  outside the hash by design (`identity.ts` — describer wording may change
 *  without the judgement changing), so an object re-canonicalised with other
 *  wording still passes. It is display text; nothing the fit reads uses it. */
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
    let canonical: Uint8Array;
    try {
        // No `fatal` decoding: a malformed byte becomes U+FFFD, and the
        // canonical-bytes comparison below rejects it without depending on
        // the option being supported by every runtime this module runs in.
        const text = new TextDecoder().decode(bytes);
        verdict = judgementPayload(JSON.parse(text) as VerdictJudgement);
        actual = verdictIdOf(verdict);
        canonical = utf8Bytes(canonicalJson(verdict));
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
    if (!sameBytes(canonical, bytes)) {
        throw new VerdictStoreIntegrityError(
            name,
            "bytes are not the canonical encoding of the judgement they carry"
        );
    }
    return verdict;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
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

// ── Attestations (issue #3580, ADR 0128 §4) ──────────────────────────────────
//
// One object per (verdict, author): `attestations/<verdictId>/<author>`. The
// name is decided by what is attested and by whom, so a second upload of the
// same author's word — a retried drain, the same tester judging the same
// position twice — lands on the name that already exists and the port answers
// `"exists"`. What the FIRST upload said (its time, its note) is what stays:
// the port never overwrites, and nothing the fit reads is in either field.

/** Where attestation objects live in the bucket. */
export const ATTESTATION_OBJECT_PREFIX = "attestations/";

/** The deployment half of an author: a Convex deployment's name, or
 *  `local-<port>` for a local backend (`verdictsOutbox.ts`). */
export const VERDICT_DEPLOYMENT_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

/** `${deployment}:${userId}` (ADR 0128 §4). The shape cannot hold an `@`, a
 *  space or a `/`, so an email, a nickname with a space, or a path segment is
 *  refused by the pattern rather than by a reviewer noticing. */
export const VERDICT_AUTHOR_PATTERN = /^[a-z0-9][a-z0-9.-]*:[A-Za-z0-9_-]+$/;

/** The author identity of `userId` on `deployment`. User ids are
 *  per-deployment, so the deployment is part of who someone is — the same
 *  person on two deployments is two authors here, and joining them is issue
 *  #3585's, never a guess made at write time. */
export function verdictAuthorOf(deployment: string, userId: string): string {
    const author = `${deployment}:${userId}`;
    if (!VERDICT_AUTHOR_PATTERN.test(author)) {
        throw new Error(`Not a verdict author: ${JSON.stringify(author)}`);
    }
    return author;
}

/** `attestations/<verdictId>/<author>`. Throws on a malformed half, so an
 *  email can never become part of an object name. */
export function attestationObjectName(
    verdictId: string,
    author: string
): string {
    if (!VERDICT_HASH_PATTERN.test(verdictId)) {
        throw new Error(`Not a verdict id: ${JSON.stringify(verdictId)}`);
    }
    if (!VERDICT_AUTHOR_PATTERN.test(author)) {
        throw new Error(`Not a verdict author: ${JSON.stringify(author)}`);
    }
    return `${ATTESTATION_OBJECT_PREFIX}${verdictId}/${author}`;
}

const ATTESTATION_CONTENT_TYPE = "application/json";

/** The attestation's fields, field by field — never "whatever the caller
 *  passed", so a stray property cannot ride into the bucket. */
function attestationPayload(
    attestation: VerdictAttestation
): VerdictAttestation {
    return {
        verdictId: attestation.verdictId,
        author: attestation.author,
        sourceAxis: attestation.sourceAxis,
        ...(attestation.createdAt === undefined
            ? {}
            : { createdAt: attestation.createdAt }),
        ...(attestation.note === undefined ? {} : { note: attestation.note }),
        ...(attestation.deployment === undefined
            ? {}
            : { deployment: attestation.deployment }),
        ...(attestation.deploymentKind === undefined
            ? {}
            : { deploymentKind: attestation.deploymentKind }),
        ...(attestation.botPickIndex === undefined
            ? {}
            : { botPickIndex: attestation.botPickIndex }),
        ...(attestation.gameId === undefined
            ? {}
            : { gameId: attestation.gameId }),
        ...(attestation.seq === undefined ? {} : { seq: attestation.seq }),
    };
}

/** An attestation as the object the store holds: its name and its bytes. */
export function encodeAttestationObject(attestation: VerdictAttestation): {
    name: string;
    bytes: Uint8Array;
} {
    const payload = attestationPayload(attestation);
    return {
        name: attestationObjectName(payload.verdictId, payload.author),
        bytes: utf8Bytes(canonicalJson(payload)),
    };
}

/** The attestation stored under `name`, verified: it must name the verdict and
 *  the author its object name carries, and its bytes must be exactly the
 *  canonical encoding of what they parse to. */
export function decodeAttestationObject(
    name: string,
    bytes: Uint8Array
): VerdictAttestation {
    let attestation: VerdictAttestation;
    let canonical: Uint8Array;
    try {
        const raw = JSON.parse(new TextDecoder().decode(bytes)) as
            | VerdictAttestation
            | null
            | undefined;
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error("not a JSON object");
        }
        attestation = attestationPayload(raw);
        canonical = utf8Bytes(canonicalJson(attestation));
    } catch (error) {
        throw new VerdictStoreIntegrityError(
            name,
            `unreadable (${error instanceof Error ? error.message : String(error)})`
        );
    }
    let expected: string;
    try {
        expected = attestationObjectName(
            attestation.verdictId,
            attestation.author
        );
    } catch (error) {
        throw new VerdictStoreIntegrityError(
            name,
            error instanceof Error ? error.message : String(error)
        );
    }
    if (expected !== name) {
        throw new VerdictStoreIntegrityError(
            name,
            `attests ${attestation.verdictId} by ${attestation.author}, which is not what its name promises`
        );
    }
    if (
        attestation.sourceAxis !== "explicit" &&
        attestation.sourceAxis !== "implicit"
    ) {
        throw new VerdictStoreIntegrityError(name, "has no source axis");
    }
    // Canonical bytes say nothing about TYPES: `"createdAt":"x"` is canonical.
    const mistyped = (
        [
            ["createdAt", "number"],
            ["note", "string"],
            ["deployment", "string"],
            ["botPickIndex", "number"],
            ["gameId", "string"],
            ["seq", "number"],
        ] as const
    ).find(
        ([field, type]) =>
            attestation[field] !== undefined &&
            typeof attestation[field] !== type
    );
    if (
        mistyped !== undefined ||
        (attestation.deploymentKind !== undefined &&
            attestation.deploymentKind !== "cloud" &&
            attestation.deploymentKind !== "local")
    ) {
        throw new VerdictStoreIntegrityError(
            name,
            `field ${mistyped?.[0] ?? "deploymentKind"} has the wrong type`
        );
    }
    if (!sameBytes(canonical, bytes)) {
        throw new VerdictStoreIntegrityError(
            name,
            "bytes are not the canonical encoding of the attestation they carry"
        );
    }
    return attestation;
}

/** Store one attestation. Idempotent per (verdict, author). */
export async function putAttestation(
    store: VerdictStoreWriter,
    attestation: VerdictAttestation
): Promise<{ name: string; outcome: VerdictStorePutOutcome }> {
    const { name, bytes } = encodeAttestationObject(attestation);
    const outcome = await store.put(name, bytes, ATTESTATION_CONTENT_TYPE);
    return { name, outcome };
}

/** Read one author's attestation of one verdict back, verified against its
 *  name. `null` when the store has none. */
export async function readAttestation(
    store: VerdictStoreReader,
    verdictId: string,
    author: string
): Promise<VerdictAttestation | null> {
    const name = attestationObjectName(verdictId, author);
    const bytes = await store.get(name);
    return bytes === null ? null : decodeAttestationObject(name, bytes);
}
