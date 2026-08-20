import { useParams } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import LimitedDraftRoom from "~/components/limited/limited-draft-room";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";

/** `/limited/$eventId/draft` — the Draft Room (issue #2587, ADR 0101 §6).
 *  Same wrapper shape as `limited-deck-builder.route.tsx`: it contributes no
 *  DOM box of its own, so the element `<main>` lays out is the room's root
 *  (see `shell-height-claims.guard.test.tsx`'s `ROUTE_ROOTS`). */
export default function LimitedDraftRoomRoute() {
    const { eventId } = useParams({ from: "/limited/$eventId/draft" });
    useDocumentTitle("Draft");
    return <LimitedDraftRoom eventId={eventId as Id<"limitedEvents">} />;
}
