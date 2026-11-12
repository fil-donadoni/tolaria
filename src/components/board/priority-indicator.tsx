import { useEffect, useState } from "react";
import { useGameContext } from "~/hooks/useGameContext";
import { computeActingSeat } from "~/lib/priority";

// The board-edge priority cue (#152, #9160, #9295). The frame is cut at the
// board midline and ONLY the viewer's half lights up, once the game has been
// waiting on the viewer for `PRIORITY_CUE_DELAY_MS` — the priority holder, or
// the chooser while a pending choice stands. It is keyed on who acts, never on
// whose turn it is: a response window on the opponent's turn lights MY half.
// Waiting on the opponent renders nothing (nameplate ring and Bot indicators
// carry that). The turn itself is announced once by `TurnChangeSweep`.
// "none" (game over, auto-resolving) renders nothing.
export const PRIORITY_CUE_DELAY_MS = 5000;

export default function PriorityIndicator() {
    const ctx = useGameContext();
    const seat = computeActingSeat(ctx);
    const viewerActs = seat === "mine";
    // Solo: a viewing-seat switch counts as becoming `mine` again, so the
    // countdown restarts (`playerId` is a dependency).
    const viewerId = (ctx as { playerId?: string }).playerId;
    // The viewer the 5 s elapsed for: a stale lit state never paints for a new one.
    const [elapsed, setElapsed] = useState<{ id?: string } | null>(null);

    useEffect(() => {
        if (!viewerActs) return;
        const timer = setTimeout(
            () => setElapsed({ id: viewerId }),
            PRIORITY_CUE_DELAY_MS
        );
        return () => {
            clearTimeout(timer);
            setElapsed(null);
        };
    }, [viewerActs, viewerId]);

    if (!viewerActs || elapsed?.id !== viewerId || !elapsed) return null;

    return (
        <div
            aria-hidden
            data-testid="priority-indicator"
            data-acting-seat={seat}
            className="pointer-events-none absolute inset-0 z-hud"
        >
            <div
                data-testid="priority-half-mine"
                data-lit="true"
                className="priority-half priority-half-mine"
            />
        </div>
    );
}
