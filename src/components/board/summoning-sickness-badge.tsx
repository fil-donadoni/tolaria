import { Hourglass } from "lucide-react";
import type { CardInstance } from "~/types/game";
import { isCreature } from "~/lib/card-utils";

/** CR 302.6 — persistent "this creature is summoning sick" marker.
 *
 *  Summoning sickness used to be legible only during DECLARE_ATTACKERS, where
 *  the attacker-selection pass dims ineligible creatures. Outside combat the
 *  board gave no signal at all, so a player could not tell a freshly-resolved
 *  creature from one that had been there a turn (it matters all turn: {T}/{Q}
 *  activated abilities are locked too, CR 302.1). This badge is the persistent
 *  turn-long signal.
 *
 *  CR 702.10b — haste lifts the restriction entirely, so a hasty creature is
 *  NOT marked even while `isSummoningSick` is still true. Reads
 *  `staticAbilities` directly so `grantAbility`-granted haste counts, mirroring
 *  `isTapLockedBySummoningSickness` and the attacker check in `combat.ts`.
 *
 *  Purely presentational — pointer-events are off so it never intercepts the
 *  card's tap/target/ability gestures. */
export default function SummoningSicknessBadge({
    card,
}: {
    card: CardInstance;
}) {
    if (!card.isSummoningSick || !isCreature(card)) return null;
    if (card.staticAbilities?.includes("haste")) return null;

    return (
        <div
            data-summoning-sick="true"
            className="absolute top-1 left-1 z-20 pointer-events-none rounded-full bg-black/70 p-1 ring-1 ring-white/30 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]"
            title="Summoning sick — can't attack or pay {T} this turn"
            aria-label="Summoning sick"
        >
            <Hourglass className="w-3 h-3 text-signal-pending" />
        </div>
    );
}
