import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { useMyLimitedEvents } from "~/hooks/useLimitedEvent";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import { Button } from "@/components/ui/button";
import LoadingScreen from "~/components/ui/loading-screen";
import EmptyState from "~/components/ui/empty-state";
import LimitedEventListItem from "./limited-event-list-item";

/** `/limited/events` (issue #2357): every Limited Event the viewer has ever
 *  occupied a Seat in — in progress AND concluded — newest first, each
 *  carrying its phase chip and the viewer's own match record
 *  (`LimitedEventListItem`, which already renders both from the summary
 *  projection). This is the one place a concluded event's outcome stays
 *  visible: `/limited`'s own seated-events section ("Your Current Events",
 *  `useMyCurrentLimitedEvents`) and the dashboard's Limited box both narrow
 *  to events still in progress, and drop an event the instant it concludes.
 *  Backed by `myLimitedEvents` (`useMyLimitedEvents`, unchanged — every
 *  status), the SAME query the Draft Lab's replay picker reads, so narrowing
 *  it here would have silently emptied that picker too. */
export default function LimitedYourEventsPage() {
    const navigate = useNavigate();
    const events = useMyLimitedEvents();

    if (events === undefined) {
        return <LoadingScreen />;
    }

    const handleOpen = (eventId: Id<"limitedEvents">) => {
        void navigate({
            to: "/limited/$eventId",
            params: { eventId },
        });
    };

    const handleBack = () => void navigate({ to: "/limited" });

    return (
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
            <Panel>
                <PanelHeader title="Your Events" />
                <PanelBody>
                    <Button
                        variant="link"
                        size="sm"
                        onClick={handleBack}
                        className="self-start"
                    >
                        ← Back to Limited Events
                    </Button>

                    {events.length === 0 ? (
                        <EmptyState message="You haven't sat at a Limited Event yet." />
                    ) : (
                        <div className="flex flex-col gap-2">
                            {events.map((event) => {
                                const id = event._id as Id<"limitedEvents">;
                                return (
                                    <LimitedEventListItem
                                        key={event._id}
                                        event={event}
                                        viewerHasSeat
                                        onOpen={() => handleOpen(id)}
                                    />
                                );
                            })}
                        </div>
                    )}
                </PanelBody>
            </Panel>
        </div>
    );
}
