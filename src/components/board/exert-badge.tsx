import { ChevronsDown } from "lucide-react";
import type { CardInstance } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { exertStatus } from "~/lib/exert-status";

/** CR 701.43a — persistent "this permanent will not untap" marker.
 *
 *  Two states, one icon: a REVOCABLE exert chosen for the declaration being
 *  made (`combat.exertedIds`, dashed amber border) and a locked-in cost (the
 *  permanent's own `skipNextUntap` flag, solid red ring — which also carries
 *  non-exert causes). Reads projected state, never the card name or art.
 *
 *  Sits bottom-centre: top-left is summoning sickness / prepared, top-centre
 *  the manual note, top-right the combat index, centre the counters,
 *  bottom-left the noted-mana / class / token stack and bottom-right the P/T
 *  stack. Purely presentational — pointer-events are off. */
export default function ExertBadge({ card }: { card: CardInstance }) {
    const ctx = useGameContext();
    const status = exertStatus(card, ctx?.combat);
    if (!status) return null;
    const pending = status === "pending";

    return (
        <div
            data-exert={status}
            className={`absolute bottom-1 left-1/2 -translate-x-1/2 z-20 pointer-events-none rounded-full bg-black/70 p-1 ${
                pending
                    ? "border border-dashed border-signal-pending"
                    : "ring-1 ring-danger-strong"
            } drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]`}
            title={
                pending
                    ? "Exert chosen — won't untap next untap step (revocable until you confirm attackers)"
                    : "Won't untap during its controller's next untap step"
            }
            aria-label={pending ? "Exert pending" : "Exerted"}
        >
            <ChevronsDown
                className={`w-3 h-3 ${pending ? "text-signal-pending" : "text-danger-strong"}`}
            />
        </div>
    );
}
