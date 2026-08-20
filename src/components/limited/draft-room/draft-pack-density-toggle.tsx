import {
    draftPackGridLabel,
    nextDraftPackDensity,
    type DraftPackDensity,
} from "./draftPackGrid";
import type { DraftPhoneOrientation } from "./draftSnapStops";

/**
 * The Booster grid's density toggle (issue #2588, ADR 0101 §6). Its LABEL is
 * the grid it currently draws (`3×5`, `8×2`, `4×4`) and its accessible name
 * is the grid it switches to — both derived from `draftPackGrid.ts`, so the
 * control can never name a layout the grid is not in.
 *
 * It replaces the zoom SLIDER on a phone rather than joining it: a continuous
 * scale needs a drag on a surface where every drag is a card move, and a
 * two-rung toggle is one tap.
 */
export default function DraftPackDensityToggle({
    orientation,
    density,
    packSize,
    onToggle,
}: {
    orientation: DraftPhoneOrientation;
    density: DraftPackDensity;
    packSize: number;
    onToggle: () => void;
}) {
    const label = draftPackGridLabel(orientation, density, packSize);
    const next = draftPackGridLabel(
        orientation,
        nextDraftPackDensity(density),
        packSize
    );
    return (
        <button
            type="button"
            data-slot="draft-density-toggle"
            data-density={density}
            aria-label={`Booster grid ${label} — switch to ${next}`}
            onClick={onToggle}
            style={{ minHeight: "var(--control-h)" }}
            className="shrink-0 rounded-sm border border-border-accent/40 px-2 font-mono text-[11px] tracking-wide text-text-muted transition hover:text-parchment"
        >
            {label}
        </button>
    );
}
