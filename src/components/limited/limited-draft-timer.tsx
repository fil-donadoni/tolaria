import { useEffect, useState } from "react";

/** How often the countdown re-renders (issue #1114) — a live per-pick timer
 *  visible in the Draft UI (PRD #1107 story 5/14). `pickDeadline` is an
 *  EPOCH MS timestamp written server-side (`convex/limitedEvents.ts`,
 *  `convex/limited/draftEngine.ts`'s timer stamping) — this component only
 *  ever diffs against `Date.now()` locally; it never counts down a
 *  server-pushed integer (which would drift/freeze between Convex pushes). */
const TICK_MS = 250;

/** Seconds remaining at/under which the countdown reads as urgent. */
const URGENT_THRESHOLD_SECONDS = 10;

/** The running per-pick countdown (issue #1114, PRD #1107 stories 5, 14):
 *  renders nothing when the event has no timer configured or nothing is
 *  currently in front of the seat (`pickDeadline` absent). The actual
 *  Auto-Pick is entirely server-driven (`autoPickSeatTimeout`,
 *  `ctx.scheduler.runAfter`) — this component is read-only decoration, never
 *  a client-side trigger. */
export default function LimitedDraftTimer({
    pickDeadline,
}: {
    pickDeadline: number | null;
}) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (pickDeadline === null) return;
        const id = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(id);
    }, [pickDeadline]);

    if (pickDeadline === null) return null;

    const remainingMs = Math.max(0, pickDeadline - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const urgent = remainingSeconds <= URGENT_THRESHOLD_SECONDS;

    return (
        <span
            className={
                "rounded-sm border px-2 py-0.5 text-xs font-semibold tabular-nums " +
                (urgent
                    ? "border-danger/50 bg-danger/10 text-danger"
                    : "border-border-accent/30 bg-surface-elevated/30 text-text-muted")
            }
            role="timer"
            aria-live="polite"
        >
            {remainingSeconds > 0
                ? `${remainingSeconds}s left`
                : "Auto-picking…"}
        </span>
    );
}
