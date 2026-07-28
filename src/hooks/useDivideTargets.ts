import type { CardInstance } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { useGameContext } from "~/hooks/useGameContext";
import {
    matchesTargetRequirement,
    matchesPermanentTargetFilters,
    wantsPlayerTarget,
} from "~/lib/card-utils";
import { isPlayerUntargetableByPending } from "~/lib/targeting";

/** One legal target of an active divide-as-you-choose spell (CR 601.2d). The
 *  divide dialog renders these inline (a mini-card / player chip + its own
 *  `[−] N [+]` stepper) so the steppers no longer overlay the board and get
 *  occluded by neighbouring creatures. */
export type DivideTargetItem =
    | {
          type: "permanent";
          id: string;
          name: string;
          card: CardInstance;
          /** Controlled by the viewer (my side of the split) vs the opponent's. */
          mine: boolean;
      }
    | { type: "player"; id: string; name: string; life: number; mine: boolean };

/** Enumerate the legal divide targets for the viewer, when the viewer is the
 *  one assigning an active divide split (`pendingTarget.divideTotal` set and
 *  addressed to this seat). Reuses the SAME per-target legality predicates the
 *  board's candidate ring uses — permanent legality (`matchesTargetRequirement`
 *  + `matchesPermanentTargetFilters`, the shared target-filter registry,
 *  issue #1697) and player legality (`wantsPlayerTarget` + attacked-this-turn
 *  + shroud gate) — so the dialog and the board agree on the target set.
 *  Returns `[]` outside a divide selection. */
export function useDivideTargets(): DivideTargetItem[] {
    const {
        allPlayers,
        activePlayerId,
        playerId,
        pendingTarget,
        playerProtectionFromEverything,
        emblems,
    } = useGameContext();

    if (
        !pendingTarget ||
        pendingTarget.divideTotal === undefined ||
        pendingTarget.playerId !== playerId
    ) {
        return [];
    }

    const items: DivideTargetItem[] = [];

    // Permanent targets — mirror `useBattlefieldVisualState`'s `divideTarget`
    // predicate (matchesTargetRequirement + matchesPermanentTargetFilters,
    // issue #1697).
    for (const p of allPlayers) {
        for (const card of p.battlefield) {
            if (
                matchesTargetRequirement(card, pendingTarget.targetType) &&
                matchesPermanentTargetFilters(
                    card,
                    pendingTarget,
                    allPlayers,
                    activePlayerId,
                    emblems
                )
            ) {
                items.push({
                    type: "permanent",
                    id: card.id,
                    name: getDefinition(card.card.id).name,
                    card,
                    mine: card.controllerId === playerId,
                });
            }
        }
    }

    // Player targets ("any" / "player") — mirror `usePlayerInteraction`'s
    // `isTargetable` (CR 506.2 attacked-this-turn gate + CR 702.18 shroud /
    // CR 702.16b protection-from-everything gate).
    if (wantsPlayerTarget(pendingTarget.targetType)) {
        for (const p of allPlayers) {
            if (
                (!pendingTarget.playerAttackedThisTurn ||
                    p.battlefield.some((c) => c.hasAttackedThisTurn)) &&
                !isPlayerUntargetableByPending(
                    allPlayers,
                    p.id,
                    playerProtectionFromEverything
                )
            ) {
                items.push({
                    type: "player",
                    id: p.id,
                    name: p.name,
                    life: p.life,
                    mine: p.id === playerId,
                });
            }
        }
    }

    return items;
}
