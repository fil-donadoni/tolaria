import { useEffect, useState } from "react";
import { passDirection } from "@convex/limited/draftEngine";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { useDraftStartNowHotkey } from "~/hooks/useDraftStartNowHotkey";
import { introSecondsLeft } from "~/lib/limited/draftIntro";
import { Button } from "@/components/ui/button";
import LimitedTableRingView from "./limited-table-ring-view";

/** The Draft's table intro (issue #9167): the seat ring, the pass direction
 *  and the countdown to the first pick. The clock is the server's
 *  `draftStartsAt` — nothing is dealt and no Bot picks until it passes — so
 *  this only reads it. Only the creator may "Start now" (button or Space). */
export default function LimitedDraftIntro({
    event,
    startsAt,
    canStartNow,
    onStartNow,
}: {
    event: LimitedEventView;
    startsAt: number;
    canStartNow: boolean;
    onStartNow: () => void;
}) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, []);
    useDraftStartNowHotkey(canStartNow, onStartNow);

    const seconds = introSecondsLeft(startsAt, now);
    const direction = passDirection(0) === 1 ? "left" : "right";

    return (
        <div
            data-slot="draft-intro"
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4"
        >
            <span className="rounded-full border border-border px-3 py-1 text-xs tracking-[0.14em] text-text-muted uppercase">
                Pack 1 passes {direction}
            </span>
            <div className="relative w-full max-w-xl">
                <LimitedTableRingView event={event} round={0} />
                <div
                    data-slot="draft-intro-countdown"
                    role="timer"
                    aria-label="Draft starts in"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2"
                >
                    <span className="text-5xl font-semibold tabular-nums">
                        {seconds > 0 ? seconds : "…"}
                    </span>
                    {canStartNow && (
                        <Button size="sm" onClick={onStartNow}>
                            Start now
                            <kbd className="ml-2 text-xs opacity-70">Space</kbd>
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
