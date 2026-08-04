import type { CardInstance } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { useGameContext } from "~/hooks/useGameContext";
import {
    matchesTargetRequirement,
    matchesPermanentTargetFilters,
    matchesPlayerTargetFilters,
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
 *  issue #1697) and player legality (`wantsPlayerTarget` +
 *  `matchesPlayerTargetFilters`, the same registry for the player kind, issue
 *  #1734, + the shroud / protection-from-everything gate) — so the dialog and
 *  the board agree on the target set. Returns `[]` outside a divide
 *  selection. */
export function useDivideTargets(): DivideTargetItem[] {
    const {
        allPlayers,
        activePlayerId,
        playerId,
        pendingTarget,
        playerProtectionFromEverything,
        emblems,
        engineTurn,
        controlChangedThisTurn,
    } = useGameContext();
    // CR 302.6 / 400.7 (issue #1824) — the continuity facts a
    // `controlledSinceTurnStart` target filter is evaluated against. Must be
    // `engineTurn` (the wire `GameState.turn`), never the context's display
    // `turn`, since `enteredOnTurn` is stamped from the global turn number.
    // Undefined when the engine turn is unknown → the filter fails CLOSED.
    const controlContinuity =
        typeof engineTurn === "number"
            ? { turn: engineTurn, controlChangedThisTurn }
            : undefined;

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
                    controlContinuity,
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
    // `isTargetable`: EVERY player-kind filter dimension through the shared
    // registry (`matchesPlayerTargetFilters`, issue #1734 — it carries the
    // CR 601.2c already-chosen exclusion, the CR 109.3/115 `controller`
    // relationship and the CR 506.2 attacked-this-turn gate), plus the
    // CR 702.18 shroud / CR 702.16b protection-from-everything gate. The
    // per-dimension clauses that used to live inline here reproduced only the
    // exclusion and the attacked gate and simply did not have `controller`,
    // so the dialog and the board disagreed on a "target opponent" divide.
    if (wantsPlayerTarget(pendingTarget.targetType)) {
        for (const p of allPlayers) {
            if (
                matchesPlayerTargetFilters(p, pendingTarget, activePlayerId) &&
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
