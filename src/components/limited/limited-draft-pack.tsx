import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import LimitedDraftPackCard from "./limited-draft-pack-card";

type DraftPackCard = NonNullable<LimitedEventSeatView["currentPack"]>[number];

// Same responsive base size the shared pool deckbuilder surface scales from
// (`pool-deckbuilder-surface.tsx`'s `CARD_BASE`) — kept in sync so the
// Booster and the Pool below it read at a comparable default size.
const CARD_BASE = "min(7.5rem, 17vw, 9dvh)";

/** The Booster currently in front of the viewer (PRD #1107 stories 10-11,
 *  issue #1112): one Pick button per card, with a zoom slider (ADR 0060,
 *  issue #1247, PRD #1107 story 21) driving each card's rendered size the
 *  same way the deckbuilder's `CardZoomSlider` does. Sorted by name only for
 *  display — `pickId` (not array position) is what `onPick` sends, so
 *  re-sorting never changes which physical card gets picked. */
export default function LimitedDraftPack({
    pack,
    onPick,
    pending,
    zoom,
}: {
    pack: DraftPackCard[];
    onPick: (pickId: string) => void;
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
                        onPick={onPick}
                        pending={pending}
                    />
                </li>
            ))}
        </ul>
    );
}
