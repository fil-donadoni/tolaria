import type { Phase } from "@convex/gre/types";
import {
    isPhaseSkipped,
    type PhaseSkipPrefs,
    type Side,
} from "~/lib/skip-phase-prefs";
import { phaseLabel } from "~/lib/phase-labels";
import PhaseStopDot from "./phase-stop-dot";

type ControllerPhaseRowProps = {
    phase: Phase;
    label: string;
    isCurrent: boolean;
    isPast: boolean;
    /** Skippable phases get the YOU/OPP stop toggles; non-skippable (untap,
     *  cleanup) render the label only, with empty dot gutters for alignment. */
    skippable: boolean;
    prefs: PhaseSkipPrefs;
    onToggle: (phase: Phase, side: Side) => void;
};

function stopTooltip(phase: Phase, side: Side, stopOn: boolean) {
    const who = side === "self" ? "your turn" : "your opponent's turn";
    return (
        <div className="max-w-[180px] leading-tight">
            <div className="font-semibold">
                {phaseLabel(phase)} — {who}
            </div>
            <div className="text-background/70 mt-0.5">
                {stopOn
                    ? "Priority will stop here. Click to auto-pass instead."
                    : "Auto-passing. Click to stop here and take priority."}
            </div>
        </div>
    );
}

/** One row of the expanded phase list (#331): a YOU stop dot, the centered
 *  plain-language phase name, and an OPP stop dot. Toggles route through the
 *  SAME `useSkipPhasePreferences` path the old PhaseStepCell used — only the
 *  presentation moved. */
export default function ControllerPhaseRow({
    phase,
    label,
    isCurrent,
    isPast,
    skippable,
    prefs,
    onToggle,
}: ControllerPhaseRowProps) {
    const selfStop = !isPhaseSkipped(prefs, phase, "self");
    const opponentStop = !isPhaseSkipped(prefs, phase, "opponent");

    return (
        <div
            data-current={isCurrent || undefined}
            className={`flex items-center gap-2 px-3 py-1 ${
                isCurrent ? "bg-amber-400/15" : ""
            }`}
        >
            <span className="grid h-6 w-6 place-items-center shrink-0">
                {skippable && (
                    <PhaseStopDot
                        active={selfStop}
                        onClick={() => onToggle(phase, "self")}
                        ariaLabel={`Stop on my turn (${phase})`}
                        tooltip={stopTooltip(phase, "self", selfStop)}
                    />
                )}
            </span>
            <span
                className={`flex-1 text-center text-xs font-beleren ${
                    isCurrent
                        ? "font-bold text-amber-300"
                        : isPast
                          ? "text-white/35"
                          : "text-white/80"
                }`}
                title={phase}
            >
                {label}
            </span>
            <span className="grid h-6 w-6 place-items-center shrink-0">
                {skippable && (
                    <PhaseStopDot
                        active={opponentStop}
                        onClick={() => onToggle(phase, "opponent")}
                        ariaLabel={`Stop on opponent's turn (${phase})`}
                        tooltip={stopTooltip(phase, "opponent", opponentStop)}
                    />
                )}
            </span>
        </div>
    );
}
