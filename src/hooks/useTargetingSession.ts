import { useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useAttackSequence } from "~/hooks/useAttackSequence";
import { useGameContext } from "~/hooks/useGameContext";
import {
    attackTargetingSession,
    pendingTargetingSession,
    type TargetingSession,
} from "~/lib/targeting-session";

export type ActiveTargeting = TargetingSession & {
    /** Back out of the choice: the attack target resets the awaiting
     *  creatures (CR 508.1b); a spell / ability target is the banner's own
     *  Cancel (`api.game.cancelTarget`). */
    cancel: () => void;
};

/** The viewer's open target choice (issue #9163), or `null`. The attack
 *  target wins when both could read as open: the declaring player has no
 *  pending spell target mid-declaration. */
export function useTargetingSession(): ActiveTargeting | null {
    const {
        gameId,
        playerId,
        activePlayerId,
        phase,
        combat,
        allPlayers,
        pendingTarget,
        stackItems,
        emblems,
        engineTurn,
        controlChangedThisTurn,
        playerProtectionFromEverything,
    } = useGameContext();
    const sequence = useAttackSequence();
    const cancelTarget = useMutation(api.game.cancelTarget);

    const choosingAttackerIds =
        sequence.active && sequence.currentAttackerId
            ? [sequence.currentAttackerId]
            : sequence.awaiting;
    const attackKey = choosingAttackerIds.join(",");

    const session = useMemo(
        () =>
            attackTargetingSession({
                phase,
                combat,
                viewerId: playerId,
                activePlayerId,
                allPlayers,
                choosingAttackerIds: attackKey ? attackKey.split(",") : [],
            }) ??
            pendingTargetingSession(pendingTarget, {
                viewerId: playerId,
                activePlayerId,
                allPlayers,
                stackItems,
                controlContinuity:
                    typeof engineTurn === "number"
                        ? { turn: engineTurn, controlChangedThisTurn }
                        : undefined,
                emblems,
                combat,
                playerProtectionFromEverything,
            }),
        [
            phase,
            combat,
            playerId,
            activePlayerId,
            allPlayers,
            attackKey,
            pendingTarget,
            stackItems,
            engineTurn,
            controlChangedThisTurn,
            emblems,
            playerProtectionFromEverything,
        ]
    );

    const resetSequence = sequence.reset;
    return useMemo(() => {
        if (!session) return null;
        const cancel =
            session.mode === "attack"
                ? resetSequence
                : // A repeat Escape inside the round trip finds no selection
                  // left; the first one already cancelled it.
                  () => void cancelTarget({ gameId, playerId }).catch(() => {});
        return { ...session, cancel };
    }, [session, resetSequence, cancelTarget, gameId, playerId]);
}
