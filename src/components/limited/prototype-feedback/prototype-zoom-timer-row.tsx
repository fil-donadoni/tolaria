// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-zoom=A`). Never merge.
// Variant A: the zoom control leaves the muted top-right row and sits where
// the player is already looking under time pressure — beside the pick timer —
// as a labelled magnifier with −/+ buttons and a percent readout.
import { ZoomIn } from "lucide-react";
import type { PrototypeZoom } from "./usePrototypeZoom";

const STEP = 0.15;
const BUTTON =
    "flex h-8 w-8 items-center justify-center rounded-sm border border-border-accent/50 text-lg leading-none font-semibold text-text transition-colors hover:bg-accent-strong/20 disabled:opacity-40";

export default function PrototypeZoomTimerRow({
    timer,
    zoom,
}: {
    timer: React.ReactNode;
    zoom: PrototypeZoom;
}) {
    return (
        <div
            data-prototype="zoom-timer-row"
            className="flex shrink-0 items-center gap-3"
        >
            <div className="min-w-0 flex-1">{timer}</div>
            <div
                role="group"
                aria-label="Card size"
                className="flex shrink-0 items-center gap-1.5 rounded-sm border border-border-accent/40 bg-surface-elevated/70 px-2 py-1 text-sm text-text"
            >
                <ZoomIn
                    className="h-4 w-4 text-accent-strong"
                    aria-hidden="true"
                />
                <span className="text-xs tracking-wide text-text-muted uppercase">
                    Card size
                </span>
                <button
                    type="button"
                    aria-label="Smaller cards"
                    className={BUTTON}
                    disabled={zoom.value <= zoom.min}
                    onClick={() => zoom.set(zoom.value - STEP)}
                >
                    −
                </button>
                <span className="w-12 text-center font-semibold tabular-nums">
                    {Math.round(zoom.value * 100)}%
                </span>
                <button
                    type="button"
                    aria-label="Bigger cards"
                    className={BUTTON}
                    disabled={zoom.value >= zoom.max}
                    onClick={() => zoom.set(zoom.value + STEP)}
                >
                    +
                </button>
            </div>
        </div>
    );
}
