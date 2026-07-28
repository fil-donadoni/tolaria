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
 *  Click-to-target and the choose-damage-target buffer route are both fully
 *  reachable through this tab now (#1766). Still narrow by design: the
 *  divide-as-you-choose stepper (Fire Covenant / Meteor Shower splitting
 *  damage onto the viewer's own life) has no bar-tab affordance — the
 *  desktop nameplate stepper (`isDivideTarget`/`incDivide`/`decDivide` on
 *  {@link usePlayerInteraction}) isn't surfaced here yet. Verifying that gap
 *  (and the rest of the target surface) end to end through the real game
 *  loop is folded into #1770's mobile QA sweep. */
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
