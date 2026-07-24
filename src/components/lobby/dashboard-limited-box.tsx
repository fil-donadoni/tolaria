import type { Id } from "@convex/_generated/dataModel";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { limitedEventStatusHint } from "~/lib/limitedEventStatus";
import { cn } from "~/lib/utils";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import ActionButton from "~/components/board/action-button";

/** First-class Limited box on the lobby dashboard (issue #1582), given equal
 *  visual weight to `DashboardPlayBox` via the SAME shared Panel component
 *  language — no bespoke frame. Offers the primary Limited actions at a
 *  glance: browse/create events (→ the events page — creation itself stays
 *  out of scope for the dashboard, issue #1582), and quick re-entry into
 *  every event where the viewer occupies a Seat, each with a status hint
 *  (open/drafting/deckbuilding/ready to play — `limitedEventStatusHint`) and
 *  a link to its event detail. The re-entry list reuses
 *  `myLimitedEvents`/`useMyLimitedEvents` (issue #1578/#1589) rather than a
 *  new query. */
export default function DashboardLimitedBox({
    events,
    onBrowse,
    onOpen,
}: {
    events: LimitedEventView[];
    onBrowse: () => void;
    onOpen: (eventId: Id<"limitedEvents">) => void;
}) {
    return (
        <Panel tone="accent" className="flex flex-col">
            <PanelHeader title="Limited" />
            <PanelBody>
                <p className="text-sm text-text-muted">
                    Draft or Sealed, against other players or the Bot Drafter —
                    build a Pool, then a deck.
                </p>

                <ActionButton
                    onClick={onBrowse}
                    label="Browse / Create Events"
                    tone="primary"
                />

                {events.length > 0 ? (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                            Your Events
                        </p>
                        <div className="flex flex-col gap-2">
                            {events.map((event) => {
                                const id = event._id as Id<"limitedEvents">;
                                const status = limitedEventStatusHint(event);
                                return (
                                    <button
                                        key={event._id}
                                        onClick={() => onOpen(id)}
                                        className={cn(
                                            "flex items-center justify-between rounded-sm border px-4 py-2 text-sm transition",
                                            "border-border-subtle bg-surface-elevated text-text hover:border-border-accent/60"
                                        )}
                                    >
                                        <span className="flex items-center gap-2 font-medium capitalize">
                                            {event.type} —{" "}
                                            {event.packSlots
                                                .join(", ")
                                                .toUpperCase()}
                                        </span>
                                        <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                                            {status}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-text-muted">
                        No events yet — browse open events or create one to get
                        started.
                    </p>
                )}
            </PanelBody>
        </Panel>
    );
}
