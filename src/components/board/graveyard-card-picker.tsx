import { getDefinition } from "@convex/cards";
import type { CardInstance } from "~/types/game";
import CardImage from "~/components/cards/card-image";

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
                    className="relative w-24 sm:w-28 aspect-5/7 shrink-0 rounded-sm overflow-hidden ring-1 ring-transparent hover:ring-2 hover:ring-accent disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                    <CardImage card={card} />
                </button>
            ))}
        </div>
    );
}
