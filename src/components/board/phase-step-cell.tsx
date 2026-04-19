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
                label={`Stop on my turn (${phase})`}
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
                label={`Stop on opponent's turn (${phase})`}
            />
        </div>
    );
}
