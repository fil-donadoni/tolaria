import CardImage from "~/components/cards/card-image";
import type { DeckCard } from "~/types/game";

interface ManaPileProps {
    label: string;
    cards: DeckCard[];
}

const OFFSET_Y_REM = 1.4;

export default function ManaPile({ label, cards }: ManaPileProps) {
    const pileHeight = `calc(var(--card-h) + ${
        (cards.length - 1) * OFFSET_Y_REM
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
                        className="absolute left-0 w-(--card-w) aspect-5/7"
                        style={{ top: `${idx * OFFSET_Y_REM}rem` }}
                    >
                        <CardImage card={{ id: card.cardId }} />
                    </div>
                ))}
            </div>
        </div>
    );
}
