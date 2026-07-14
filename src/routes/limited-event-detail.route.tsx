import { useParams } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import LimitedEventDetail from "~/components/limited/limited-event-detail";

export default function LimitedEventDetailRoute() {
    const { eventId } = useParams({ from: "/limited/$eventId" });
    return <LimitedEventDetail eventId={eventId as Id<"limitedEvents">} />;
}
