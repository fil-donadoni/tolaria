// Validation and promotion: how the Verdict Store becomes the Verdict Lock
// (issue #3583, PRD #3574, ADR 0128 §4 / §6 / §7).
//
// THE STORE HOLDS EVERYTHING; THE LOCK HOLDS WHAT IS PROMOTABLE. A verdict
// object is promotable when it is INTEGRAL — its name is its content, the
// loader accepts it, its position rebuilds and still offers its candidates —
// and UNCONFLICTED: at least one explicit attestation, and no other explicit
// judgement at its position key. Everything else stays in the store, and
// `verdicts:validate` says, per object, exactly which of those it failed.
// Nothing here is a judgement about whether a verdict is RIGHT: that is the
// fit report's to surface (ADR 0124 §3), and a human's to read.
//
// "INTEGRAL" IS DECIDED BY THE CODE THAT WILL LOAD IT. The name/content check
// is `decodeVerdictObject`, the parse/upcast/re-hash is `verdictsFromLock`
// itself — so a promotable verdict is one a lock naming it loads, not one a
// second restatement of the loader believed would. The position check is
// injected (`VerdictRebuildCheck`): it needs the engine, and this module is
// imported by the promotion script, whose type-check must not reach the blade
// builder (`scripts/lib/verdict-pack-cache.ts` says why).
//
// THE LOCK GROWS BY APPENDING. A promotion keeps the verdicts the committed
// lock already names, in their order, and appends the new ones sorted by id —
// so its diff is exactly the delta a reviewer reads. A locked verdict that is
// no longer promotable (a later judgement contests it, the engine no longer
// rebuilds its position) is DROPPED and reported: the guard would red on it
// either way, and quarantine applies to a locked verdict as much as to a new
// one (ADR 0128 §6). A locked id the store holds NO object for is not dropped
// but refused — the store is append-only, so that is a broken listing, never
// a corpus change.
//
// RE-RUNNING IS A NO-OP. Same promotable set, same order, same pack text,
// same hash: `noop`, and the runner rewrites nothing.
//
// Pure: no store, no clock. The runner's engine step
// (`convex/gre/ai/blade/verdictPromotion.ts`) binds the rebuild check and the
// fit; `scripts/lib/verdict-promotion-run.ts` does the store I/O and the
// writes.

import {
    decodeAttestationObject,
    decodeResolutionObject,
    decodeVerdictObject,
    verdictIdOfObjectName,
    verdictObjectName,
} from "../../../verdictStore";
import { positionKeyOf, verdictIdOf, type VerdictJudgement } from "./identity";
import {
    verdictsFromLock,
    type StoredVerdictPayload,
    type VerdictLock,
} from "./lockSource";
import { encodeVerdictPack } from "./pack";
import {
    quarantineContestedPositions,
    type VerdictQuarantine,
} from "./quarantine";
import { sha256Hex } from "./sha256";
import type { Verdict, VerdictAttestation, VerdictResolution } from "./types";

/** Where the committed `DEFAULT_EVAL_WEIGHTS` literal lives, relative to the
 *  repo root — the file a promotion rewrites beside the lock. */
export const EVAL_WEIGHTS_PATH = "convex/gre/ai/evalWeights.ts";

/** The environment variables the promotion script hands its engine step's
 *  input and output file paths through (`verdict-promotion.spec.ts`). */
export const VERDICT_PROMOTION_IN_ENV = "VERDICT_PROMOTION_IN";
export const VERDICT_PROMOTION_OUT_ENV = "VERDICT_PROMOTION_OUT";

/** What the script hands the engine step: the committed files it may rewrite
 *  and a snapshot of the store. Bytes travel as base64, so an object that is
 *  not UTF-8 reaches the integrity check as the bytes the store held. */
export type VerdictPromotionInput = {
    mode: "validate" | "promote";
    /** The committed lock file's contents, `null` when there is none. */
    lock: string | null;
    /** The contents of `EVAL_WEIGHTS_PATH`. */
    evalWeightsSource: string;
    verdictObjects: { name: string; base64: string }[];
    attestationObjects: { name: string; base64: string }[];
    /** `resolutions/…` objects (issue #3582). Optional so a snapshot taken
     *  before resolutions existed still reads as "none given". */
    resolutionObjects?: { name: string; base64: string }[];
};

/** What the engine step hands back. A promotion that is not a no-op carries
 *  BOTH files to write — the lock and the weights are one change. */
export type VerdictPromotionOutput =
    | { mode: "validate"; text: string }
    | { mode: "promote"; noop: true; text: string }
    | {
          mode: "promote";
          noop: false;
          text: string;
          lock: VerdictLock;
          lockText: string;
          evalWeightsSource: string;
      };

/** One object as the store listed it. */
export type StoreObject = { name: string; bytes: Uint8Array };

export type VerdictObjectStatus =
    | "promotable"
    | "invalid"
    | "unattested"
    | "implicit-only"
    | "contested"
    | "rejected"
    | "in-registry";

/** One verdict object's classification. `reasons` is empty exactly when the
 *  object is promotable. */
export type VerdictObjectRow = {
    name: string;
    /** `null` when the name is not a verdict object's name at all. */
    verdictId: string | null;
    status: VerdictObjectStatus;
    reasons: string[];
};

export type StoreValidation = {
    /** One per verdict object, sorted by name. */
    rows: VerdictObjectRow[];
    /** Attestation objects that attest nothing a verdict object carries:
     *  unreadable, or naming a verdict the store has no object for. An
     *  attestation of an INVALID verdict is not listed — its verdict's row
     *  already says why neither counts. */
    attestationProblems: { name: string; reason: string }[];
    /** Resolution objects that could not be read (issue #3582). A resolution
     *  that is not read decides nothing, so its position stays contested. */
    resolutionProblems: { name: string; reason: string }[];
    /** The promotable verdicts' payloads, sorted by id. */
    promotable: StoredVerdictPayload[];
    /** The classification of every integral verdict — the contested-position
     *  metric a promotion prints. */
    quarantine: VerdictQuarantine<VerdictJudgement>;
};

/** `null` when the verdict's position rebuilds and yields its pairs, otherwise
 *  why not. */
export type VerdictRebuildCheck = (verdict: Verdict) => string | null;

/** A lock-shaped placeholder for asking the loader about ONE payload: the
 *  loader parses `packHash` and never checks it (`lockSource.ts`). */
const UNCHECKED_PACK_HASH = "0".repeat(64);

const message = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const UNATTESTED_REASON =
    "no attestation — a verdict nobody attested never enters the lock (ADR 0128 §4)";
const IMPLICIT_REASON =
    'attested only implicitly — "the move chosen" is never fitted as "the move that is right" (ADR 0128 §11)';

type Readable =
    | { verdictId: string; judgement: VerdictJudgement }
    | { verdictId: string | null; reason: string };

function readVerdictObject(
    object: StoreObject,
    rebuild: VerdictRebuildCheck
): Readable {
    const verdictId = verdictIdOfObjectName(object.name);
    if (verdictId === null) {
        return {
            verdictId: null,
            reason: "not a verdict object name (verdicts/v1-<sha256>.json)",
        };
    }
    let judgement: VerdictJudgement;
    let verdict: Verdict;
    try {
        judgement = decodeVerdictObject(object.name, object.bytes);
        [verdict] = verdictsFromLock(
            { verdictIds: [verdictId], packHash: UNCHECKED_PACK_HASH },
            [{ verdictId, payload: judgement }]
        );
    } catch (error) {
        return { verdictId, reason: message(error) };
    }
    let stale: string | null;
    try {
        stale = rebuild(verdict);
    } catch (error) {
        stale = message(error);
    }
    return stale === null
        ? { verdictId, judgement }
        : { verdictId, reason: stale };
}

/**
 * Classify every verdict object in a store listing, with the attestations
 * listed beside them. Never throws on an object: whatever is wrong with one is
 * its row's reason.
 *
 * `registry` is the corpus's other, permanent half — the blade registry's
 * verdicts, which every fit reads beside the lock and no promotion can
 * quarantine (they are code). A store verdict is judged against them too: the
 * same judgement is already fitted, so locking it would state its constraint
 * twice (ADR 0128 §4); a different answer at a registry position is a
 * contested position, and fitting it would carry that disagreement into the
 * weights as an unsatisfiable pair (ADR 0128 §6). Neither is promotable.
 */
export function validateStoreObjects(
    verdictObjects: readonly StoreObject[],
    attestationObjects: readonly StoreObject[],
    rebuild: VerdictRebuildCheck,
    registry: readonly Verdict[] = [],
    resolutionObjects: readonly StoreObject[] = []
): StoreValidation {
    const rows: VerdictObjectRow[] = [];
    const readable = new Map<string, VerdictJudgement>();
    const invalidIds = new Set<string>();
    for (const object of [...verdictObjects].sort((a, b) =>
        byString(a.name, b.name)
    )) {
        const read = readVerdictObject(object, rebuild);
        if ("reason" in read) {
            if (read.verdictId !== null) invalidIds.add(read.verdictId);
            rows.push({
                name: object.name,
                verdictId: read.verdictId,
                status: "invalid",
                reasons: [read.reason],
            });
        } else {
            readable.set(read.verdictId, read.judgement);
        }
    }

    const attestations: VerdictAttestation[] = [];
    const attestationProblems: StoreValidation["attestationProblems"] = [];
    for (const object of [...attestationObjects].sort((a, b) =>
        byString(a.name, b.name)
    )) {
        let attestation: VerdictAttestation;
        try {
            attestation = decodeAttestationObject(object.name, object.bytes);
        } catch (error) {
            attestationProblems.push({
                name: object.name,
                reason: message(error),
            });
            continue;
        }
        if (readable.has(attestation.verdictId)) {
            attestations.push(attestation);
        } else if (!invalidIds.has(attestation.verdictId)) {
            attestationProblems.push({
                name: object.name,
                reason: `attests ${attestation.verdictId}, which the store holds no verdict object for`,
            });
        }
    }

    // An admin's resolutions (issue #3582, ADR 0128 §6). A resolution that
    // does not read is a problem, never a guess: its position simply stays
    // contested, the direction that keeps a judgement out of the lock.
    const resolutions: VerdictResolution[] = [];
    const resolutionProblems: StoreValidation["resolutionProblems"] = [];
    for (const object of [...resolutionObjects].sort((a, b) =>
        byString(a.name, b.name)
    )) {
        try {
            resolutions.push(decodeResolutionObject(object.name, object.bytes));
        } catch (error) {
            resolutionProblems.push({
                name: object.name,
                reason: message(error),
            });
        }
    }

    const quarantine = quarantineContestedPositions(
        [...readable.values()],
        attestations,
        resolutions
    );
    const row = (
        verdictId: string,
        status: VerdictObjectStatus,
        reasons: string[]
    ): VerdictObjectRow => ({
        name: verdictObjectName(verdictId),
        verdictId,
        status,
        reasons,
    });
    const registryById = new Map<string, string>();
    const registryByKey = new Map<string, string[]>();
    for (const entry of registry) {
        registryById.set(verdictIdOf(entry), entry.id);
        const key = positionKeyOf(entry);
        registryByKey.set(key, [...(registryByKey.get(key) ?? []), entry.id]);
    }
    const promotable: typeof quarantine.promotable = [];
    for (const v of quarantine.promotable) {
        const same = registryById.get(v.verdictId);
        const rivals = registryByKey.get(v.positionKey);
        if (same !== undefined) {
            rows.push(
                row(v.verdictId, "in-registry", [
                    `already in the corpus as ${same} — one judgement is fitted once, never twice (ADR 0128 §4)`,
                ])
            );
        } else if (rivals !== undefined) {
            rows.push(
                row(v.verdictId, "contested", [
                    `contested — position ${v.positionKey} is judged differently by ${rivals.join(", ")}; the blade registry is code, so resolve it there (ADR 0128 §6)`,
                ])
            );
        } else {
            promotable.push(v);
            rows.push(row(v.verdictId, "promotable", []));
        }
    }
    for (const v of quarantine.unattested) {
        rows.push(row(v.verdictId, "unattested", [UNATTESTED_REASON]));
    }
    for (const v of quarantine.implicitOnly) {
        rows.push(row(v.verdictId, "implicit-only", [IMPLICIT_REASON]));
    }
    for (const position of quarantine.contested) {
        for (const v of position.verdicts) {
            const others = position.verdicts
                .filter((o) => o.verdictId !== v.verdictId)
                .map((o) => o.verdictId);
            rows.push(
                row(v.verdictId, "contested", [
                    `contested — position ${position.positionKey} is also judged ${others.join(", ")}; quarantined until a human resolves it (ADR 0128 §6)`,
                ])
            );
        }
    }
    // A rejected verdict is kept, with the resolver's reason: it stays in the
    // store as evidence and never enters the lock (ADR 0128 §6).
    for (const position of quarantine.resolved) {
        for (const { verdict, reason } of position.rejected) {
            rows.push(
                row(verdict.verdictId, "rejected", [
                    `rejected by ${position.applied.resolution.author} at position ${position.positionKey}: ${reason}`,
                ])
            );
        }
    }
    rows.sort((a, b) => byString(a.name, b.name));

    return {
        rows,
        attestationProblems,
        resolutionProblems,
        promotable: promotable.map((v) => ({
            verdictId: v.verdictId,
            payload: v.judgement,
        })),
        quarantine,
    };
}

export type PromotionPlan = {
    /** The lock a promotion writes, its `packHash` the sha256 of the pack
     *  text `entries` encode to. */
    lock: VerdictLock;
    /** The locked payloads, in lock order — the pack's lines. */
    entries: StoredVerdictPayload[];
    /** Ids the committed lock did not name, sorted. */
    added: string[];
    /** Ids the committed lock named that are no longer promotable. */
    dropped: { verdictId: string; why: string }[];
    /** Nothing to write: the lock this plan would write is the committed one.
     *  With no committed lock, nothing promotable is a no-op too. */
    noop: boolean;
};

/** The lock a promotion writes over `current`. Throws when `current` names a
 *  verdict the store listing holds no object for. */
export function planPromotion(
    current: VerdictLock | null,
    validation: StoreValidation
): PromotionPlan {
    const promotable = new Map(
        validation.promotable.map((entry) => [entry.verdictId, entry])
    );
    const rowById = new Map(
        validation.rows
            .filter((r) => r.verdictId !== null)
            .map((r) => [r.verdictId as string, r])
    );

    const kept: StoredVerdictPayload[] = [];
    const dropped: PromotionPlan["dropped"] = [];
    for (const verdictId of current?.verdictIds ?? []) {
        const entry = promotable.get(verdictId);
        if (entry !== undefined) {
            kept.push(entry);
            continue;
        }
        const row = rowById.get(verdictId);
        if (row === undefined) {
            throw new Error(
                `${verdictId}: the committed lock names this verdict, but the store listing holds no object for it — the store is append-only, so the listing is incomplete; nothing is promoted over it`
            );
        }
        dropped.push({ verdictId, why: row.reasons.join("; ") });
    }

    const keptIds = new Set(kept.map((e) => e.verdictId));
    const appended = validation.promotable.filter(
        (e) => !keptIds.has(e.verdictId)
    );
    const entries = [...kept, ...appended];
    const lock: VerdictLock = {
        verdictIds: entries.map((e) => e.verdictId),
        packHash: sha256Hex(encodeVerdictPack(entries)),
    };
    const noop =
        current === null
            ? entries.length === 0
            : appended.length === 0 &&
              dropped.length === 0 &&
              current.packHash === lock.packHash;
    return {
        lock,
        entries,
        added: appended.map((e) => e.verdictId),
        dropped,
        noop,
    };
}

/** What `verdicts:validate` prints. */
export function formatStoreValidation(validation: StoreValidation): string {
    const count = (status: VerdictObjectStatus) =>
        validation.rows.filter((r) => r.status === status).length;
    const out = [
        `verdict objects        : ${validation.rows.length}`,
        `  promotable           : ${count("promotable")}`,
        `  invalid              : ${count("invalid")}`,
        `  unattested           : ${count("unattested")}`,
        `  implicit-only        : ${count("implicit-only")}`,
        `  contested            : ${count("contested")}`,
        `  rejected             : ${count("rejected")}`,
        `  in-registry          : ${count("in-registry")}`,
        `attestation problems   : ${validation.attestationProblems.length}`,
        `resolution problems    : ${validation.resolutionProblems.length}`,
    ];
    const blocked = validation.rows.filter((r) => r.status !== "promotable");
    if (blocked.length > 0) out.push("", "not promotable:");
    for (const r of blocked) {
        out.push(`  ${r.name}  [${r.status}]`);
        for (const reason of r.reasons) out.push(`    ${reason}`);
    }
    if (validation.attestationProblems.length > 0) {
        out.push("", "attestations that attest no verdict object:");
    }
    for (const p of validation.attestationProblems) {
        out.push(`  ${p.name}`, `    ${p.reason}`);
    }
    if (validation.resolutionProblems.length > 0) {
        out.push("", "resolutions that could not be read:");
    }
    for (const p of validation.resolutionProblems) {
        out.push(`  ${p.name}`, `    ${p.reason}`);
    }
    return out.join("\n");
}

/** A pair as the promotion report prints it — structural, so this module
 *  stays clear of the engine the Eval Pairs are built with. */
export type PromotionReportPair = {
    verdictId: string;
    right: { description: string };
    other: { description: string };
    delta: number;
};

export type PromotionReportInput = {
    plan: PromotionPlan;
    /** How many verdicts the committed lock named. */
    lockedBefore: number;
    /** Eval Pairs of the added verdicts, at the fitted weights. */
    newPairs: PromotionReportPair[];
    /** Every pair still unsatisfied at the fitted weights — never dropped
     *  (ADR 0124 §3). */
    unsatisfied: PromotionReportPair[];
    /** Every fittable weight: the committed value and the fitted one. */
    movement: { key: string; committed: number; fitted: number }[];
};

const pairLines = (pair: PromotionReportPair): string[] => [
    `  ${pair.verdictId}`,
    `      want  ${pair.right.description}`,
    `      over  ${pair.other.description}`,
    `      Δ ${pair.delta.toFixed(1)}`,
];

/** The report a promotion's reviewer reads: the DELTA (ADR 0128 §7). The
 *  blade `must` result is appended by the runner, which is what runs it. */
export function formatPromotionReport(input: PromotionReportInput): string {
    const { plan } = input;
    const moved = input.movement.filter((m) => m.fitted !== m.committed);
    const out = [
        `== Verdict promotion (issue #3583, ADR 0128 §7) — review the DELTA`,
        `  lock                   : ${input.lockedBefore} → ${plan.lock.verdictIds.length} verdicts (+${plan.added.length}, −${plan.dropped.length})`,
        `  pack                   : packs/${plan.lock.packHash}.jsonl.gz`,
        `  new Eval Pairs         : ${input.newPairs.length}`,
        `  unsatisfied pairs      : ${input.unsatisfied.length}`,
        `  weights moved          : ${moved.length} of ${input.movement.length}`,
    ];
    out.push(`\n== verdicts added (${plan.added.length})`);
    for (const id of plan.added) out.push(`  ${id}`);
    if (plan.dropped.length > 0) {
        out.push(
            `\n== verdicts DROPPED from the lock (${plan.dropped.length})`
        );
        for (const d of plan.dropped)
            out.push(`  ${d.verdictId}`, `    ${d.why}`);
    }
    out.push(`\n== new Eval Pairs (${input.newPairs.length})`);
    for (const pair of input.newPairs) out.push(...pairLines(pair));
    out.push(
        `\n== pairs the fit could not satisfy (${input.unsatisfied.length}) — kept, never dropped: each names a missing term, a wrong verdict, or a residual no weight reaches`
    );
    for (const pair of input.unsatisfied) out.push(...pairLines(pair));
    out.push(`\n== weight movement, committed DEFAULT_EVAL_WEIGHTS → fitted`);
    if (moved.length === 0) out.push("  (nothing moved)");
    for (const m of moved) {
        const pct =
            m.committed === 0
                ? ""
                : `   (${m.fitted >= m.committed ? "+" : ""}${((100 * (m.fitted - m.committed)) / m.committed).toFixed(1)}%)`;
        out.push(`  ${m.key.padEnd(26)} ${m.committed} → ${m.fitted}${pct}`);
    }
    return out.join("\n");
}
