import CardImage from "~/components/cards/card-image";
import { pileCardTop, pileHeight } from "~/lib/card-layout";
import type { DeckCard } from "~/types/game";
import DraggableCard from "./draggable-card";
import FeaturedCardButton from "./featured-card-button";
import type { DropZoneId } from "./dnd-types";

interface BuilderPileProps {
    label: string;
    cards: DeckCard[];
    /** Zone this pile belongs to — tags drag payloads so a drop can move the
     *  card to the other zone. */
    zone: DropZoneId;
    onRemove: (cardId: string) => void;
    /** Resolved Featured Card ID for the deck (PRD #589, issue #599). The
     *  matching card shows a persistent indicator. */
    featuredCardId?: string | null;
    /** Pick a card as the deck's Featured Card. When present, each card's
     *  topmost copy gets a "Set as featured" affordance. */
    onSetFeatured?: (cardId: string) => void;
}

/** Vertical pile mirroring `ManaPile`. Each overlaid card is draggable (drop on
 *  the other zone to move it) and clickable to remove one copy. Last card on top
 *  reads as the primary target so the click/drag lands on the visible art. */
export default function BuilderPile({
    label,
    cards,
    zone,
    onRemove,
    featuredCardId,
    onSetFeatured,
}: BuilderPileProps) {
    // The featured affordance/indicator goes on the LAST (topmost, visible)
    // copy of each distinct card in the pile — lower copies are overlapped, so
    // putting the control there would hide it behind the next card.
    const topIndexByCardId = new Map<string, number>();
    cards.forEach((card, idx) => topIndexByCardId.set(card.cardId, idx));

    return (
        <div className="flex w-(--card-w) shrink-0 flex-col gap-2">
            {label && (
                <div className="flex items-baseline justify-between gap-2 text-xs text-text-muted">
                    <span className="font-semibold">{label}</span>
                    <span className="text-text-disabled">{cards.length}</span>
                </div>
            )}
            <div
                className="relative w-(--card-w)"
                style={{ height: pileHeight(cards.length) }}
            >
                {cards.map((card, idx) => {
                    const isTopCopy = topIndexByCardId.get(card.cardId) === idx;
                    const isFeatured =
                        !!featuredCardId && card.cardId === featuredCardId;
                    return (
                        <DraggableCard
                            key={`${card.cardId}-${idx}`}
                            id={`${zone}:${card.cardId}:${idx}`}
                            data={{
                                kind: zone,
                                cardId: card.cardId,
                                cardName: card.cardName,
                            }}
                            onClick={() => onRemove(card.cardId)}
                            title={`Remove ${card.cardName} (drag to move zone)`}
                            className="group absolute left-0 aspect-5/7 w-(--card-w) hover:translate-x-1"
                            style={{ top: pileCardTop(idx) }}
                        >
                            <CardImage card={{ id: card.cardId }} />
                            <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-transparent group-hover:ring-danger-strong/70" />
                            {isFeatured && (
                                <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-accent" />
                            )}
                            {onSetFeatured && isTopCopy && (
                                <FeaturedCardButton
                                    isFeatured={isFeatured}
                                    onSetFeatured={() =>
                                        onSetFeatured(card.cardId)
                                    }
                                />
                            )}
                        </DraggableCard>
                    );
                })}
            </div>
        </div>
    );
}
