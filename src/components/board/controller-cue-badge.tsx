import type { ControllerCue } from "~/hooks/useControllerActions";
import { CONTROLLER_CUE_COPY } from "~/lib/controller-cue-copy";

const CUE_STYLE: Record<ControllerCue, { dot: string; pulse: boolean }> = {
    mine: { dot: "bg-signal-self", pulse: true },
    opponent: { dot: "bg-signal-pending/70", pulse: false },
    waiting: { dot: "bg-signal-pending/70", pulse: false },
    "auto-passing": { dot: "bg-text-disabled", pulse: false },
};

/** The pod's at-a-glance priority cue (#331): a coloured dot + plain-language
 *  label for one of the four mutually exclusive controller states. */
export default function ControllerCueBadge({ cue }: { cue: ControllerCue }) {
    const style = CUE_STYLE[cue];
    return (
        <div
            role="status"
            aria-live="polite"
            data-cue={cue}
            className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted ${
                style.pulse ? "animate-pulse" : ""
            }`}
        >
            <span
                className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                aria-hidden
            />
            {CONTROLLER_CUE_COPY[cue].label}
        </div>
    );
}
