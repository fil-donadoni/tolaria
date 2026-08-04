import { useMemo } from "react";
import type { DeckCard } from "~/types/game";
import {
    registryDeckCardShape,
    type DeckCardShapeResolver,
} from "~/lib/deckCardShape";
import { groupDeckIntoPiles } from "../deckGrouping";
import BuilderPile from "./builder-pile";
import DeckDropZone from "./deck-drop-zone";
import type { DropZoneId } from "./dnd-types";

interface DeckPileAreaProps {
    /** Section heading, e.g. "Maindeck" / "Sideboard". */
    title: string;
    cards: DeckCard[];
    /** Zone id — both the drop target and the drag-source tag for its cards. */
    zone: DropZoneId;
    onRemove: (cardId: string) => void;
    /** When true, bucket cards into mana-value piles (Maindeck). When false,
     *  render every card in one pile (Sideboard). */
    grouped: boolean;
    /** Optional count suffix, e.g. "/15" for the Sideboard limit. */
    countSuffix?: string;
    /** Optional soft-limit warning shown next to the count. */
    warning?: string | null;
    /** Message rendered when the section is empty. */
    emptyMessage: string;
    /** Optional control rendered at the right of the header (e.g. zoom slider). */
    headerRight?: React.ReactNode;
    /** Resolved Featured Card ID for this deck (PRD #589, issue #599). The
     *  matching card is marked in the pile. Only the Maindeck wires it. */
    featuredCardId?: string | null;
    /** Pick a card as the deck's Featured Card. Presence enables the
     *  "Set as featured" affordance on each card. Maindeck only. */
    onSetFeatured?: (cardId: string) => void;
    /** Deck-card shape seam (`~/lib/deckCardShape`). A Tabletop deck holds
     *  catalogue-only cards the registry can't resolve (ADR 0080), so the
     *  manual builder passes the catalogue-backed resolver. */
    resolveShape?: DeckCardShapeResolver;
}

export default function DeckPileArea({
    title,
    cards,
    zone,
    onRemove,
    grouped,
    countSuffix,
    warning,
    emptyMessage,
    headerRight,
    featuredCardId,
    onSetFeatured,
    resolveShape = registryDeckCardShape,
}: DeckPileAreaProps) {
    const piles = useMemo(
        () =>
            grouped
                ? groupDeckIntoPiles(cards, resolveShape)
                : [{ key: zone, label: "", cards }],
        [grouped, cards, zone, resolveShape]
    );

    return (
        <DeckDropZone id={zone} className="flex h-full flex-col">
            <div className="flex items-baseline gap-2 px-3 pt-3 text-sm md:px-4">
                <span className="font-semibold font-beleren tracking-wide text-parchment">
                    {title} {cards.length}
                    {countSuffix ?? ""}
                </span>
                {warning && (
                    <span className="text-xs font-semibold text-danger-strong">
                        {warning}
                    </span>
                )}
                {headerRight && (
                    <div className="ml-auto self-center">{headerRight}</div>
                )}
            </div>
            {cards.length === 0 ? (
                <div className="flex flex-1 items-start px-3 py-4 text-sm text-text-muted md:px-4">
                    {emptyMessage}
                </div>
            ) : (
                <div className="flex flex-1 items-start gap-3 overflow-auto p-3 md:gap-6 md:p-4">
                    {piles.map((pile) => (
                        <BuilderPile
                            key={pile.key}
                            label={pile.label}
                            cards={pile.cards}
                            zone={zone}
                            onRemove={onRemove}
                            featuredCardId={featuredCardId}
                            onSetFeatured={onSetFeatured}
                        />
                    ))}
                </div>
            )}
        </DeckDropZone>
    );
}
