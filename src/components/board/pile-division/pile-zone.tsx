// A drop-zone background box for the pile-division stage: a dashed frame with a
// corner label. Purely presentational — pointer events pass through to the
// stage (the picker owns the drag), and its ref is the drop hit-test target.
import { ZONE_BOXES } from "./layout";
import type { PileKey } from "./layout";

const VARIANT_ZONE: Record<"candidates" | "pileA" | "pileB", PileKey> = {
    candidates: "candidates",
    pileA: "A",
    pileB: "B",
};

export default function PileZone({
    label,
    variant,
    zoneRef,
}: {
    label: string;
    variant: "candidates" | "pileA" | "pileB";
    zoneRef: (el: HTMLDivElement | null) => void;
}) {
    const box = ZONE_BOXES[VARIANT_ZONE[variant]];
    return (
        <div
            ref={zoneRef}
            className="absolute rounded-sm border border-dashed border-border-accent/30 bg-surface-elevated/30 pointer-events-none"
            style={{
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
            }}
        >
            <span className="absolute top-1 left-2 text-display text-[10px] tracking-wide text-text-disabled uppercase">
                {label}
            </span>
        </div>
    );
}
