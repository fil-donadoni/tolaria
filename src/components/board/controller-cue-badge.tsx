import type { ControllerCue } from "~/hooks/useControllerActions";

const CUE_STYLE: Record<
    ControllerCue,
    { dot: string; label: string; pulse: boolean }
> = {
    mine: { dot: "bg-emerald-400", label: "Your Go", pulse: true },
    opponent: {
        dot: "bg-amber-400/70",
        label: "Opponent to act",
        pulse: false,
    },
    waiting: {
        dot: "bg-amber-400/70",
        label: "Waiting on opponent",
        pulse: false,
    },
    "auto-passing": {
        dot: "bg-text-disabled",
        label: "Auto-passing",
        pulse: false,
    },
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
            {style.label}
        </div>
    );
}
