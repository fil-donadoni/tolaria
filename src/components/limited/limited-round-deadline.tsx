import { useEffect, useState } from "react";

/** How often the countdown re-renders. A round deadline runs minutes to
 *  days (`MIN_ROUND_DEADLINE_MINUTES`/`MAX_ROUND_DEADLINE_MINUTES`,
 *  `convex/limited/matchFormat.ts`), so — unlike the per-pick
 *  `LimitedDraftTimer`'s 250ms tick, tuned for a countdown measured in
 *  single-digit seconds — one second of jitter is invisible here. */
const TICK_MS = 1000;

/** Below this remaining time the countdown reads as urgent (PRD #1628 story
 *  35: "I want to see the round deadline counting down"). */
const URGENT_THRESHOLD_MS = 5 * 60_000;

function formatRemaining(ms: number): string {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m left`;
    if (minutes > 0) return `${minutes}m ${seconds}s left`;
    return `${seconds}s left`;
}

/** The round deadline countdown (PRD #1628 story 35, issue #1647): renders
 *  nothing when the current round has no configured deadline
 *  (`deadlineAt` absent — an event created without one never shows a timer,
 *  story 4). `deadlineAt` is an EPOCH MS timestamp written server-side
 *  (`convex/limited/rounds.ts`'s `openRound`) — this component only ever
 *  diffs against `Date.now()` locally, exactly like `LimitedDraftTimer`; it
 *  never counts down a server-pushed integer, which would drift/freeze
 *  between Convex pushes.
 *
 *  Purely decorative: the actual close-out is entirely server-driven
 *  (`expireRoundDeadline`, `ctx.scheduler.runAfter`) — this component never
 *  triggers anything, it only reflects the deadline the server is already
 *  counting down against. */
export default function LimitedRoundDeadline({
    deadlineAt,
}: {
    deadlineAt: number | null;
}) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (deadlineAt === null) return;
        const id = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(id);
    }, [deadlineAt]);

    if (deadlineAt === null) return null;

    const remainingMs = Math.max(0, deadlineAt - now);
    const urgent = remainingMs <= URGENT_THRESHOLD_MS;

    return (
        <span
            className={
                "rounded-sm border px-2 py-0.5 text-xs font-semibold tabular-nums " +
                (urgent
                    ? "border-danger/50 bg-danger/10 text-danger-strong"
                    : "border-border-accent/30 bg-surface-elevated/30 text-text-muted")
            }
            role="timer"
            aria-live="polite"
            data-testid="round-deadline"
        >
            {remainingMs > 0 ? formatRemaining(remainingMs) : "Round closing…"}
        </span>
    );
}
