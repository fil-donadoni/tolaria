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

/**
 * Whether the `/admin/*` section renders at all — the header's Admin menu and
 * every page under it (Scenarios, Banlists, Pick Ratings, Card Profiles, Draft
 * Lab, Design System). ONE predicate for the whole section rather than one per
 * page: the pages differ in what they expose but not in who may see them, and
 * a single gate is what lets `AdminRouteGate` sit above the section's `Outlet`
 * instead of being re-derived (and eventually forgotten) per route.
 *
 * Cosmetic on its own, as always: each admin mutation/query behind these pages
 * gates on `assertIsAdmin` server-side, which is the real boundary. The gate
 * fails CLOSED while the current-user query is in flight (`undefined`), so a
 * non-admin never sees a frame of an admin page — and, for pages whose hooks
 * call admin-gated queries (the Draft Lab), never mounts those hooks at all.
 */
export function canViewAdminSection(
    user: AdminGateUser | null | undefined
): boolean {
    return user?.isAdmin === true;
}
