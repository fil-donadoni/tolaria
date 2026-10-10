// PROTOTYPE — throwaway. Printed card images in an auto-fill grid whose
// column width is the zoom; optional count / caption badge per card.
import { getPrintedCardImageUrl } from "~/lib/images";
import type { ProtoCard } from "../proto-cards";

export interface GridCard {
    card: ProtoCard;
    key: string;
    count?: number;
    caption?: string;
}

export default function CardImageGrid({
    cards,
    zoom,
}: {
    cards: GridCard[];
    zoom: number;
}) {
    return (
        <ul
            className="grid gap-1.5"
            style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(min(${zoom}px, 100%), 1fr))`,
            }}
        >
            {cards.map(({ card, key, count, caption }) => (
                <li key={key} className="relative" title={card.name}>
                    <img
                        src={getPrintedCardImageUrl(card.id)}
                        alt={card.name}
                        loading="lazy"
                        className="aspect-[488/680] w-full rounded-[4.75%/3.5%] bg-surface-elevated object-cover shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
                    />
                    {count !== undefined && count > 1 && (
                        <span className="absolute right-1 top-[12%] rounded-full bg-black/80 px-1.5 text-xs font-bold tabular-nums text-parchment ring-1 ring-white/30">
                            ×{count}
                        </span>
                    )}
                    {caption && (
                        <span className="absolute left-1 top-1 rounded-sm bg-black/80 px-1 text-[10px] font-semibold tabular-nums text-parchment">
                            {caption}
                        </span>
                    )}
                </li>
            ))}
        </ul>
    );
}
