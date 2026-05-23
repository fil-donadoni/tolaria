// Shared scope vocabulary and resolver for permanent-anchored trigger
// factories (`tappedTrigger`, `diedTrigger`, `enteredTrigger`,
// `leftTrigger`). Per ADR 0002, all four share the same scope axis so card
// authors learn one vocabulary across every permanent-anchored event.
//
// Scope is purely a relation between the event's affected permanent and the
// trigger's source (CR 109.2 self-reference, CR 109.4 controller). It does
// NOT consult any other filter dimension (types, subtypes, colors) — those
// belong on the factory's `filter` field.

import type { PermanentView } from "../../types";

/** Permanent-anchored scope vocabulary. */
export type PermanentScope =
    /** Only fires when the event's permanent IS the source (CR 109.2). */
    | "self"
    /** Permanents controlled by the source's controller. */
    | "yours"
    /** Permanents controlled by anyone other than the source's controller. */
    | "opponents"
    /** Any permanent on the battlefield. */
    | "any"
    /** Same as "yours" but excludes the source itself (CR 109.2 — "another ~"). */
    | "another-yours"
    /** Same as "any" but excludes the source itself ("permanents other than ~"). */
    | "any-other";

export interface ScopeCandidate {
    /** Instance id of the permanent affected by the event. */
    permanentId: string;
    /** Controller of that permanent at event time (CR 109.5). */
    controllerId: string;
}

/** Returns true if `candidate` matches `scope` relative to `self`. Pure. */
export function matchesPermanentScope(
    scope: PermanentScope,
    candidate: ScopeCandidate,
    self: PermanentView
): boolean {
    const isSelf = candidate.permanentId === self.id;
    const sameController = candidate.controllerId === self.controllerId;
    switch (scope) {
        case "self":
            return isSelf;
        case "yours":
            return sameController;
        case "opponents":
            return !sameController;
        case "any":
            return true;
        case "another-yours":
            return sameController && !isSelf;
        case "any-other":
            return !isSelf;
    }
}
