import type { CardInstance } from "~/types/game";
import CardImage from "../cards/card-image";
import CardBack from "../cards/card-back";
import CardTilt3D from "./card-tilt-3d";

type BoardNextCardProps = {
    /** The card to show, or `null` for a hidden (opponent-hand) slot. */
    card: CardInstance | null;
};

/** Presentational card for the new spatial board. Fills its placed slot
 *  (positioned by {@link SpatialZone} from the shared layout output) with the
 *  card art, or a back when the instance is hidden.
 *
 *  Hover interaction (#253) is layered here without touching the GRE boundary:
 *  - {@link CardTilt3D} adds the Arena-style 3D tilt-to-cursor + moving glare +
 *    lift/scale. It tilts an INNER element so the effect composes with the outer
 *    slot's placement transform and the `motion` FLIP layer (#252) instead of
 *    fighting them.
 *  - Hover-zoom preview already rides along for free: {@link CardImage} wraps its
 *    content in `CardPreview`, which anchors a full-card zoom panel to THIS card
 *    element — so a small or overlapped board card can still be read in full.
 *
 *  Clicks, mana taps, combat, and drag-to-cast are wired in later slices. */
export default function BoardNextCard({ card }: BoardNextCardProps) {
    return (
        <CardTilt3D>
            <div className="w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 shadow-[0_6px_16px_rgba(0,0,0,0.55)]">
                {card ? <CardImage card={card} /> : <CardBack />}
            </div>
        </CardTilt3D>
    );
}
