import { useEffect, useState } from "react";
import { liveRemainingMs } from "@convex/matchClock";
import { useGameContext } from "~/hooks/useGameContext";
import { formatClock, MATCH_CLOCK_URGENT_MS } from "~/lib/matchClockFormat";

/** How often a RUNNING clock re-renders: the display has one-second
 *  resolution, so a faster tick would only repaint the same digits. */
const TICK_MS = 1000;

type PlayerMatchClockProps = {
    playerId: string;
    /** Portrait compact nameplate — inline in the life row, no own `mt-0.5`. */
    compact?: boolean;
};

/** A player's Match Clock beside the life total in `PlayerNameplate` (issue
 *  #2308): the time left in their per-Match budget, highlighted while it runs
 *  (the game is waiting on them). Renders nothing for an unclocked Match.
 *
 *  Decorative only: the clock's authority is the `gameTicks` row and the
 *  server's expiry job (`expireMatchClock`) — this diffs the stored
 *  `runningSince` against the local clock, never counts down a pushed
 *  integer (which would freeze between pushes), and triggers nothing. */
export default function PlayerMatchClock({
    playerId,
    compact = false,
}: PlayerMatchClockProps) {
    const { matchClock } = useGameContext();
    const running = matchClock?.runningPlayerId === playerId;
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!running) return;
        const id = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(id);
    }, [running]);

    if (!matchClock?.players.some((p) => p.playerId === playerId)) return null;

    const remainingMs = liveRemainingMs(matchClock, playerId, now);
    const urgent = remainingMs <= MATCH_CLOCK_URGENT_MS;
    const label = `Match clock: ${formatClock(remainingMs)} left${
        running ? ", running" : ""
    }`;

    return (
        <div
            className={`${compact ? "" : "mt-0.5"} inline-flex items-center rounded-sm border px-1 text-[11px] font-semibold leading-none tabular-nums ${
                urgent
                    ? "border-danger/50 bg-danger/10 text-danger-strong"
                    : running
                      ? "border-accent/60 bg-accent/15 text-accent-strong"
                      : "border-transparent text-text-muted"
            }`}
            role="timer"
            aria-label={label}
            title={label}
            data-running={running || undefined}
            data-testid={`match-clock-${playerId}`}
        >
            {formatClock(remainingMs)}
        </div>
    );
}
