import CardImage from "~/components/cards/card-image";
import type { DeckCard } from "~/types/game";

interface BuilderPileProps {
    label: string;
    cards: DeckCard[];
    onRemove: (cardId: string) => void;
    /** Label for the per-card move action ("→ Side" / "→ Main"). When omitted
     *  no move button is rendered. */
    moveLabel?: string;
    onMove?: (cardId: string) => void;
}

const OFFSET_Y_REM = 1.4;

/** Vertical pile mirroring `ManaPile`, but every overlaid card is clickable
 *  to remove one copy from the deck. Last card on top reads as a button so
 *  the click target is the visible art. An optional move action shifts a
 *  single copy between Maindeck and Sideboard (issue #391). */
export default function BuilderPile({
    label,
    cards,
    onRemove,
    moveLabel,
    onMove,
}: BuilderPileProps) {
    const pileHeight = `calc(var(--card-h) + ${
        Math.max(0, cards.length - 1) * OFFSET_Y_REM
    }rem)`;

    return (
        <div className="flex w-(--card-w) shrink-0 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 text-xs text-text-muted">
                <span className="font-semibold">{label}</span>
                <span className="text-text-disabled">{cards.length}</span>
            </div>
            <div
                className="relative w-(--card-w)"
                style={{ height: pileHeight }}
            >
                {cards.map((card, idx) => (
                    <div
                        key={`${card.cardId}-${idx}`}
                        className="group absolute left-0 aspect-5/7 w-(--card-w)"
                        style={{ top: `${idx * OFFSET_Y_REM}rem` }}
                    >
                        <button
                            onClick={() => onRemove(card.cardId)}
                            className="block aspect-5/7 w-(--card-w) transition group-hover:translate-x-1"
                            title={`Remove ${card.cardName}`}
                        >
                            <CardImage card={{ id: card.cardId }} />
                            <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-transparent group-hover:ring-danger-strong/70" />
                        </button>
                        {moveLabel && onMove && (
                            <button
                                type="button"
                                onClick={() => onMove(card.cardId)}
                                className="absolute right-0 top-0 z-10 rounded-bl-sm rounded-tr-sm bg-surface/90 px-1.5 py-0.5 text-[0.625rem] font-semibold text-accent opacity-0 transition group-hover:opacity-100 hover:bg-accent hover:text-surface-base"
                                title={`Move ${card.cardName} ${moveLabel}`}
                            >
                                {moveLabel}
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
