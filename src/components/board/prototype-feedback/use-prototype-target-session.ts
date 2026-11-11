// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-target-arrow=A|B|C`).
// ONE notion of "the viewer is choosing a target", fed by both real flows:
// the attack target (CR 508.1b, `useAttackSequence`) and a spell / ability
// target (CR 601.2c / 602.2b, `pendingTarget`).
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { getDefinition } from "@convex/cards";
import { useAttackSequence } from "~/hooks/useAttackSequence";
import { useGameContext } from "~/hooks/useGameContext";
import { displayCardId, isPlaneswalker } from "~/lib/card-utils";
import type { PrototypeTargetSessionShape } from "./prototype-target-geometry";

export type PrototypeTargetSession = PrototypeTargetSessionShape & {
    cancel: () => void;
    nameOf: (kind: "permanent" | "player", id: string) => string;
};

export function usePrototypeTargetSession(): PrototypeTargetSession | null {
    const ctx = useGameContext();
    const sequence = useAttackSequence();
    const cancelTarget = useMutation(api.game.cancelTarget);
    const { playerId, activePlayerId, allPlayers, pendingTarget, gameId } = ctx;

    const nameOf = (kind: "permanent" | "player", id: string) => {
        if (kind === "player") {
            if (id === playerId) return "yourself";
            return allPlayers.find((p) => p.id === id)?.name ?? "opponent";
        }
        for (const p of allPlayers) {
            const card = [...p.battlefield, ...p.hand].find(
                (c) => c?.id === id
            );
            if (!card) continue;
            try {
                return getDefinition(displayCardId(card)).name;
            } catch {
                return "permanent";
            }
        }
        return "permanent";
    };

    const attackers =
        sequence.active && sequence.currentAttackerId
            ? [sequence.currentAttackerId]
            : sequence.awaiting;
    if (
        ctx.phase === "DECLARE_ATTACKERS" &&
        playerId === activePlayerId &&
        attackers.length > 0
    ) {
        return {
            kind: "attack",
            verb: "Attack",
            sourceIds: attackers,
            permanentTargetIds: allPlayers
                .filter((p) => p.id !== activePlayerId)
                .flatMap((p) => p.battlefield.filter(isPlaneswalker))
                .map((c) => c.id),
            cancel: () => sequence.reset(),
            nameOf,
        };
    }
    if (pendingTarget && pendingTarget.playerId === playerId) {
        return {
            kind: "spell",
            verb: "Target",
            sourceIds: [pendingTarget.cardInstanceId],
            permanentTargetIds: [],
            // Same call as the real banner's Cancel button.
            cancel: () => void cancelTarget({ gameId, playerId }),
            nameOf,
        };
    }
    return null;
}
