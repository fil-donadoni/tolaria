import { ScrollText } from "lucide-react";
import type { CardInstance } from "~/types/game";
import { isCreature } from "~/lib/card-utils";

/** CR 722.3a — persistent "this permanent is PREPARED" marker.
 *
 *  Prepared is "a designation that acts as a marker which rules and effects
 *  can identify", and it is what makes the permanent's prepare spell castable:
 *  while it holds, its controller has a copy of that spell in exile they may
 *  cast (CR 722.3c). Casting it removes the marker, so the board must show
 *  which permanents still have one before a player spends it, or before an
 *  opponent removes the permanent to take the copy away.
 *
 *  Reads the projected `prepared` flag, never the definition: a preparation
 *  card that is not prepared (it already cast its copy) shows nothing.
 *
 *  Sits top-left, the summoning-sickness corner — a creature that enters
 *  prepared is very often sick too, so the badge steps BELOW that one when it
 *  is live (the same predicate `SummoningSicknessBadge` renders on).
 *
 *  Purely presentational — pointer-events are off so it never intercepts the
 *  card's tap/target/ability gestures. */
export default function PreparedBadge({ card }: { card: CardInstance }) {
    if (card.prepared !== true) return null;
    const sick =
        card.isSummoningSick === true &&
        isCreature(card) &&
        !card.staticAbilities?.includes("haste");

    return (
        <div
            data-prepared="true"
            className={`absolute ${sick ? "top-7" : "top-1"} left-1 z-20 pointer-events-none rounded-full bg-black/70 p-1 ring-1 ring-white/30 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]`}
            title="Prepared — you may cast a copy of its prepare spell from exile"
            aria-label="Prepared"
        >
            <ScrollText className="w-3 h-3 text-secondary-accent-strong" />
        </div>
    );
}
