import { useGameContext } from "~/hooks/useGameContext";
import { computeActingSeat } from "~/lib/priority";

// The board-edge priority cue (#152, #9160). The frame is cut at the board
// midline and ONLY the half of the seat that must act lights up — the priority
// holder, or the chooser while a pending choice stands. It is keyed on who
// acts, never on whose turn it is: a response window on the opponent's turn
// lights MY half. The turn itself is announced once by `TurnChangeSweep`, not
// painted permanently. "none" (game over, auto-resolving) renders nothing.
const SEAT_STYLE = {
    mine: { half: "priority-half-mine", testId: "priority-half-mine" },
    opponent: {
        half: "priority-half-opponent",
        testId: "priority-half-opponent",
    },
} as const;

export default function PriorityIndicator() {
    const ctx = useGameContext();
    const seat = computeActingSeat(ctx);
    if (seat === "none") return null;
    const { half, testId } = SEAT_STYLE[seat];

    return (
        <div
            aria-hidden
            data-testid="priority-indicator"
            data-acting-seat={seat}
            className="pointer-events-none absolute inset-0 z-hud"
        >
            <div
                data-testid={testId}
                data-lit="true"
                className={`priority-half ${half}`}
            />
        </div>
    );
}
