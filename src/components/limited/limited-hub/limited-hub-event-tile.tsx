import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "@tanstack/react-router";
import type {
    LimitedEventSummaryView,
    PackSourceInfo,
} from "~/hooks/useLimitedEvent";
import { limitedEventName } from "~/lib/limitedEventName";
import { limitedEventStatusChip } from "~/lib/limitedEventStatus";
import {
    LIMITED_HUB_CHIP_LABEL,
    limitedHubCta,
    packSourceForEvent,
} from "~/lib/limited/limitedHub";
import { Button } from "@/components/ui/button";
import { cn } from "~/lib/utils";
import LimitedHubArt from "./limited-hub-art";

/** One of the viewer's in-progress events: Feature Card art, name, phase and
 *  exactly ONE primary action for that phase (PRD #5383). The CTA is disabled
 *  while the viewer has nothing to do ("Waiting — n/m seats"). `View` is the
 *  quiet way into the event page whatever the phase. */
export default function LimitedHubEventTile({
    event,
    sources,
    className,
}: {
    event: LimitedEventSummaryView;
    sources: readonly PackSourceInfo[];
    className?: string;
}) {
    const navigate = useNavigate();
    const eventId = event._id as Id<"limitedEvents">;
    const cta = limitedHubCta(event);
    const phase = limitedEventStatusChip(event);

    const act = () => {
        if (cta.kind === "draft") {
            void navigate({
                to: "/limited/$eventId/draft",
                params: { eventId },
            });
        } else if (cta.kind === "build") {
            void navigate({
                to: "/limited/$eventId/build",
                params: { eventId },
            });
        } else {
            void navigate({ to: "/limited/$eventId", params: { eventId } });
        }
    };

    return (
        <article
            data-limited-event-label={event.label}
            data-hub-tile="event"
            data-hub-phase={phase}
            className={cn(
                "relative isolate flex flex-col justify-between overflow-hidden rounded-[var(--panel-radius)] border border-accent/50 bg-surface p-4",
                className
            )}
        >
            <LimitedHubArt source={packSourceForEvent(event, sources)} />
            <div className="flex items-start justify-between gap-2">
                <span className="rounded-sm border border-accent/40 bg-surface/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                    {LIMITED_HUB_CHIP_LABEL[phase]}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-parchment/80">
                    {event.gamesFormat === "bo1" ? "Bo1" : "Bo3"}
                </span>
            </div>
            <div className="flex flex-col gap-2">
                <h3 className="font-display text-xl leading-tight text-parchment drop-shadow">
                    {limitedEventName(event)}
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant="primary"
                        data-hub-cta={cta.kind}
                        disabled={cta.kind === "waiting"}
                        onClick={act}
                    >
                        {cta.label}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                            void navigate({
                                to: "/limited/$eventId",
                                params: { eventId },
                            })
                        }
                    >
                        View
                    </Button>
                </div>
            </div>
        </article>
    );
}
