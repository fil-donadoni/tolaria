import type { Player } from "~/types/game";
import CardImage from "../cards/card-image";
import CompanionSummonButton from "./companion-summon-button";

/** Companion slot (CR 702.139, ADR 0064) — a single revealed card next to the
 *  library/graveyard/exile piles (`board-piles.tsx`), NOT a pile: unlike
 *  those, there is nothing to expand — the slot holds exactly one card,
 *  always face-up to both players (CR 702.139c). Renders nothing when the
 *  player declared no companion (`player.companion` absent — either their
 *  deck carries none, or its condition failed). The "Companion {3}" summon
 *  affordance (CR 116.2 / 702.139f) is gated purely by the wire-projected
 *  `companion.canSummon` (present only on the slot's own controller's view,
 *  `gameProjections.ts`) — the server re-validates on click regardless. */
export default function PlayerCompanion({ player }: { player: Player }) {
    const companion = player.companion;
    if (!companion) return null;

    return (
        <div
            data-testid={`companion-${player.id}`}
            // `shrink-0` so a crowded pile row narrows nothing: the tile is one
            // card wide and `aspect-5/7` tall, exactly like the emblem tile
            // beside it. Without it the flex row could squeeze the box and the
            // `object-cover` art would crop.
            className="relative w-(--card-w-sm) shrink-0 aspect-5/7"
        >
            <div
                className={
                    companion.used
                        ? "w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 opacity-50 grayscale"
                        : "w-full h-full rounded-sm overflow-hidden ring-1 ring-border-accent/60"
                }
                title={
                    companion.used
                        ? "Companion (already summoned this game)"
                        : "Companion"
                }
            >
                <CardImage card={companion.instance} />
            </div>
            {companion.canSummon && <CompanionSummonButton />}
        </div>
    );
}
