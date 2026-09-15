// The resolution of a Contested Position (issue #3582, PRD #3574, ADR 0128 §6).
//
// A human looked at the board and decided: this verdict is right, and each of
// the others is wrong for this reason — or none of them is right. The decision
// is DATA, stored beside the verdicts it decides over, and it removes nothing:
// a rejected judgement stays in the store, named here with its reason.
//
// IDENTITY. A resolution is named by its decision AND by when it was made —
// the position key, the accepted id, the rejected ids with their reasons, the
// resolver and `createdAt` — but not by the note beside it or where it was
// entered. When belongs in the name because the store is append-only and the
// NEWEST resolution applies (`quarantine.ts`): "accept A", then "accept B",
// then "accept A" again must leave A in force, and it can only do that if the
// third decision is a new object rather than the first one read back with its
// old timestamp. Re-saving is therefore never an overwrite, and a duplicate
// of a decision is harmless — the newest of two identical decisions is still
// that decision.
//
// Pure and dependency-free beyond the identity module, like everything under
// this directory — the Convex bundle, the `"use node"` review action and the
// browser all compute the same name.

import {
    VERDICT_CANONICALISATION,
    VERDICT_HASH_PATTERN,
    canonicalJson,
} from "./identity";
import { sha256Hex } from "./sha256";
import type { VerdictResolution } from "./types";

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every verdict id a resolution decides over: the accepted one, if any, and
 *  the rejected ones — sorted. */
export function decidedVerdictIds(resolution: VerdictResolution): string[] {
    return [
        ...(resolution.acceptedVerdictId === null
            ? []
            : [resolution.acceptedVerdictId]),
        ...resolution.rejected.map((r) => r.verdictId),
    ].sort(byString);
}

/**
 * Every reason `resolution` is not a decision at all, empty when it is one.
 * Checked at the write door AND when a stored object is read back, so a
 * resolution that could never apply is refused where someone can still fix it.
 */
export function resolutionProblems(resolution: VerdictResolution): string[] {
    const problems: string[] = [];
    if (!VERDICT_HASH_PATTERN.test(resolution.positionKey)) {
        problems.push(
            `${JSON.stringify(resolution.positionKey)} is not a position key`
        );
    }
    const decided = decidedVerdictIds(resolution);
    for (const id of decided) {
        if (!VERDICT_HASH_PATTERN.test(id)) {
            problems.push(`${JSON.stringify(id)} is not a verdict id`);
        }
    }
    if (new Set(decided).size !== decided.length) {
        problems.push("a verdict is decided more than once");
    }
    // One verdict is a position nobody disagrees about: there is nothing to
    // resolve, and a "resolution" of it would be a judgement in disguise.
    if (decided.length < 2) {
        problems.push("a resolution decides over at least two verdicts");
    }
    for (const { verdictId, reason } of resolution.rejected) {
        if (reason.trim() === "") {
            problems.push(`${verdictId} is rejected without a reason`);
        }
    }
    return problems;
}

/** The resolution id: `v1-<sha256>` over the decision and when it was made,
 *  never the note or the deployment. Rejected entries are sorted first, so
 *  the order a form listed them in does not move the name. */
export function resolutionIdOf(resolution: VerdictResolution): string {
    const encoding = canonicalJson({
        positionKey: resolution.positionKey,
        acceptedVerdictId: resolution.acceptedVerdictId,
        rejected: [...resolution.rejected]
            .map(({ verdictId, reason }) => ({ verdictId, reason }))
            .sort((a, b) => byString(a.verdictId, b.verdictId)),
        author: resolution.author,
        createdAt: resolution.createdAt,
    });
    return `${VERDICT_CANONICALISATION}-${sha256Hex(encoding)}`;
}
