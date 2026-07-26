// UI gating for Limited Events (PRD #1107, ADR 0054/0055). Hosting a table is
// a normal player action, NOT an admin one: `createLimitedEvent` only requires
// an authenticated caller, and the creator owns the event afterwards through
// `createdBy` (start/cancel). This predicate therefore keys on "the user is
// loaded and signed in", not on `isAdmin` — it used to live in
// `adminGating.ts` and is kept extracted + unit-tested so the gate can't
// silently regress back to admin-only.

export interface LimitedGateUser {
    _id?: string;
}

/**
 * Whether the Limited Events page should expose the "Create Event" control.
 * `user` may be `undefined` (still loading) or `null` (signed out); both read
 * as "no control" — every route is behind `<AuthGate>`, so a signed-in user is
 * the only state that can legitimately create.
 */
export function canCreateLimitedEvents(
    user: LimitedGateUser | null | undefined
): boolean {
    return user != null;
}
