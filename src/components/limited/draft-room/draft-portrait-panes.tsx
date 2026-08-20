import DraftPackStatusBar from "./draft-pack-status-bar";
import DraftPoolStrip from "./draft-pool-strip";
import { DRAFT_PANE_FRACTION, draftStripFraction } from "./draftSnapStops";
import type { DraftPhonePanesProps } from "./draftPhonePanes";

const PANE_STYLE = {
    height: `${DRAFT_PANE_FRACTION.portrait * 100}%`,
};
const STRIP_STYLE = {
    height: `${draftStripFraction("portrait") * 100}%`,
};

/**
 * PHONE PORTRAIT (issue #2588, PRD #2405 slice 9, ADR 0101 §6): two snap
 * stops, Pack 85 / Pool 15 ↔ 15 / 85.
 *
 * One scroller, two panes of 85%, `snap-start` and `snap-end` — which makes
 * exactly two offsets reachable, `0` and the scroller's own maximum, and
 * nothing in between (`draftSnapStops.ts`). The 15% each pane leaves over is
 * the OTHER pane's live band, so all four bands are on screen at both stops:
 * the pack's status/Peek bar and the pool's tab never go away, they only swap
 * which one has the room.
 *
 * The strip percentages are computed against the PANE, not the viewport
 * (`draftStripFraction`) — 15% of the screen is 17.6% of an 85% pane.
 */
export default function DraftPortraitPanes({
    scrollerRef,
    snap,
    packGrid,
    timer,
    pool,
    densityToggle,
    mainCount,
    sideCount,
    pickNumber,
    packLeft,
    selected,
    actions,
    pulsing,
}: DraftPhonePanesProps) {
    return (
        <div
            ref={scrollerRef}
            onScroll={snap.onScroll}
            data-slot="draft-snap-scroller"
            data-orientation="portrait"
            data-stop={snap.stop}
            className="flex min-h-0 w-full flex-1 snap-y snap-mandatory flex-col overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:none]"
        >
            <section
                data-slot="draft-pane"
                data-pane="pack"
                style={PANE_STYLE}
                className="flex w-full shrink-0 snap-start flex-col"
            >
                {/* The grid scrolls itself (`limited-draft-pack.tsx`) — no
                    wrapper, so the scroll container's tallest child is a card
                    and not the whole `<ul>`. */}
                {packGrid}
                <DraftPackStatusBar
                    stop={snap.stop}
                    pickNumber={pickNumber}
                    packLeft={packLeft}
                    pulsing={pulsing}
                    timer={timer}
                    densityToggle={densityToggle}
                    selected={selected}
                    actions={actions}
                    onOpenPack={() => snap.snapTo("pack")}
                    style={STRIP_STYLE}
                />
            </section>

            <section
                data-slot="draft-pane"
                data-pane="pool"
                style={PANE_STYLE}
                className="flex w-full shrink-0 snap-end flex-col"
            >
                <DraftPoolStrip
                    stop={snap.stop}
                    mainCount={mainCount}
                    sideCount={sideCount}
                    onOpenPool={() => snap.snapTo("pool")}
                    style={STRIP_STYLE}
                />
                {/* The Pool splits Main / Sideboard here (ADR 0101 §6) — the
                    same `LimitedDraftPool`, stacked instead of side by side.
                    A 160px Sideboard rail beside a 390px pool is what that
                    surface does on a desktop and it cannot survive the width. */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    {pool}
                </div>
            </section>
        </div>
    );
}
