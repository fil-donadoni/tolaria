import type { Player } from "~/types/game";
import { usePlayerInteraction } from "~/hooks/usePlayerInteraction";

/** What the portrait bar's "You" tab needs to double as a player-target
 *  surface. */
export type SelfTargetTab = {
    /** The viewer's own seat is a legal target / damage-target candidate right
     *  now, so the tab should advertise itself as tappable. */
    targetable: boolean;
    /** Ring + cursor classes for the targetable state ("" otherwise). */
    ringClass: string;
    /** Dispatches the SAME `selectTarget` / choice-buffer toggle the nameplate
     *  dispatches — the shared controller, not a second code path. */
    onClick: () => void;
};

/** Self-target hook point for the portrait bottom bar (#1759).
 *
 *  The portrait audit's hard blocker: with a bar pinned to the bottom edge the
 *  viewer's own nameplate is buried underneath it, so "target yourself"
 *  (Ancestral Recall on you) is unreachable. The bar's own-life tab therefore
 *  IS the viewer's player-target surface, and this thin wrapper is the seam:
 *  it exposes the shared {@link usePlayerInteraction} controller plus the ring
 *  the tab wears while the player is a legal target.
 *
 *  Deliberately narrow. Divide-as-you-choose steppers and the full zone/target
 *  reachability pass are out of scope here — tracked-by: #1766. */
export function useSelfTargetTab(me: Player): SelfTargetTab {
    const interaction = usePlayerInteraction(me);
    const targetable =
        interaction.isTargetable || interaction.isDamageTargetPickable;
    return {
        targetable,
        ringClass: targetable
            ? "ring-2 ring-signal-target animate-pulse cursor-pointer"
            : "",
        onClick: interaction.handleClick,
    };
}
