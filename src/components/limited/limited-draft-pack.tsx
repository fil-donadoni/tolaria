import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import { cardBase } from "~/lib/cardSizing";
import LimitedDraftPackCard from "./limited-draft-pack-card";

type DraftPackCard = NonNullable<LimitedEventSeatView["currentPack"]>[number];

// Same responsive base size the shared pool deckbuilder surface scales from
// (`pool-deckbuilder-surface.tsx`'s `CARD_BASE`) — kept in sync so the
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
    pending,
    zoom,
}: {
    pack: DraftPackCard[];
    selectedPickId: string | null;
    onSelect: (pickId: string) => void;
    onPick: (pickId: string) => void;
    onOpenMenu: (pickId: string, x: number, y: number) => void;
    pending: boolean;
    /** Zoom multiplier from the caller's `useCardZoom` (default 1 if the
     *  caller doesn't wire a slider). */
    zoom?: number;
}) {
    if (pack.length === 0) {
        return (
            <p className="text-sm text-text-muted">
                Waiting for the next pack…
            </p>
        );
    }

    const sorted = [...pack].sort((a, b) =>
        a.cardName.localeCompare(b.cardName)
    );

    return (
        <ul
            className="grid gap-3"
            style={
                {
                    gridTemplateColumns: `repeat(auto-fill, minmax(calc(${CARD_BASE} * ${zoom ?? 1}), 1fr))`,
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
                        pending={pending}
                    />
                </li>
            ))}
        </ul>
    );
}
