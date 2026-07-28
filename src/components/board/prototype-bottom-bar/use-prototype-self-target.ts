import type { Player } from "~/types/game";
import { usePlayerInteraction } from "~/hooks/usePlayerInteraction";

/** PROTOTYPE — throwaway (bottom-bar redesign audit 2026-07-28).
 *
 *  The portrait audit's one hard blocker: the viewer's own nameplate is buried
 *  under the bottom bar, so "target yourself" (Ancestral Recall on you) is
 *  impossible. Every variant therefore renders the own-life pill as a REAL
 *  player-target surface: this thin wrapper exposes the shared
 *  {@link usePlayerInteraction} controller (same `selectTarget` mutation the
 *  nameplate dispatches) plus the ring class the pill should wear while the
 *  player is a legal target. Divide-as-you-choose steppers are out of prototype
 *  scope. */
export function usePrototypeSelfTarget(me: Player) {
    const interaction = usePlayerInteraction(me);
    const targetable =
        interaction.isTargetable || interaction.isDamageTargetPickable;
    return {
        onClick: interaction.handleClick,
        targetable,
        ringClass: targetable
            ? "ring-2 ring-signal-target animate-pulse cursor-pointer"
            : "",
    };
}
