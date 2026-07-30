import { useParams } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import LimitedEventDetail from "~/components/limited/limited-event-detail";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";
import { useLimitedEvent } from "~/hooks/useLimitedEvent";
import { limitedEventName } from "~/lib/limitedEventName";

export default function LimitedEventDetailRoute() {
    const { eventId } = useParams({ from: "/limited/$eventId" });
    // Same query args as the page below, so Convex shares the ONE
    // subscription — reading the event here costs no extra server work and
    // keeps the title next to the route it names.
    const event = useLimitedEvent(eventId as Id<"limitedEvents">);
    useDocumentTitle(event ? limitedEventName(event) : "Limited Event");
    return <LimitedEventDetail eventId={eventId as Id<"limitedEvents">} />;
}
