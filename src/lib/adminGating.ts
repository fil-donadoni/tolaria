// UI admin gating (PRD #466, ADR 0033). The lobby shows an Edit control on
// Preset Decks only to admins. Hiding it is cosmetic — the server still gates
// `updatePreset` via `assertIsAdmin` — but the predicate is extracted and
// unit-tested so the gate can't silently regress. `currentUser` may be
// `undefined` (loading) or `null` (signed out); both must read as "not admin".

export interface AdminGateUser {
    isAdmin?: boolean;
    isTester?: boolean;
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

/**
 * Whether this account may give a Verdict — judge a Bot decision as
 * "it should have played X here" (issue #3402, PRD #3397, ADR 0124 §1).
 *
 * The client mirror of `isTesterUser` (`convex/auth.ts`), and it must keep
 * agreeing with it: EVERY ADMIN IS A TESTER. The role is granted from the
 * admin area, so an admin who did not count as a tester would have to grant it
 * to themselves before they could judge anything — a boundary that protects
 * nobody from anyone. The converse does not hold.
 *
 * Cosmetic, as always: `verdicts.submit` is `assertIsTester`-gated server-side
 * and that is the real boundary. This decides whether a control renders.
 */
export function canSubmitVerdicts(
    user: AdminGateUser | null | undefined
): boolean {
    return user?.isTester === true || user?.isAdmin === true;
}

/**
 * Whether the game board mounts the Debug sheet — the left sheet holding the
 * AI decision box and the three tester actions (issue #3403, PRD #3397).
 *
 * Same population as {@link canSubmitVerdicts} and for the same reason: the
 * sheet is where a tester WATCHES the decision they are about to judge, so an
 * account that may give a Verdict must be able to open it. Kept as its own
 * predicate rather than an alias because the two answer different questions —
 * "may this account judge a decision" vs "does this account get the debug
 * surface" — and the next role added to either must not silently join the
 * other.
 *
 * The route ORs this with `import.meta.env.DEV`: a dev build mounts the sheet
 * for whoever is signed in, so local work needs no role grant.
 *
 * Cosmetic, as always. Every action inside the sheet is gated server-side on
 * its own mutation (`debugResetGame`, the scenario mutations); hiding the
 * sheet is not what stops a non-tester from calling them.
 */
export function canUseDebugSheet(
    user: AdminGateUser | null | undefined
): boolean {
    return user?.isTester === true || user?.isAdmin === true;
}
