import DraftStripDropZone from "./draft-strip-drop-zone";
import DraftSwipeChevron from "./draft-swipe-chevron";
import type { DraftSnapStop } from "./draftSnapStops";

/**
 * The PORTRAIT pool strip (issue #2588, ADR 0101 §6) — the pool pane's first
 * 15%, which is what shows through while the player is on the pack.
 *
 * Three jobs in one band, which is the whole idea: it is the pool's LIVE TAB
 * (its counts move as picks land), the way to REACH the pool (a tap), and a
 * DROP TARGET split in two — the Pool half picks the card, the Sideboard half
 * picks it straight to the Sideboard. The split is why the Sideboard needs no
 * separate affordance on a 390px screen.
 */
export default function DraftPoolStrip({
    stop,
    mainCount,
    sideCount,
    onOpenPool,
    style,
}: {
    stop: DraftSnapStop;
    mainCount: number;
    sideCount: number;
    onOpenPool: () => void;
    /** Height, as the strip's share of its own pane (`draftStripFraction`). */
    style?: React.CSSProperties;
}) {
    return (
        <div
            data-slot="draft-pool-strip"
            style={style}
            className="flex shrink-0 border-b border-border-accent/40 bg-surface"
        >
            <DraftStripDropZone
                zone="maindeck"
                label={`Your pool, ${mainCount} cards — open it, or drop a card here to pick it`}
                onSelect={onOpenPool}
                className="flex-1 justify-center"
            >
                <span className="flex items-center gap-1 text-[11px] tracking-widest text-text-muted uppercase">
                    {stop === "pack" && <DraftSwipeChevron direction="up" />}
                    <span data-slot="draft-pool-count">Pool · {mainCount}</span>
                </span>
                <span className="text-display text-[12px] text-accent-strong">
                    {stop === "pack" ? "tap: open pool" : "your picks"}
                </span>
            </DraftStripDropZone>
            <DraftStripDropZone
                zone="sideboard"
                label={`Sideboard, ${sideCount} cards — drop a card here to pick it straight to the sideboard`}
                onSelect={onOpenPool}
                className="w-[30%] justify-center border-l border-border-subtle/40"
            >
                <span
                    data-slot="draft-sideboard-count"
                    className="text-[11px] tracking-widest text-text-muted uppercase"
                >
                    SB · {sideCount}
                </span>
            </DraftStripDropZone>
        </div>
    );
}
