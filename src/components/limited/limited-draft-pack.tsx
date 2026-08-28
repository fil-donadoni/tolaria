import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import { cardBase } from "~/lib/cardSizing";
import EmptyState from "~/components/ui/empty-state";
import LimitedDraftPackCard from "./limited-draft-pack-card";

type DraftPackCard = NonNullable<LimitedEventSeatView["currentPack"]>[number];

// Same responsive base size the shared pool deckbuilder surface scales from
// (`pool-deck-builder-form.tsx`'s `CARD_BASE`) — kept in sync so the
// Booster and the Pool below it read at a comparable default size. Floored
// at CARD_MIN_W (issue #2056) so a short-and-wide viewport can't collapse it.
const CARD_BASE = cardBase("7.5rem", "17vw", "9dvh");

/** The Booster currently in front of the viewer (PRD #1107 stories 10-11,
 *  issue #1112): one card per tile, with a zoom slider (ADR 0060, issue
 *  #1247, PRD #1107 story 21) driving each card's rendered size the same way
 *  the deckbuilder's `CardZoomSlider` does. Sorted by name only for display
 *  — `pickId` (not array position) is what `onPick`/`onSelect`/`onOpenMenu`
 *  send, so re-sorting never changes which physical card is targeted.
 *
 *  Gesture wiring (ADR 0060, issue #1248) — see `LimitedDraftPackCard`'s doc
 *  comment for the full single-click/double-click/right-click/drag
 *  contract; this component only threads `selectedPickId` down to decide
 *  which single tile renders the "selected" highlight. */
export default function LimitedDraftPack({
    pack,
    selectedPickId,
    onSelect,
    onPick,
    onOpenMenu,
    onOpenContextMenu,
    pending,
    zoom,
    columns,
}: {
    pack: DraftPackCard[];
    selectedPickId: string | null;
    onSelect: (pickId: string) => void;
    /** See `LimitedDraftPackCard`'s own doc comment (issue #2861): absent on
     *  desktop, retiring double-click-to-pick there. */
    onPick?: (pickId: string) => void;
    /** Desktop: left click also opens the pack menu (issue #2861). Absent on
     *  phone. */
    onOpenMenu?: (pickId: string, x: number, y: number) => void;
    /** Phone: real right-click opens the old "Pick" / "Pick to sideboard"
     *  menu, unchanged. Absent on desktop (issue #2889) — there, right-click
     *  falls through to the ordinary `CardPreview` pin. */
    onOpenContextMenu?: (pickId: string, x: number, y: number) => void;
    pending: boolean;
    /** Zoom multiplier from the caller's `useCardZoom` (default 1 if the
     *  caller doesn't wire a slider). */
    zoom?: number;
    /** A FIXED column count (issue #2588, ADR 0101 §6: "pack grid 3×5
     *  portrait / 8×2 landscape with a density toggle"). The phone
     *  arrangements lay the Booster out in a known grid so a 15-card pack
     *  fits a pane, rather than in `auto-fill` tracks sized from a card
     *  width; `zoom` is then irrelevant and the phone surfaces mount no
     *  slider. Absent = the desktop `auto-fill` grid, unchanged. */
    columns?: number;
}) {
    if (pack.length === 0) {
        return <EmptyState message="Waiting for the next pack…" />;
    }

    const sorted = [...pack].sort((a, b) =>
        a.cardName.localeCompare(b.cardName)
    );

    return (
        <ul
            className={
                columns === undefined
                    ? "grid gap-3"
                    : // The grid IS the scroller in the fixed-column
                      // arrangement (issue #2588) — no wrapper. A wrapper
                      // whose single child is this whole `<ul>` is a scroll
                      // container shorter than its tallest child, which is
                      // what the UI gate's `starved` probe counts (and it
                      // cannot tell that shape apart from the deck-builder
                      // bug it exists to catch, a 66px window around a 101px
                      // tile). Scrolling the tiles themselves measures
                      // honestly: the tallest child is one card.
                      "grid min-h-0 flex-1 content-start gap-1.5 overflow-x-hidden overflow-y-auto overscroll-contain"
            }
            data-slot="draft-pack-grid"
            data-columns={columns}
            style={
                {
                    gridTemplateColumns:
                        columns === undefined
                            ? `repeat(auto-fill, minmax(calc(${CARD_BASE} * ${zoom ?? 1}), 1fr))`
                            : `repeat(${columns}, minmax(0, 1fr))`,
                } as React.CSSProperties
            }
        >
            {sorted.map((card) => (
                <li key={card.pickId}>
                    <LimitedDraftPackCard
                        card={card}
                        selected={card.pickId === selectedPickId}
                        onSelect={onSelect}
                        onPick={onPick}
                        onOpenMenu={onOpenMenu}
                        onOpenContextMenu={onOpenContextMenu}
                        pending={pending}
                    />
                </li>
            ))}
        </ul>
    );
}
