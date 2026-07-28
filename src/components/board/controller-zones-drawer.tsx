import type { Player } from "~/types/game";
import { ABOVE_CONTROLLER_BAR } from "~/lib/controller-bar-metrics";
import BoardPileChips from "./board-pile-chips";

/** The portrait bar's Zones drawer (variant D, #1759).
 *
 *  The viewer's graveyard / library / exile chips used to float on the board at
 *  `bottom-24`, i.e. directly underneath the new bar — unreachable, which is
 *  exactly the overlap this ticket removes. Rather than rebuild them, the Zones
 *  tab opens the EXISTING {@link BoardPileChips} row (the same chips, opening
 *  the same reveal dialogs) in a sheet that floats clear of the bar.
 *
 *  **Always mounted, only ever hidden.** {@link BoardPileChips} is the sole
 *  portrait mount of `PlayerLibrary` / `PlayerGraveyard` / `PlayerExile`, and
 *  those components own the BLOCKING choice surfaces —
 *  `LibraryOrderPicker` (scry / surveil / Ponder / Portent / Impulse / Stock Up
 *  / reorder-library) and the `forceOpen` pile grids (library search, look-top,
 *  graveyard pick, exile pick). `PendingChoicePrompt` deliberately renders
 *  NOTHING for those kinds because the pile owns them, so unmounting this
 *  drawer while it is closed would leave the player with no UI at all for a
 *  blocking choice — a softlock. The drawer therefore stays mounted for the
 *  whole game and the Zones tab toggles VISIBILITY only (`hidden`). Both choice
 *  surfaces render through a portal (the pile grids via `GameDialog`'s Base UI
 *  portal, the order picker via `createPortal` to `document.body`), so they
 *  escape the hidden container and appear over the board regardless of the
 *  drawer's state.
 *
 *  It floats clear of the bar by anchoring to the bar's MEASURED height
 *  ({@link ABOVE_CONTROLLER_BAR}), not a fixed inset: the bar's command row
 *  wraps, and a hard-coded `bottom-32` put the drawer's own edge back underneath
 *  the two-line DECLARE_ATTACKERS bar — reintroducing this ticket's overlap.
 *
 *  Not thin any more (#1766): reusing {@link BoardPileChips} unchanged means
 *  the drawer already carries the FULL pile presentation — reveal dialogs,
 *  library order picker, forced pile grids — not a stripped-down preview. */
export default function ControllerZonesDrawer({
    player,
    open,
}: {
    player: Player;
    open: boolean;
}) {
    return (
        <div
            data-controller-zones-drawer
            data-open={open ? "true" : "false"}
            role="group"
            aria-label="Your zones"
            aria-hidden={!open}
            className={`fixed inset-x-3 ${ABOVE_CONTROLLER_BAR} z-50 justify-center rounded-2xl border border-border-subtle bg-surface-base/95 p-2 shadow-2xl backdrop-blur-xl ${
                open ? "flex" : "hidden"
            }`}
        >
            <BoardPileChips player={player} />
        </div>
    );
}
