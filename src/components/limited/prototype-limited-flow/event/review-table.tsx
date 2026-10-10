// PROTOTYPE — throwaway. "Review the table": every seat as a collapsible.
// During Games only your own seat opens unless Open Decklists is on (then a
// warning banner); Finished reveals everyone. The Open Decklists switch here
// SIMULATES the event setting chosen at creation.
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Banner } from "~/components/ui/banner";
import { cn } from "~/lib/utils";
import ReviewSeat from "./review-seat";
import { standingsFor } from "./event-mock";
import type { EventProto } from "./use-event-proto";

export default function ReviewTable({
    p,
    className,
}: {
    p: EventProto;
    className?: string;
}) {
    const [openSeat, setOpenSeat] = useState<number | null>(0);
    const [zoom, setZoom] = useState(120);
    const finished = p.phase === "finished";
    const order = standingsFor(p.phase).map((r) => p.seats[r.seatIndex]);
    const viewer = order.filter((s) => s.isViewer);
    const rest = order.filter((s) => !s.isViewer);
    const lockedCount = finished || p.openDecklists ? 0 : rest.length;
    return (
        <div className={cn("flex flex-col gap-3", className)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-text-muted">
                    {finished
                        ? "The event is over — every deck and pick order is public."
                        : lockedCount > 0
                          ? `Your deck is open to you. ${lockedCount} decks unlock when the event ends.`
                          : "Every deck at this table is visible."}
                </p>
                {!finished && (
                    <button
                        type="button"
                        onClick={() => p.setOpenDecklists(!p.openDecklists)}
                        className="flex items-center gap-1.5 rounded-full border border-fuchsia-600/50 bg-fuchsia-950/30 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-200"
                        title="Prototype control: simulates the event's Open Decklists setting"
                    >
                        {p.openDecklists ? (
                            <Eye className="size-3.5" />
                        ) : (
                            <EyeOff className="size-3.5" />
                        )}
                        Open Decklists: {p.openDecklists ? "on" : "off"}
                    </button>
                )}
            </div>
            {p.openDecklists && !finished && (
                <Banner tone="prominent" title="Open Decklists">
                    This event shows every deck and pick order to everyone while
                    the games are still being played.
                </Banner>
            )}
            {[...viewer, ...rest].map((s) => (
                <ReviewSeat
                    key={s.seatIndex}
                    seat={s}
                    locked={!s.isViewer && lockedCount > 0}
                    open={openSeat === s.seatIndex}
                    onToggle={() =>
                        setOpenSeat(
                            openSeat === s.seatIndex ? null : s.seatIndex
                        )
                    }
                    zoom={zoom}
                    onZoom={setZoom}
                />
            ))}
        </div>
    );
}
