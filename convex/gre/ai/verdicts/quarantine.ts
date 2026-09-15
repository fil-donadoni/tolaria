// Contested positions, and the quarantine that keeps them out of the Verdict
// Lock (issue #3579, PRD #3574, ADR 0128 §6 and §11).
//
// THE POSITION KEY GROUPS. Judgements sharing a position key (`identity.ts`)
// are about one decision. Because the verdict id is the position key's
// encoding PLUS the answer, the whole classification is a count of distinct
// verdict ids per position key:
//
//   - one id → AGREEMENT. However many times the judgement was recorded, and
//     by however many testers, it is ONE Verdict carrying several
//     attestations, and it states its constraint to the fit once.
//   - two or more ids → a CONTRADICTION, and every member is QUARANTINED:
//     none of them is promotable into the lock until a human resolves it in
//     the admin surface (issue #3582).
//
// WHY NOTHING IS RESOLVED HERE. Averaging the answers would write into the
// weights a preference no player holds, and silently. Fitting both would be
// worse: the fit reports the pair it cannot satisfy as a missing evaluation
// term (ADR 0124 §3), and a disagreement between two people must never arrive
// through that channel. For the same reason "different answers" is taken
// literally — `right [1]` against `right [1, 2]`, or against `forbidden [0]`,
// is contested even where the two could both be true. Deciding that they are
// compatible IS a resolution, and resolutions are a human's (ADR 0128 §6).
// What canonicalisation already equates (`[2, 1]` and `[1, 2]` are one index
// set) is one id, so it never reaches that question.
//
// A HUMAN'S RESOLUTION IS APPLIED, NEVER INFERRED (issue #3582). A
// `VerdictResolution` decides over a set of verdict ids, and it applies to a
// position only while that set is EXACTLY the position's explicit verdicts.
// Then the accepted verdict is promotable and each rejected one is recorded
// with its reason — still classified, never dropped. A verdict arriving after
// the decision changes the set, so the position is contested again and the
// earlier resolution is carried beside it as stale: a decision about two
// answers is not a decision about three. Of several resolutions over the same
// set, the latest (`createdAt`, then id) applies — the store is append-only,
// so changing one's mind is a newer object, never an edit.
//
// ONLY EXPLICIT JUDGEMENTS ARE QUARANTINED (ADR 0128 §11). A verdict counts as
// explicit when at least one attestation says a person GAVE it. A verdict
// attested only implicitly — "the move chosen", not "the move that is right" —
// neither contests an explicit one nor is contested by one, and is not
// promotable either: it waits for the aggregation and trust weight its own PRD
// will define, and fitting it as a right answer is exactly what §11 forbids.
// A verdict with no attestation at all is never promotable (ADR 0128 §4).
//
// THE METRIC. The count of contested positions is reported per corpus and per
// author: a rising number says the quiz is asking its question badly, not that
// testers are careless. The per-author row counts positions the author judged
// explicitly, so a zero is reported too, and issue #3585's per-tester quality
// reads it — alias resolution across deployments is that issue's, so authors are
// compared here as the strings they are. A resolved position is counted apart
// from a contested one: it WAS a disagreement, and it no longer holds anything
// out of the lock.
//
// Pure: no store, no clock, no randomness. Output order is a function of the
// content — ids, keys and authors sorted — never of the input order, so a
// store listing and a pack give one report.

import {
    canonicalJson,
    positionKeyOf,
    verdictIdOf,
    type VerdictJudgement,
} from "./identity";
import {
    decidedVerdictIds,
    resolutionIdOf,
    resolutionProblems,
} from "./resolution";
import type {
    VerdictAttestation,
    VerdictResolution,
    VerdictSourceAxis,
} from "./types";

/** A distinct judgement with every attestation it carries. */
export type AttestedVerdict<V extends VerdictJudgement = VerdictJudgement> = {
    verdictId: string;
    positionKey: string;
    /** One record of this judgement. Records sharing an id differ only
     *  outside what the id covers (provenance, a candidate's `description`);
     *  when several are supplied the one with the smallest canonical encoding
     *  is kept, so the choice is the content's, never the input order's. */
    judgement: V;
    /** One per author, sorted by author, of BOTH axes — a consumer counting
     *  explicit agreement filters on `sourceAxis`, as `byAuthor` does. */
    attestations: VerdictAttestation[];
};

/** A resolution with the name the store keeps it under. */
export type IdentifiedResolution = {
    resolutionId: string;
    resolution: VerdictResolution;
};

/** A position key under which explicit judgements disagree. */
export type ContestedPosition<V extends VerdictJudgement = VerdictJudgement> = {
    positionKey: string;
    /** Every explicit verdict at the key — at least two, sorted by id. All
     *  of them are quarantined. */
    verdicts: AttestedVerdict<V>[];
    /** Resolutions given at this key that no longer apply, because the set
     *  of verdicts they decided over is not the set the key holds now.
     *  Newest first. */
    staleResolutions: IdentifiedResolution[];
};

/** A contested position a human has resolved. */
export type ResolvedPosition<V extends VerdictJudgement = VerdictJudgement> = {
    positionKey: string;
    /** The resolution that applies. */
    applied: IdentifiedResolution;
    /** The verdict judged right — also listed in `promotable` — or `null`. */
    accepted: AttestedVerdict<V> | null;
    /** Every other verdict at the key, with the reason, sorted by id. Kept:
     *  a rejected judgement is evidence, not garbage. */
    rejected: { verdict: AttestedVerdict<V>; reason: string }[];
};

/** One author's share of the contested-position metric. */
export type AuthorContestation = {
    author: string;
    /** Distinct positions the author judged explicitly. */
    judgedPositions: number;
    /** The contested ones among them, sorted. */
    contestedPositionKeys: string[];
    /** The resolved ones among them, sorted. */
    resolvedPositionKeys: string[];
};

export type VerdictQuarantine<V extends VerdictJudgement = VerdictJudgement> = {
    /** Explicit and uncontested, or accepted by a resolution: what a
     *  promotion may put in the lock. Sorted by id. */
    promotable: AttestedVerdict<V>[];
    /** Sorted by position key. */
    contested: ContestedPosition<V>[];
    /** Sorted by position key. */
    resolved: ResolvedPosition<V>[];
    /** Attested only implicitly: neither quarantined nor promotable. */
    implicitOnly: AttestedVerdict<V>[];
    /** No attestation at all: never promotable. */
    unattested: AttestedVerdict<V>[];
    /** Every author with an explicit attestation, sorted. */
    byAuthor: AuthorContestation[];
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function mergedAxis(
    a: VerdictSourceAxis,
    b: VerdictSourceAxis
): VerdictSourceAxis {
    return a === "explicit" || b === "explicit" ? "explicit" : "implicit";
}

function isExplicit(verdict: AttestedVerdict<VerdictJudgement>): boolean {
    return verdict.attestations.some((a) => a.sourceAxis === "explicit");
}

/** Newest first: `createdAt` descending (an undated one is oldest), then id. */
function newestFirst(a: IdentifiedResolution, b: IdentifiedResolution): number {
    const at = a.resolution.createdAt ?? -Infinity;
    const bt = b.resolution.createdAt ?? -Infinity;
    if (at !== bt) return bt - at;
    return byString(a.resolutionId, b.resolutionId);
}

/** Every resolution, identified and grouped by position key. Throws, naming
 *  it, on one that is not a decision (`resolutionProblems`): a malformed
 *  resolution silently skipped reads exactly like an unresolved position. */
function resolutionsByKey(
    resolutions: readonly VerdictResolution[]
): Map<string, IdentifiedResolution[]> {
    const byKey = new Map<string, Map<string, IdentifiedResolution>>();
    for (const resolution of resolutions) {
        const resolutionId = resolutionIdOf(resolution);
        const problems = resolutionProblems(resolution);
        if (problems.length > 0) {
            throw new Error(
                `resolution ${resolutionId} at ${resolution.positionKey}: ${problems.join("; ")}`
            );
        }
        const named =
            byKey.get(resolution.positionKey) ??
            new Map<string, IdentifiedResolution>();
        // One object per name: the same resolution read twice is one.
        if (!named.has(resolutionId)) {
            named.set(resolutionId, { resolutionId, resolution });
        }
        byKey.set(resolution.positionKey, named);
    }
    return new Map(
        [...byKey].map(([key, named]) => [
            key,
            [...named.values()].sort(newestFirst),
        ])
    );
}

/**
 * Classify a set of judgements, their attestations and the resolutions given
 * about them into promotable, contested, resolved, implicit-only and
 * unattested. Throws, naming it, on an attestation whose verdict was not
 * supplied — a silently dropped attestation would move an explicit verdict to
 * implicit-only, or a contested position to an agreed one. The outbox stores
 * the verdict object before its attestation (issue #3580), so an orphan is
 * never an upload race: the caller supplies every verdict its attestations
 * name. A resolution naming verdicts the caller did not supply is NOT an
 * orphan in that sense: it simply does not match the position's set, so the
 * position stays contested — the direction that keeps a judgement out of the
 * lock.
 */
export function quarantineContestedPositions<V extends VerdictJudgement>(
    verdicts: readonly V[],
    attestations: readonly VerdictAttestation[],
    resolutions: readonly VerdictResolution[] = []
): VerdictQuarantine<V> {
    const distinct = new Map<
        string,
        { judgement: V; encoding: string; positionKey: string }
    >();
    for (const verdict of verdicts) {
        const verdictId = verdictIdOf(verdict);
        const encoding = canonicalJson(verdict);
        const earlier = distinct.get(verdictId);
        if (earlier === undefined || encoding < earlier.encoding) {
            distinct.set(verdictId, {
                judgement: verdict,
                encoding,
                positionKey: positionKeyOf(verdict),
            });
        }
    }

    // One attestation per (verdict, author): the store names the object by
    // both, so a second one in the input is the same object read twice.
    const attested = new Map<string, Map<string, VerdictSourceAxis>>();
    for (const attestation of attestations) {
        if (!distinct.has(attestation.verdictId)) {
            throw new Error(
                `${attestation.verdictId}: attested by ${attestation.author}, but no such verdict was supplied`
            );
        }
        const authors =
            attested.get(attestation.verdictId) ??
            new Map<string, VerdictSourceAxis>();
        const earlier = authors.get(attestation.author);
        authors.set(
            attestation.author,
            earlier === undefined
                ? attestation.sourceAxis
                : mergedAxis(earlier, attestation.sourceAxis)
        );
        attested.set(attestation.verdictId, authors);
    }

    const all: AttestedVerdict<V>[] = [...distinct.keys()]
        .sort(byString)
        .map((verdictId) => {
            const { judgement, positionKey } = distinct.get(verdictId)!;
            const authors = attested.get(verdictId) ?? new Map();
            return {
                verdictId,
                positionKey,
                judgement,
                attestations: [...authors.keys()]
                    .sort(byString)
                    .map((author) => ({
                        verdictId,
                        author,
                        sourceAxis: authors.get(author)!,
                    })),
            };
        });

    const explicitByKey = new Map<string, AttestedVerdict<V>[]>();
    const implicitOnly: AttestedVerdict<V>[] = [];
    const unattested: AttestedVerdict<V>[] = [];
    for (const verdict of all) {
        if (verdict.attestations.length === 0) {
            unattested.push(verdict);
        } else if (!isExplicit(verdict)) {
            implicitOnly.push(verdict);
        } else {
            const group = explicitByKey.get(verdict.positionKey) ?? [];
            group.push(verdict);
            explicitByKey.set(verdict.positionKey, group);
        }
    }

    const resolutionsAt = resolutionsByKey(resolutions);
    const promotable: AttestedVerdict<V>[] = [];
    const contested: ContestedPosition<V>[] = [];
    const resolved: ResolvedPosition<V>[] = [];
    for (const positionKey of [...explicitByKey.keys()].sort(byString)) {
        const group = explicitByKey.get(positionKey)!;
        if (group.length < 2) {
            promotable.push(group[0]);
            continue;
        }
        const heldIds = group.map((v) => v.verdictId).join("\n");
        const given = resolutionsAt.get(positionKey) ?? [];
        const applied = given.find(
            ({ resolution }) =>
                decidedVerdictIds(resolution).join("\n") === heldIds
        );
        if (applied === undefined) {
            contested.push({
                positionKey,
                verdicts: group,
                staleResolutions: given,
            });
            continue;
        }
        const reasons = new Map(
            applied.resolution.rejected.map((r) => [r.verdictId, r.reason])
        );
        const accepted =
            group.find(
                (v) => v.verdictId === applied.resolution.acceptedVerdictId
            ) ?? null;
        if (accepted !== null) promotable.push(accepted);
        resolved.push({
            positionKey,
            applied,
            accepted,
            rejected: group
                .filter((v) => reasons.has(v.verdictId))
                .map((verdict) => ({
                    verdict,
                    reason: reasons.get(verdict.verdictId)!,
                })),
        });
    }
    promotable.sort((a, b) => byString(a.verdictId, b.verdictId));

    const contestedKeys = new Set(contested.map((c) => c.positionKey));
    const resolvedKeys = new Set(resolved.map((r) => r.positionKey));
    const judgedByAuthor = new Map<string, Set<string>>();
    for (const group of explicitByKey.values()) {
        for (const verdict of group) {
            for (const attestation of verdict.attestations) {
                if (attestation.sourceAxis !== "explicit") continue;
                const keys =
                    judgedByAuthor.get(attestation.author) ?? new Set<string>();
                keys.add(verdict.positionKey);
                judgedByAuthor.set(attestation.author, keys);
            }
        }
    }
    const byAuthor = [...judgedByAuthor.keys()].sort(byString).map((author) => {
        const keys = [...judgedByAuthor.get(author)!].sort(byString);
        return {
            author,
            judgedPositions: keys.length,
            contestedPositionKeys: keys.filter((key) => contestedKeys.has(key)),
            resolvedPositionKeys: keys.filter((key) => resolvedKeys.has(key)),
        };
    });

    return {
        promotable,
        contested,
        resolved,
        implicitOnly,
        unattested,
        byAuthor,
    };
}

/** The quarantine as the lines a promotion prints. */
export function formatVerdictQuarantine(
    quarantine: VerdictQuarantine<VerdictJudgement>
): string {
    const quarantined = quarantine.contested.reduce(
        (n, c) => n + c.verdicts.length,
        0
    );
    const rejected = quarantine.resolved.reduce(
        (n, r) => n + r.rejected.length,
        0
    );
    const explicitPositions =
        quarantine.promotable.length -
        quarantine.resolved.filter((r) => r.accepted !== null).length +
        quarantine.contested.length +
        quarantine.resolved.length;
    const out = [
        `contested positions    : ${quarantine.contested.length} of ${explicitPositions} explicitly judged`,
        `resolved positions     : ${quarantine.resolved.length}`,
        `quarantined verdicts   : ${quarantined}`,
        `rejected verdicts      : ${rejected}`,
        `promotable verdicts    : ${quarantine.promotable.length}`,
        `implicit-only verdicts : ${quarantine.implicitOnly.length}`,
        `unattested verdicts    : ${quarantine.unattested.length}`,
    ];
    for (const position of quarantine.contested) {
        out.push(`  contested ${position.positionKey}`);
        for (const verdict of position.verdicts) {
            const authors = verdict.attestations
                .filter((a) => a.sourceAxis === "explicit")
                .map((a) => a.author)
                .join(", ");
            out.push(`    ${verdict.verdictId}  by ${authors}`);
        }
    }
    for (const position of quarantine.resolved) {
        out.push(
            `  resolved ${position.positionKey}  by ${position.applied.resolution.author}`
        );
        if (position.accepted !== null) {
            out.push(`    accepted ${position.accepted.verdictId}`);
        }
        for (const { verdict, reason } of position.rejected) {
            out.push(`    rejected ${verdict.verdictId}  (${reason})`);
        }
    }
    if (quarantine.byAuthor.length > 0) out.push("by author:");
    for (const row of quarantine.byAuthor) {
        const resolvedCount = row.resolvedPositionKeys.length;
        out.push(
            `  ${row.author}: ${row.contestedPositionKeys.length} contested of ${row.judgedPositions} judged` +
                (resolvedCount > 0 ? `, ${resolvedCount} resolved` : "")
        );
        for (const key of row.contestedPositionKeys) {
            out.push(`    ${key}`);
        }
    }
    return out.join("\n");
}
