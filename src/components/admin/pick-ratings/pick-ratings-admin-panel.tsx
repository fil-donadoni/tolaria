import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canEditPresets } from "~/lib/adminGating";
import SurfaceReadyMarker from "~/components/ui/surface-ready-marker";
import PickRatingsPage from "./pick-ratings-page";

/**
 * Admin-only Bot Pick Rating tool entry point (PRD #1296, issue #1300; PRD
 * #8772, issue #8908). Self-gated on `canEditPresets` (ADR 0033) — renders
 * nothing for a non-admin or a still-loading user. THIS component calls only
 * `useCurrentUser`, deferring every admin-gated query to `PickRatingsPage`,
 * which mounts ONLY once the gate passes, so `listScopeCardRatings`
 * (`assertIsAdmin`) is never constructed for a non-admin. Hiding it here is
 * cosmetic: the query re-gates server-side regardless.
 *
 * The ready marker (issue #3644) goes up with the panel; the page's own
 * queries are what `check:ui`'s settle wait sees in flight.
 */
export default function PickRatingsAdminPanel() {
    const user = useCurrentUser();
    if (!canEditPresets(user)) return null;
    return (
        <>
            <SurfaceReadyMarker />
            <PickRatingsPage />
        </>
    );
}
