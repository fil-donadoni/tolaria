import CardImage from "~/components/cards/card-image";
import type { DeckCard } from "~/types/game";

interface BuilderPileProps {
    label: string;
    cards: DeckCard[];
    onRemove: (cardId: string) => void;
}

const OFFSET_Y_REM = 1.4;

/** Vertical pile mirroring `ManaPile`, but every overlaid card is clickable
 *  to remove one copy from the deck. Last card on top reads as a button so
 *  the click target is the visible art. */
export default function BuilderPile({
    label,
    cards,
    onRemove,
}: BuilderPileProps) {
    const pileHeight = `calc(var(--card-h) + ${
        Math.max(0, cards.length - 1) * OFFSET_Y_REM
    }rem)`;

    return (
        <div className="flex w-[var(--card-w)] shrink-0 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 text-xs text-white/70">
                <span className="font-semibold">{label}</span>
                <span className="text-white/40">{cards.length}</span>
            </div>
            <div
                className="relative w-[var(--card-w)]"
                style={{ height: pileHeight }}
            >
                {cards.map((card, idx) => (
                    <button
                        key={`${card.cardId}-${idx}`}
                        onClick={() => onRemove(card.cardId)}
                        className="group absolute left-0 aspect-5/7 w-[var(--card-w)] transition hover:translate-x-1"
                        style={{ top: `${idx * OFFSET_Y_REM}rem` }}
                        title={`Remove ${card.cardName}`}
                    >
                        <CardImage card={{ id: card.cardId }} />
                        <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-transparent group-hover:ring-rose-400/70" />
                    </button>
                ))}
            </div>
        </div>
    );
}
