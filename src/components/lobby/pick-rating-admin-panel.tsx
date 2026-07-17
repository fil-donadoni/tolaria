import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canEditPresets } from "~/lib/adminGating";
import PickRatingPanel from "./pick-rating-panel";

/**
 * Admin-only Bot Pick Rating editor entry point (PRD #1296 Slice C, issue
 * #1300). Self-gated on `canEditPresets` — the same admin predicate
 * `BanlistAdminPanel` and the Lobby's Preset Deck controls use (ADR 0033) —
 * renders nothing for a non-admin or a still-loading user. Mirrors
 * `BanlistAdminPanel`'s exact shape: THIS component calls only
 * `useCurrentUser`, deferring every admin-gated query/mutation hook
 * (`useDraftableSets`, `useScopeCardRatings`, `useCardRatingMutations`) to
 * `PickRatingPanel`, which mounts ONLY once the gate passes — so the
 * `assertIsAdmin`-gated `listScopeCardRatings` query is never even
 * constructed for a signed-in non-admin browsing the Lobby (the same reason
 * `BanlistFormatSyncRow` lives in its own file, mounted only inside
 * `BanlistAdminPanel`'s gate). Hiding it here is cosmetic only: the
 * underlying query/mutations all re-gate via `assertIsAdmin` server-side
 * regardless.
 */
export default function PickRatingAdminPanel() {
    const user = useCurrentUser();
    if (!canEditPresets(user)) return null;
    return <PickRatingPanel />;
}
