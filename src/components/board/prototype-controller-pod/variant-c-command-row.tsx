// PROTOTYPE — throwaway. Variant C "Command row": the portrait command row
// brought to desktop. ONE line: a morphing primary pill (CTA → status → cue
// text) plus two always-mounted icon buttons, Pass Turn ⏩ and Until Action ✋
// (enabled without priority = queued intent, as the server allows). Above it a
// fixed-height shelf: the cue when idle, small chips for leftover actions
// (Attack with all, Pass Turn queued). The pod is shorter AND constant; it
// widens to w-64 so "Confirm Attackers (12)" fits.
import { FastForward, Hand } from "lucide-react";
import type {
    ControllerAction,
    ControllerCue,
} from "~/hooks/useControllerActions";
import { selectCommandSlots } from "~/lib/controller-action-slots";
import {
    CONTROLLER_PRIMARY_TONE,
    CONTROLLER_SECONDARY_TONE,
} from "~/lib/controller-action-tone";
import ControllerCueBadge from "../controller-cue-badge";

const STATUS_TEXT: Record<ControllerCue, string> = {
    mine: "Your go",
    opponent: "Opponent to act",
    waiting: "Waiting on opponent",
    "auto-passing": "Auto-passing",
};
const ICON =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-base/85 text-text-muted shadow-lg transition-colors hover:text-text disabled:opacity-30";

export default function VariantCCommandRow({
    cue,
    actions,
}: {
    cue: ControllerCue;
    actions: ControllerAction[];
}) {
    const slots = selectCommandSlots(actions);
    const intentRunning = cue === "auto-passing";
    const passTurnDisabled = slots.passTurn
        ? slots.passTurn.disabled
        : intentRunning || cue === "mine";
    const untilDisabled = slots.passUntilAction
        ? slots.passUntilAction.disabled
        : intentRunning || cue === "mine";

    return (
        <div className="flex flex-col gap-2">
            <div className="flex h-7 items-center gap-1.5 overflow-hidden">
                {slots.secondary.length > 0 ? (
                    slots.secondary.map((a) => (
                        <button
                            key={a.key}
                            type="button"
                            onClick={a.onClick}
                            disabled={a.disabled}
                            className={`h-7 min-w-0 flex-1 truncate rounded-full border px-2 text-[10px] font-semibold ${CONTROLLER_SECONDARY_TONE[a.tone]}`}
                        >
                            {a.label}
                        </button>
                    ))
                ) : (
                    <ControllerCueBadge cue={cue} />
                )}
            </div>
            <div className="flex items-center gap-2">
                {slots.primary ? (
                    <button
                        type="button"
                        onClick={slots.primary.onClick}
                        disabled={slots.primary.disabled}
                        className={`h-11 min-w-0 flex-1 truncate rounded-full px-3 text-display text-xs shadow-[0_4px_18px_rgba(0,0,0,0.45)] disabled:opacity-40 ${CONTROLLER_PRIMARY_TONE[slots.primary.tone]}`}
                    >
                        {slots.primary.label}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={slots.statusPill?.onClick}
                        disabled={
                            !slots.statusPill || slots.statusPill.disabled
                        }
                        className="h-11 min-w-0 flex-1 truncate rounded-full border border-border-strong bg-surface-base/85 px-3 text-display text-xs text-text-muted shadow-lg disabled:opacity-80"
                    >
                        {slots.statusPill?.label ?? STATUS_TEXT[cue]}
                    </button>
                )}
                <button
                    type="button"
                    aria-label="Pass Turn"
                    title={
                        slots.passTurn ? "Pass Turn [P]" : "Queue Pass Turn [P]"
                    }
                    disabled={passTurnDisabled}
                    className={ICON}
                >
                    <FastForward className="h-4 w-4" aria-hidden />
                </button>
                <button
                    type="button"
                    aria-label="Pass Until Action"
                    title={
                        slots.passUntilAction
                            ? "Pass Until Action [Enter]"
                            : "Queue Pass Until Action [Enter]"
                    }
                    disabled={untilDisabled}
                    className={ICON}
                >
                    <Hand className="h-4 w-4" aria-hidden />
                </button>
            </div>
        </div>
    );
}
