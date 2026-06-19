import { useGameContext } from "~/hooks/useGameContext";
import { computePriorityState, type PriorityState } from "~/lib/priority";

// Strong, unmissable priority cue (#152). A board-edge glow plus a labelled
// badge make the three priority states instantly distinguishable — far more
// visible than the life-total ring alone, which is easy to miss. The "none"
// state (game over, pre-priority phase, auto-resolving) renders nothing so the
// board reads as quiet when no one is being asked to act.
const STATE_STYLE: Record<
    Exclude<PriorityState, "none">,
    { glow: string; badge: string; label: string; pulse: boolean }
> = {
    mine: {
        glow: "inset 0 0 0 3px rgba(16,185,129,0.85), inset 0 0 44px rgba(16,185,129,0.30)",
        badge: "bg-emerald-500/90 text-emerald-950",
        label: "Your priority",
        pulse: true,
    },
    opponent: {
        glow: "inset 0 0 0 2px rgba(251,191,36,0.45), inset 0 0 30px rgba(251,191,36,0.14)",
        badge: "bg-amber-500/80 text-amber-950",
        label: "Opponent's priority",
        pulse: false,
    },
};

export default function PriorityIndicator() {
    const ctx = useGameContext();
    const state = computePriorityState(ctx);
    if (state === "none") return null;
    const style = STATE_STYLE[state];

    // The labelled top badge moved into the controller pod's cue badge (#331);
    // only the board-edge glow stays here so the priority cue reads without a
    // floating banner.
    return (
        <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-40"
            style={{ boxShadow: style.glow }}
        />
    );
}
