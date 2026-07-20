import type { CardInstance } from "~/types/game";
import { isPlaneswalker } from "~/lib/card-utils";

/** Loyalty badge (CR 306.5b) shown on the bottom-right of a battlefield
 *  planeswalker — the planeswalker's current loyalty, read from the generic
 *  `counters["loyalty"]` map the engine keeps (starting loyalty on ETB, then
 *  adjusted by loyalty abilities and loyalty-removing damage). Renders nothing
 *  for a non-planeswalker; a planeswalker at 0 loyalty leaves the battlefield as
 *  an SBA, so a rendered badge always shows a positive value. */
export default function PlaneswalkerLoyaltyBadge({
    card,
}: {
    card: CardInstance;
}) {
    if (!isPlaneswalker(card)) return null;
    const loyalty = card.counters?.loyalty ?? 0;
    return (
        <div
            className="absolute bottom-1.5 right-1.5 flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full border border-accent/60 bg-accent text-primary-foreground text-sm font-extrabold leading-none pointer-events-none z-10 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]"
            aria-label={`${loyalty} loyalty`}
        >
            {loyalty}
        </div>
    );
}
