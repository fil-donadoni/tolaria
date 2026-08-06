import DeckColumnPile, {
    type DeckPileTile,
} from "~/components/deckbuilder/deck-column-pile";
import { columnDropId } from "./limitedDraftDrag";

/** One tile in a column, plus the stable React key its host assigns.
 *  @deprecated Alias for {@link DeckPileTile} kept for the draft-Pool call
 *  sites; the shared name lives in `deck-column-pile.tsx` (issue #1622). */
export type PoolPileTile = DeckPileTile;

/** The draft-time Pool's fixed Mana-Value (or Lands) column — a thin adapter
 *  that maps the Pool's `number | "lands"` column identity onto the shared
 *  `DeckColumnPile` (issue #1622), so the Pool and both deckbuilders render
 *  the same pile with the same drop affordance. ADR 0075 §6 moves this surface
 *  onto the shared zone surface entirely in a later slice.
 *
 *  Must render under an ancestor `DragDropProvider` (each host owns its own).
 */
export default function PoolColumnPile({
    label,
    column,
    tiles,
}: {
    label: string;
    column: number | "lands";
    tiles: PoolPileTile[];
}) {
    return (
        <DeckColumnPile
            label={label}
            dropId={columnDropId(column)}
            dataColumn={String(column)}
            tiles={tiles}
        />
    );
}
