import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import ActionButton from "~/components/board/action-button";
import LimitedPoolView from "./limited-pool-view";

/** The viewer's finished Pool + a "Build Deck" jump-off — shared between a
 *  Sealed event (Pool ready the instant it starts) and a completed Draft
 *  (Pool ready once `draftCompletedAt` is set, issue #1112). Extracted so
 *  neither caller duplicates the header/button chrome. */
export default function LimitedSeatPoolPanel({
    eventId,
    pool,
}: {
    eventId: Id<"limitedEvents">;
    pool: LimitedPoolCard[];
}) {
    const navigate = useNavigate();

    return (
        <div className="mt-4 border-t border-border-accent/20 pt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                    Your Pool
                </h3>
                <ActionButton
                    onClick={() =>
                        void navigate({
                            to: "/limited/$eventId/build",
                            params: { eventId },
                        })
                    }
                    label="Build Deck"
                    tone="primary"
                />
            </div>
            <LimitedPoolView pool={pool} />
        </div>
    );
}
