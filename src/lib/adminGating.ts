// UI admin gating (PRD #466, ADR 0033). The lobby shows an Edit control on
// Preset Decks only to admins. Hiding it is cosmetic — the server still gates
// `updatePreset` via `assertIsAdmin` — but the predicate is extracted and
// unit-tested so the gate can't silently regress. `currentUser` may be
// `undefined` (loading) or `null` (signed out); both must read as "not admin".

export interface AdminGateUser {
    isAdmin?: boolean;
}

/**
 * Whether the lobby should expose the preset Edit control. True only when a
 * loaded user is explicitly flagged `isAdmin`.
 */
export function canEditPresets(
    user: AdminGateUser | null | undefined
): boolean {
    return user?.isAdmin === true;
}

/**
 * Whether the Limited Events page should expose the "Create Event" control
 * (PRD #1107 story 1, ADR 0054/0055). Same predicate as `canEditPresets` —
 * cosmetic only, the server re-gates `createLimitedEvent` via `assertIsAdmin`.
 */
export function canCreateLimitedEvents(
    user: AdminGateUser | null | undefined
): boolean {
    return user?.isAdmin === true;
}

/**
 * Whether the "Review the Table" surface should expose another seat's debug
 * detail — its built deck list and pick order (issue #1583). Cosmetic only:
 * the server projection (`projectLimitedEvent`) already populates another
 * seat's `pool`/`humanDeck` ONLY for an admin, so a non-admin has nothing to
 * disclose there anyway; this predicate keeps the toggle from rendering for a
 * bot seat's (ungated, vs-AI) `autoBuiltDeck`, which every viewer receives.
 */
export function canViewLimitedReviewDetail(
    user: AdminGateUser | null | undefined
): boolean {
    return user?.isAdmin === true;
}
