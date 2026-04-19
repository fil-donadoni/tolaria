import type { Phase } from "@convex/gre/types";
import {
    isPhaseSkipped,
    type PhaseSkipPrefs,
    type Side,
} from "~/lib/skip-phase-prefs";
import PhaseStopDot from "./phase-stop-dot";

type PhaseStepCellProps = {
    phase: Phase;
    short: string;
    isCurrent: boolean;
    prefs: PhaseSkipPrefs;
    onToggle: (phase: Phase, side: Side) => void;
};

function prettyPhaseName(phase: Phase): string {
    return phase
        .split("_")
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(" ");
}

function stopTooltip(
    phase: Phase,
    side: Side,
    stopOn: boolean
): React.ReactNode {
    const who = side === "self" ? "your turn" : "your opponent's turn";
    const phaseName = prettyPhaseName(phase);
    return (
        <div className="max-w-[200px] leading-snug">
            <div className="font-semibold">
                {phaseName} — {who}
            </div>
            <div className="text-white/70 mt-0.5">
                {stopOn
                    ? "Priority will stop here. Click to auto-pass instead."
                    : "Auto-passing. Click to stop here and take priority."}
            </div>
        </div>
    );
}

export default function PhaseStepCell({
    phase,
    short,
    isCurrent,
    prefs,
    onToggle,
}: PhaseStepCellProps) {
    const selfStop = !isPhaseSkipped(prefs, phase, "self");
    const opponentStop = !isPhaseSkipped(prefs, phase, "opponent");

    return (
        <div className="flex items-center gap-1">
            <PhaseStopDot
                active={selfStop}
                onClick={() => onToggle(phase, "self")}
                ariaLabel={`Stop on my turn (${phase})`}
                tooltip={stopTooltip(phase, "self", selfStop)}
            />
            <div
                className={`text-[9px] leading-tight px-1 py-px rounded text-center transition-colors flex-1 ${
                    isCurrent
                        ? "bg-amber-400 text-black font-bold"
                        : "text-white/40"
                }`}
                title={phase}
            >
                {short}
            </div>
            <PhaseStopDot
                active={opponentStop}
                onClick={() => onToggle(phase, "opponent")}
                ariaLabel={`Stop on opponent's turn (${phase})`}
                tooltip={stopTooltip(phase, "opponent", opponentStop)}
            />
        </div>
    );
}
