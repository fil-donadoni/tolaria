import CardImage from "~/components/cards/card-image";
import type { ReviewCard } from "~/lib/limited/limitedReviewGroups";

/** A wrapped grid of card faces at `zoom` px wide (issue #5392). A face with
 *  `count` > 1 wears a ×N badge, one with `caption` a pick label; both are
 *  labels, not controls. */
export default function LimitedReviewCardGrid({
    cards,
    zoom,
    ordered = false,
}: {
    cards: ReviewCard[];
    zoom: number;
    /** An `<ol>` when the sequence carries the meaning (pick order). */
    ordered?: boolean;
}) {
    const Tag = ordered ? "ol" : "ul";
    return (
        <Tag
            className="flex list-none flex-wrap gap-2 p-0"
            style={{ "--card-w": `${zoom}px` } as React.CSSProperties}
        >
            {cards.map((card) => (
                <li
                    key={card.key}
                    data-card-name={card.cardName}
                    title={
                        card.caption
                            ? `${card.caption} — ${card.cardName}`
                            : card.cardName
                    }
                    className="relative aspect-5/7 w-(--card-w) shrink-0"
                >
                    <CardImage card={{ id: card.cardId }} lazy />
                    {card.count !== undefined && card.count > 1 && (
                        <span
                            data-slot="card-count"
                            className="pointer-events-none absolute right-0.5 bottom-0.5 rounded-sm border border-border-accent/70 bg-surface-base/90 px-1 text-xs font-semibold text-parchment"
                        >
                            ×{card.count}
                        </span>
                    )}
                    {card.caption && (
                        <span
                            data-slot="card-caption"
                            className="pointer-events-none absolute top-0.5 left-0.5 rounded-sm border border-border-accent/70 bg-surface-base/90 px-1 text-[0.625rem] leading-4 font-semibold text-parchment"
                        >
                            {card.caption}
                        </span>
                    )}
                </li>
            ))}
        </Tag>
    );
}
