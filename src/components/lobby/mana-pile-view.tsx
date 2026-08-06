import { useMemo } from "react";
import { createColumnLayout, resolveColumnLayout } from "@convex/deckLayout";
import type { DeckCard } from "~/types/game";
import { deckCardLookup, useDeckCardShapeResolver } from "~/lib/deckCardShape";
import ManaPile from "./mana-pile";

interface ManaPileViewProps {
    cards: DeckCard[];
    /** True for a Tabletop (`manual`) deck, whose cards may be catalogue-only
     *  and unknown to the card registry (ADR 0080). Drives the catalogue-backed
     *  shape resolver — and, with it, whether the ~34k-row catalogue is fetched
     *  at all. */
    catalogueBacked?: boolean;
}

export default function ManaPileView({
    cards,
    catalogueBacked = false,
}: ManaPileViewProps) {
    const resolveShape = useDeckCardShapeResolver(catalogueBacked);
    // Columns come from the shared Column Layout engine (ADR 0075, issue
    // #1622) — the same authority the deckbuilder zone surface reads, in place
    // of the retired `groupDeckIntoPiles`. This is a read-only PREVIEW with no
    // drop targets, so the empty columns of the fixed `mv` ladder are dropped
    // and only the piles that hold a card render — the dynamic look the pile
    // view has always had.
    const piles = useMemo(() => {
        const names = new Map(cards.map((c) => [c.cardId, c.cardName]));
        return resolveColumnLayout<DeckCard>({
            layout: createColumnLayout(),
            items: cards,
            adapter: {
                cardId: (c) => c.cardId,
                pinKey: (c) => c.cardId,
                tiebreak: (a, b) => a.cardId.localeCompare(b.cardId),
            },
            lookup: deckCardLookup(resolveShape, (id) => names.get(id)),
        }).filter((column) => column.items.length > 0);
    }, [cards, resolveShape]);

    if (piles.length === 0) {
        return (
            <p className="text-sm text-text-muted">This deck has no cards.</p>
        );
    }

    return (
        <div className="overflow-x-auto whitespace-nowrap">
            {piles.map((pile, i) => (
                <div
                    key={pile.id}
                    className={`inline-block align-top whitespace-normal ${i > 0 ? "ml-2 md:ml-6" : ""}`}
                >
                    <ManaPile label={pile.label} cards={pile.items} />
                </div>
            ))}
        </div>
    );
}
