// The Verdict Lock as a Verdict source — the corpus loader the Weight Fit
// consumes (issue #3578, PRD #3574, ADR 0128 §2 and §8).
//
// THE LOCK SELECTS. `data/verdicts.lock.json` names, in order, the verdict ids
// a fit runs over, plus the hash of the pack they were read from. The Verdict
// Store holds everything ever submitted, validated or not (ADR 0128 §1), so a
// payload being PRESENT decides nothing: a payload the lock does not name
// never reaches the corpus, and a payload the lock names but nobody supplied
// is a loud failure — a silently shorter corpus fits different weights and
// looks exactly like a fine one. The corpus is decided by a committed file,
// not by what happens to be in the bucket, and that is what makes a weight
// vector re-derivable.
//
// THE NAME IS THE CONTENT. Every selected payload is re-hashed and must come
// to the id the lock names; anything else is corruption or tampering and
// throws. The hash is taken over the judgement AS IT REACHES THE FIT — after
// the upcast and the parse — not over the stored bytes, for two reasons. The
// verdict id's projection (`identity.ts`) reads today's field names, so over
// an older payload it would be blind to a field that version spelled
// differently, and two payloads differing only there would share a name.
// And an upcast must never rename (ADR 0128 §8): an upcaster that changes
// anything the id covers is changing the judgement, not its format, and is
// refused here by the same comparison. What is left outside the check is
// what is outside the id — a candidate's `description` — which the fit never
// reads.
//
// ORDER IS THE LOCK'S. The corpus comes out in lock order, whatever order the
// payloads were supplied in (a pack's lines, a directory listing, a store
// `list`): given one lock, one corpus, to the bit (ADR 0124 §3).
//
// WHAT IS NOT HERE. Fetching — the pack, the machine cache, the store — is the
// caller's (`scripts/lib/verdict-pack-cache.ts`, issue #3581), which keeps this
// module pure: it stays in the Convex bundle and the browser-importable
// engine, like every other module under `gre/`. `packHash` is parsed and
// carried, not checked: verifying a pack against it is that fetch's job, and
// the pack's format is `pack.ts`. Composing the locked verdicts with the blade
// registry's is `lockedCorpus.ts`, kept out of this module so a script can
// verify a pack without importing the registry — which drags the engine's
// setup, and `lib.dom` with it, into the scripts type-check. Provenance is
// not here either — author, note and dates live in attestations (ADR 0128
// §4), which the fit does not read — so a locked verdict carries the
// constants below, the way a registry-derived one does.

import { VERDICT_HASH_PATTERN, verdictIdOf } from "./identity";
import { isJsonObject, parseVerdictJudgement } from "./judgement";
import {
    VERDICT_BASE_SCHEMA_VERSION,
    VERDICT_SCHEMA_VERSION,
    VERDICT_UPCASTERS,
    type VerdictUpcaster,
} from "./upcasters";
import { copyReading, lockReadingProblem } from "./grade";
import type { Verdict, VerdictReading } from "./types";

/** Where the committed lock lives, relative to the repo root. */
export const VERDICT_LOCK_PATH = "data/verdicts.lock.json";

/** The author recorded on a verdict read through the lock. Its real authors
 *  are its attestations, which the fit never reads. */
export const LOCK_VERDICT_AUTHOR = "verdict-lock";

/** The timestamp recorded on a verdict read through the lock. A CONSTANT, for
 *  the reason `REGISTRY_VERDICT_TIMESTAMP` is one; the date is ADR 0128's. */
export const LOCK_VERDICT_TIMESTAMP = "2026-09-14T00:00:00.000Z";

/** A pack hash: a sha256 hex digest. The lock carries one; the pack's object
 *  name is built from one (`pack.ts`). */
export const PACK_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The committed Verdict Lock. */
export type VerdictLock = {
    /** The verdict ids the fit runs over, in corpus order. */
    verdictIds: string[];
    /** The sha256 (hex) of the pack those verdicts were promoted into — over
     *  its uncompressed text, never its gzip bytes (`pack.ts` says why). */
    packHash: string;
    /** The Verdict Grade each named verdict is read with (`grade.ts`), keyed
     *  by id — non-clear readings only, so a lock no grade has reached keeps
     *  its exact bytes. Read off the attestations at promotion: the fit is
     *  re-derivable from this file and the pack, and neither holds those. */
    readings?: Record<string, VerdictReading>;
    /** The named verdicts held out BY RULE (ADR 0186 Decision 7, issue
     *  #10851): the exam side the Weight Fit never reads, whatever their
     *  scenario hashes to (`heldOut.ts`). A subset of `verdictIds`, sorted;
     *  absent on a lock written before the rule — read as none, never
     *  rewritten. Both halves of a Minimal Pair are named or neither is
     *  (`verdictsFromLock` refuses a split unit). */
    examIds?: string[];
};

/** One payload as the caller found it: the verdict id it was stored under
 *  (an object name, a pack line) and the parsed JSON it holds. */
export type StoredVerdictPayload = {
    verdictId: string;
    payload: unknown;
};

/** The payload versions a reader understands. The shipped one is
 *  `VERDICT_SCHEMA`; a test injects its own to exercise a chain. */
export type VerdictSchema = {
    current: number;
    upcasters: Readonly<Record<number, VerdictUpcaster>>;
};

export const VERDICT_SCHEMA: VerdictSchema = {
    current: VERDICT_SCHEMA_VERSION,
    upcasters: VERDICT_UPCASTERS,
};

function bad(where: string, why: string): never {
    throw new Error(`${where}: ${why}`);
}

/** Throws, naming the lock, on a lock no fit may run over. */
function checkVerdictLock(lock: VerdictLock): void {
    if (!Array.isArray(lock.verdictIds)) {
        bad(VERDICT_LOCK_PATH, `"verdictIds" must be an array`);
    }
    const seen = new Set<string>();
    lock.verdictIds.forEach((id, i) => {
        if (typeof id !== "string" || !VERDICT_HASH_PATTERN.test(id)) {
            bad(
                VERDICT_LOCK_PATH,
                `"verdictIds"[${i}] is ${JSON.stringify(id)}, which is not a verdict id`
            );
        }
        // Named twice, a verdict would state its constraint twice and weigh
        // double in the fit — silently, since nothing downstream compares ids.
        if (seen.has(id)) {
            bad(VERDICT_LOCK_PATH, `"verdictIds" names ${id} twice`);
        }
        seen.add(id);
    });
    if (
        typeof lock.packHash !== "string" ||
        !PACK_HASH_PATTERN.test(lock.packHash)
    ) {
        bad(VERDICT_LOCK_PATH, `"packHash" must be a sha256 hex digest`);
    }
    checkExamIds(lock.examIds, seen);
    if (lock.readings === undefined) return;
    if (!isJsonObject(lock.readings)) {
        bad(VERDICT_LOCK_PATH, `"readings" must be an object`);
    }
    const entries2 = Object.entries(lock.readings);
    for (let j = 0; j < entries2.length; j++) {
        const [id, reading] = entries2[j];
        // A reading of a verdict the lock does not name grades nothing the
        // fit reads — a stale line, refused rather than carried.
        if (!seen.has(id)) {
            bad(
                VERDICT_LOCK_PATH,
                `"readings" grades ${id}, which "verdictIds" does not name`
            );
        }
        const problem = lockReadingProblem(reading);
        if (problem !== null) {
            bad(VERDICT_LOCK_PATH, `"readings".${id}: ${problem}`);
        }
    }
}

/** Throws, naming the lock, on an `examIds` no fit may run over: an exam
 *  id the lock does not name would hold out nothing the corpus carries. */
function checkExamIds(
    examIds: VerdictLock["examIds"],
    named: ReadonlySet<string>
): void {
    if (examIds === undefined) return;
    if (!Array.isArray(examIds)) {
        bad(VERDICT_LOCK_PATH, `"examIds" must be an array`);
    }
    const seen = new Set<string>();
    examIds.forEach((id, i) => {
        if (typeof id !== "string" || !named.has(id)) {
            bad(
                VERDICT_LOCK_PATH,
                `"examIds"[${i}] is ${JSON.stringify(id)}, which "verdictIds" does not name`
            );
        }
        if (seen.has(id)) {
            bad(VERDICT_LOCK_PATH, `"examIds" names ${id} twice`);
        }
        seen.add(id);
    });
}

/** `examIds` sorted and copied — `undefined` when there are none, so a lock
 *  written before the rule keeps its exact bytes. */
function sortedExamIds(examIds: VerdictLock["examIds"]): string[] | undefined {
    if (examIds === undefined || examIds.length === 0) return undefined;
    return examIds.slice().sort();
}

/** `readings` in id order, copied — `undefined` when there are none, so an
 *  ungraded lock is written and read exactly as before grades existed. */
function sortedReadings(
    readings: VerdictLock["readings"]
): VerdictLock["readings"] {
    const ids = Object.keys(readings ?? {}).sort();
    if (ids.length === 0) return undefined;
    return Object.fromEntries(
        ids.map((id) => [id, copyReading(readings![id])])
    );
}

/** The lock file's contents as a `VerdictLock`. Throws, naming the lock, on
 *  anything a fit may not run over. */
export function parseVerdictLock(contents: string): VerdictLock {
    let raw: unknown;
    try {
        raw = JSON.parse(contents);
    } catch (error) {
        bad(
            VERDICT_LOCK_PATH,
            `not valid JSON (${error instanceof Error ? error.message : `${error}`})`
        );
    }
    if (!isJsonObject(raw)) bad(VERDICT_LOCK_PATH, "must be a JSON object");
    const lock = {
        verdictIds: raw.verdictIds,
        packHash: raw.packHash,
        ...(raw.readings === undefined ? {} : { readings: raw.readings }),
        ...(raw.examIds === undefined ? {} : { examIds: raw.examIds }),
    } as VerdictLock;
    checkVerdictLock(lock);
    const readings = sortedReadings(lock.readings);
    const examIds = sortedExamIds(lock.examIds);
    return {
        verdictIds: lock.verdictIds.slice(),
        packHash: lock.packHash,
        ...(readings === undefined ? {} : { readings }),
        ...(examIds === undefined ? {} : { examIds }),
    };
}

/** The lock file's contents for `lock` — what `parseVerdictLock` reads back,
 *  in the shape prettier leaves alone. `verdictIds` comes last and one id per
 *  line, so a promotion that appends shows in `git diff` as exactly the ids it
 *  appended: the delta ADR 0128 §7 has a reviewer read. Throws on a lock no
 *  fit may run over, so no command can commit one. */
export function serializeVerdictLock(lock: VerdictLock): string {
    checkVerdictLock(lock);
    const readings = sortedReadings(lock.readings);
    const examIds = sortedExamIds(lock.examIds);
    return `${JSON.stringify(
        {
            packHash: lock.packHash,
            ...(readings === undefined ? {} : { readings }),
            ...(examIds === undefined ? {} : { examIds }),
            verdictIds: lock.verdictIds,
        },
        null,
        4
    )}\n`;
}

/** A deep copy that throws on mutation — what an upcaster is handed. */
function frozenCopy(value: unknown): unknown {
    if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
    if (isJsonObject(value)) {
        return Object.freeze(
            Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, frozenCopy(v)])
            )
        );
    }
    return value;
}

function schemaVersionOf(
    id: string,
    payload: Record<string, unknown>,
    current: number
): number {
    const version = payload.schemaVersion;
    if (version === undefined) return VERDICT_BASE_SCHEMA_VERSION;
    if (
        typeof version !== "number" ||
        !Number.isInteger(version) ||
        version < VERDICT_BASE_SCHEMA_VERSION
    ) {
        bad(
            id,
            `"schemaVersion" ${JSON.stringify(version)} is not a schema version`
        );
    }
    // A payload from the future is not a payload to guess at: reading it as
    // the newest version this build knows would fit whatever the reading
    // happened to produce.
    if (version > current) {
        bad(
            id,
            `unknown "schemaVersion" ${version} — this build reads up to ${current}`
        );
    }
    return version;
}

/** One selected payload as a Verdict: version checked, name verified against
 *  the stored content, upcast to the current version, judgement parsed. */
function verdictFromPayload(
    id: string,
    payload: unknown,
    schema: VerdictSchema
): Verdict {
    if (!isJsonObject(payload)) bad(id, "payload must be a JSON object");
    const stored = schemaVersionOf(id, payload, schema.current);
    let version = stored;

    let lifted: Record<string, unknown> = payload;
    for (; version < schema.current; version++) {
        const upcast = schema.upcasters[version];
        if (upcast === undefined) {
            bad(
                id,
                `no upcaster lifts "schemaVersion" ${version} to ${version + 1}`
            );
        }
        let next: unknown;
        try {
            next = upcast(frozenCopy(lifted) as Record<string, unknown>);
        } catch (error) {
            bad(
                id,
                `the upcaster from "schemaVersion" ${version} threw (${error instanceof Error ? error.message : `${error}`})`
            );
        }
        if (!isJsonObject(next)) {
            bad(
                id,
                `the upcaster from "schemaVersion" ${version} did not return an object`
            );
        }
        lifted = next;
    }

    const judgement = parseVerdictJudgement(id, lifted);
    let actual: string;
    try {
        actual = verdictIdOf(judgement);
    } catch (error) {
        bad(
            id,
            `payload cannot be hashed (${error instanceof Error ? error.message : `${error}`})`
        );
    }
    if (actual !== id) {
        const upcast =
            stored < schema.current
                ? ` after the upcast from "schemaVersion" ${stored}`
                : "";
        bad(
            id,
            `content hashes to ${actual}${upcast}, not to the id the lock names`
        );
    }

    return {
        id,
        ...judgement,
        author: LOCK_VERDICT_AUTHOR,
        createdAt: LOCK_VERDICT_TIMESTAMP,
        source: "store",
    };
}

/**
 * The verdicts the lock names, in lock order, read from the supplied payloads.
 *
 * Throws, naming the verdict, when the lock names an id nobody supplied, when
 * a payload does not hash to the id it is supplied under, when its
 * `schemaVersion` is unknown, or when it does not parse. The CONTENT of a
 * payload the lock does not name is never read — not validated, not hashed —
 * because nothing about it can reach the fit.
 *
 * Its ID is read, though: the same id supplied twice throws even when
 * unselected, identical bytes included. Whatever produced the payloads (a
 * pack, a listing) is broken, and the pack reader (issue #3581) is where
 * that must surface, not in a corpus that happens not to select the line.
 */
export function verdictsFromLock(
    lock: VerdictLock,
    payloads: readonly StoredVerdictPayload[],
    schema: VerdictSchema = VERDICT_SCHEMA
): Verdict[] {
    checkVerdictLock(lock);
    const byId = new Map<string, unknown>();
    for (let i = 0; i < payloads.length; i++) {
        const { verdictId, payload } = payloads[i];
        if (byId.has(verdictId)) {
            bad(verdictId, "supplied twice");
        }
        byId.set(verdictId, payload);
    }
    const exam = new Set(lock.examIds ?? []);
    const verdicts = lock.verdictIds.map((id) => {
        if (!byId.has(id)) {
            bad(
                id,
                `${VERDICT_LOCK_PATH} names this verdict, but no payload was supplied for it`
            );
        }
        const verdict = verdictFromPayload(id, byId.get(id), schema);
        const reading = lock.readings?.[id];
        return {
            ...verdict,
            ...(reading === undefined ? {} : { reading: copyReading(reading) }),
            ...(exam.has(id) ? { heldOutByRule: true as const } : {}),
        };
    });
    checkExamUnits(verdicts, exam);
    return verdicts;
}

/**
 * Throws on a Minimal Pair the exam rule would split (ADR 0148: a unit is one
 * argument, on one side). A right-hand half is on the exam side exactly when
 * its anchor is; a half named by rule whose anchor the lock does not name
 * (a registry anchor, a Test Position) would be fitted through its anchor's
 * unit, so it is refused too.
 */
function checkExamUnits(
    verdicts: readonly Verdict[],
    exam: ReadonlySet<string>
): void {
    if (exam.size === 0) return;
    const named = new Set(verdicts.map((v) => v.id));
    for (let i = 0; i < verdicts.length; i++) {
        const half = verdicts[i];
        if (half.pairOf === undefined) continue;
        const anchorId = half.pairOf.anchorId;
        const halfExam = exam.has(half.id);
        if (!named.has(anchorId)) {
            if (halfExam) {
                bad(
                    VERDICT_LOCK_PATH,
                    `"examIds" names ${half.id}, whose Minimal Pair anchor ${anchorId} the lock does not name — the unit would be fitted through its anchor`
                );
            }
            continue;
        }
        if (halfExam !== exam.has(anchorId)) {
            bad(
                VERDICT_LOCK_PATH,
                `"examIds" splits the Minimal Pair of ${anchorId}: its half ${half.id} is ${halfExam ? "named" : "not named"} and its anchor is ${halfExam ? "not" : "named"} — both halves stay on one side (ADR 0148)`
            );
        }
    }
}
