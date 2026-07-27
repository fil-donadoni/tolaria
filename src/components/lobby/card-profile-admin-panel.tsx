import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canEditPresets } from "~/lib/adminGating";
import CardProfilePanel from "./card-profile-panel";

/**
 * Admin-only Card Profile editor entry point (PRD #1607, ADR 0072, issue
 * #1614). Self-gated on `canEditPresets` — the same admin predicate
 * `PickRatingAdminPanel`/`BanlistAdminPanel` use (ADR 0033) — renders
 * nothing for a non-admin or a still-loading user. THIS component calls only
 * `useCurrentUser`, deferring every admin-gated query/mutation hook to
 * `CardProfilePanel`, which mounts ONLY once the gate passes — so the
 * `assertIsAdmin`-gated `listScopeCardProfilesForEditor` query is never even
 * constructed for a signed-in non-admin browsing the Lobby. Hiding it here
 * is cosmetic only: the query and both mutations re-gate via `assertIsAdmin`
 * server-side regardless.
 */
export default function CardProfileAdminPanel() {
    const user = useCurrentUser();
    if (!canEditPresets(user)) return null;
    return <CardProfilePanel />;
}
