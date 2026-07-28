import type { Player } from "~/types/game";
import BoardPileChips from "./board-pile-chips";

/** The portrait bar's Zones drawer (variant D, #1759).
 *
 *  The viewer's graveyard / library / exile chips used to float on the board at
 *  `bottom-24`, i.e. directly underneath the new bar — unreachable, which is
 *  exactly the overlap this ticket removes. Rather than rebuild them, the Zones
 *  tab opens the EXISTING {@link BoardPileChips} row (the same chips, opening
 *  the same reveal dialogs) in a sheet that floats clear of the bar.
 *
 *  Deliberately thin: the richer pile presentation is tracked-by: #1766. */
export default function ControllerZonesDrawer({ player }: { player: Player }) {
    return (
        <div
            data-controller-zones-drawer
            role="group"
            aria-label="Your zones"
            className="fixed inset-x-3 bottom-32 z-50 flex justify-center rounded-2xl border border-border-subtle bg-surface-base/95 p-2 shadow-2xl backdrop-blur-xl"
        >
            <BoardPileChips player={player} />
        </div>
    );
}
