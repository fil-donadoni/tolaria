import { cn } from "~/lib/utils";
import DraftCollapsedPackColumn from "./draft-collapsed-pack-column";
import DraftPackState from "./draft-pack-state";
import DraftSneakPeekColumn from "./draft-sneak-peek-column";
import { DRAFT_PANE_FRACTION } from "./draftSnapStops";
import type { DraftPhonePanesProps } from "./draftPhonePanes";

const PANE_STYLE = {
    width: `${DRAFT_PANE_FRACTION.landscape * 100}%`,
};

/**
 * PHONE LANDSCAPE (issue #2588, PRD #2405 slice 9, ADR 0101 §6): pack grid
 * 80% | 20% sneak-peek column; on swipe the pack collapses to a vertical pile
 * (20%) and the pool expands to MV columns + a Sideboard column (80%).
 *
 * Same two-stop scroller as portrait, laid out on the horizontal axis — width
 * is the abundant axis on a sideways phone, and 390px of height cannot afford
 * a stacked pair. The two 20% bands (sneak peek, collapsed pack) are the same
 * live tab / drop target the portrait strip is; the id vocabulary is
 * identical, and only one orientation is ever mounted, so the two never
 * collide in dnd-kit's droppable registry.
 *
 * "MV columns + a Sideboard column" is `LimitedDraftPool` unchanged: the
 * shared `DeckZoneSurface` already draws its Columns as vertical piles in
 * landscape (rows in portrait, issue #2584) and already puts the Sideboard
 * beside them. Reimplementing that pile here would have produced a
 * read-only twin of a surface that drags, pins and persists.
 */
export default function DraftLandscapePanes({
    scrollerRef,
    snap,
    packGrid,
    timer,
    pool,
    densityToggle,
    packPile,
    pickPile,
    mainCount,
    sideCount,
    pickNumber,
    packLeft,
    selected,
    actions,
    pulsing,
}: DraftPhonePanesProps) {
    const onPool = snap.stop === "pool";
    const status = (
        <DraftPackState pickNumber={pickNumber} packLeft={packLeft} />
    );
    return (
        <div
            ref={scrollerRef}
            onScroll={snap.onScroll}
            data-slot="draft-snap-scroller"
            data-orientation="landscape"
            data-stop={snap.stop}
            className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-contain [scrollbar-width:none]"
        >
            <section
                data-slot="draft-pane"
                data-pane="pack"
                style={PANE_STYLE}
                className="flex h-full shrink-0 snap-start flex-row"
            >
                {/* Hidden rather than unmounted at the pool stop: the Booster
                    is 15 remote images, and remounting them on every swipe
                    would repaint the grid from empty each time. `visibility`
                    also keeps the occlusion probe honest — a hidden subtree is
                    skipped by `elementFromPoint`, so nothing under it reads as
                    covered. */}
                <div
                    className={cn(
                        "flex min-h-0 min-w-0 flex-col",
                        onPool ? "w-[75%]" : "flex-1"
                    )}
                    style={onPool ? { visibility: "hidden" } : undefined}
                >
                    <div className="flex shrink-0 items-center gap-2 px-2 py-1">
                        {/* The Pick Timer is mounted ONCE, in whichever band
                            is on screen: here at the pack stop, in the
                            collapsed column at the pool stop. Two mounts
                            would mean two `role="timer"` live regions
                            announcing the same countdown. */}
                        <div className="min-w-0 flex-1">{!onPool && timer}</div>
                        {densityToggle}
                    </div>
                    {/* The grid scrolls itself — see the portrait pane. */}
                    {packGrid}
                </div>
                {onPool && (
                    <DraftCollapsedPackColumn
                        packPile={packPile}
                        timer={timer}
                        status={status}
                        selected={selected}
                        actions={actions}
                        pulsing={pulsing}
                        onOpenPack={() => snap.snapTo("pack")}
                    />
                )}
            </section>

            <section
                data-slot="draft-pane"
                data-pane="pool"
                style={PANE_STYLE}
                className="flex h-full shrink-0 snap-end flex-row"
            >
                {onPool ? (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                        {pool}
                    </div>
                ) : (
                    <DraftSneakPeekColumn
                        picks={pickPile}
                        mainCount={mainCount}
                        sideCount={sideCount}
                        selected={selected}
                        actions={actions}
                        status={status}
                        onOpenPool={() => snap.snapTo("pool")}
                    />
                )}
            </section>
        </div>
    );
}
