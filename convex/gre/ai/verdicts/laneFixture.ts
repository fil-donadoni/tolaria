// The `check:ui` lane's verdict fixture, and the one predicate that keeps it
// out of the Verdict Store (issue #4905).
//
// The lane seeds a Contested Position on its throwaway account so the review
// surface has a disagreement to walk (issue #3582). The seed used to refuse
// only a deployment holding the write key — but a local deployment with a
// forward token (issue #3745) drains too, so every lane run that crossed a
// drain uploaded its two fixture attestations into the shared, never-deleted
// store, where the review surface and the promotion read them back forever.
//
// ONE MARK, FOUR SITES. A fixture is an attestation given on a LOCAL
// deployment with this exact note. The same predicate is read by:
//  - the outbox, which refuses to store a fixture row by ANY route (write key
//    or forward) — the guarantee does not depend on enumerating credentials;
//  - the writer's forward door, which refuses one as defence in depth;
//  - both store readers (the review corpus and the promotion), which drop the
//    fixtures that leaked before this existed — the store never deletes.
//
// Pure: imported by the outbox, the forward, the store reader and the seed.

import type { VerdictAttestation } from "./types";

/** The note the lane's seed writes on every fixture verdict row. */
export const LANE_FIXTURE_NOTE = "check:ui fixture";

/** Is this attestation (or outbox row) the lane's fixture? Local-only: a
 *  cloud deployment has no lane, so a cloud row with this note is someone's
 *  real word and stays. */
export function isLaneFixture(
    attested: Pick<VerdictAttestation, "note" | "deploymentKind">
): boolean {
    return (
        attested.note === LANE_FIXTURE_NOTE &&
        attested.deploymentKind === "local"
    );
}

/**
 * Drop the lane's fixtures from a store read: every fixture attestation, and
 * every verdict whose attestations are ALL fixtures. A verdict some real
 * author also attests keeps that author's attestation and stays; a verdict
 * with no attestation at all is not a fixture's and is left to the caller's
 * own rules. Returns the dropped verdict ids so a report can name them.
 */
export function withoutLaneFixtures<A extends VerdictAttestation>(
    attestations: readonly A[]
): { attestations: A[]; fixtureOnlyVerdictIds: Set<string> } {
    const kept: A[] = [];
    const fixtureIds = new Set<string>();
    const realIds = new Set<string>();
    for (const a of attestations) {
        if (isLaneFixture(a)) {
            fixtureIds.add(a.verdictId);
        } else {
            kept.push(a);
            realIds.add(a.verdictId);
        }
    }
    const fixtureOnlyVerdictIds = new Set(
        [...fixtureIds].filter((id) => !realIds.has(id))
    );
    return { attestations: kept, fixtureOnlyVerdictIds };
}
