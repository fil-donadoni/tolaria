import { getDefinition } from "@convex/cards";
import type { CardInstance } from "~/types/game";
import CardImage from "~/components/cards/card-image";
import { PILE_GRID_TILE_W } from "~/lib/card-layout";

/** Card-selection step of the graveyard target dialog (issue #314). Lists the
 *  legal cards in one graveyard face-up; clicking a card submits it as the
 *  graveyard-card target. Buttons disable while the parent's `selectTarget`
 *  mutation is in flight. */
export default function GraveyardCardPicker({
    cards,
    isPending,
    onPick,
}: {
    cards: CardInstance[];
    isPending: boolean;
    onPick: (cardId: string) => void;
}) {
    // Fixed-width, centered cards (parity with the graveyard pile's GridLayout).
    // A stretch grid (`grid-cols-3`) would blow a single card up to a third of
    // the wide dialog and pin it top-left; capping + `justify-center` keeps one
    // card at a sane size and lets many wrap tidily.
    return (
        <div className="flex flex-wrap justify-center gap-2 mt-2">
            {cards.map((card) => (
                <button
                    key={card.id}
                    type="button"
                    disabled={isPending}
                    onClick={() => onPick(card.id)}
                    title={getDefinition(card.card.id).name}
                    className={`relative ${PILE_GRID_TILE_W} aspect-5/7 shrink-0 rounded-sm overflow-hidden ring-1 ring-transparent hover:ring-2 hover:ring-accent disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer`}
                >
                    {/* PILE_GRID_TILE_W renders 68px below the compact
                        breakpoint, 96-112px at/above it (card-layout.ts).
                        `sizes`/`includeThumb` stay a static MID-slot hint
                        here (unlike cards-pile.tsx's GridCard, which reads
                        the live viewport for issue #1817 round 2) — this
                        picker's card count is small (one graveyard's legal
                        targets), so the over-fetch risk that motivated the
                        cards-pile.tsx fix doesn't apply here. */}
                    <CardImage card={card} sizes="112px" includeThumb={false} />
                </button>
            ))}
        </div>
    );
}
