import type { CardInstance } from "~/types/game";
import CardImage from "../cards/card-image";
import CardBack from "../cards/card-back";

type BoardNextCardProps = {
    /** The card to show, or `null` for a hidden (opponent-hand) slot. */
    card: CardInstance | null;
};

/** Presentational card for the new spatial board. Fills its placed slot
 *  (positioned by {@link SpatialZone} from the shared layout output) with the
 *  card art, or a back when the instance is hidden. Interaction — clicks, mana
 *  taps, combat, drag-to-cast — is wired in later slices (#252+); this slice is
 *  layout only, so the GRE boundary stays untouched. */
export default function BoardNextCard({ card }: BoardNextCardProps) {
    return (
        <div className="w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 shadow-[0_6px_16px_rgba(0,0,0,0.55)]">
            {card ? <CardImage card={card} /> : <CardBack />}
        </div>
    );
}
