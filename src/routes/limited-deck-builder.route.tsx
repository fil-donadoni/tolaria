import { useParams } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import PoolDeckBuilder from "~/components/deckbuilder/pool-deck-builder";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";

export default function LimitedDeckBuilderRoute() {
    const { eventId } = useParams({ from: "/limited/$eventId/build" });
    useDocumentTitle("Deck Building");
    return <PoolDeckBuilder eventId={eventId as Id<"limitedEvents">} />;
}
