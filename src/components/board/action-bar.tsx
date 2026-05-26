import { useCallback, useEffect, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import {
    computeHasPriority,
    isAssigningDamage as isAssigningDamageFn,
    isSelectingAttackers as isSelectingAttackersFn,
    isSelectingBlockers as isSelectingBlockersFn,
    isWaitingOnOpponent,
} from "~/lib/priority";
import ActionButton from "./action-button";
import HotkeysLegend from "./hotkeys-legend";
import PauseMenuButton from "./pause-menu-button";

export default function ActionBar({ onOpenMenu }: { onOpenMenu: () => void }) {
    const {
        gameId,
        playerId,
        activePlayerId,
        priorityPlayerId,
        phase,
        pendingCast,
        pendingActivation,
        pendingTarget,
        autoPassPlayers,
        combat,
        allPlayers,
    } = useGameContext();

    const cancelCast = useMutation(api.game.cancelCast);
    const cancelActivation = useMutation(api.game.cancelActivation);
    const confirmAttackers = useMutation(api.game.confirmAttackers);
    const confirmBlockers = useMutation(api.game.confirmBlockers);
    const confirmDamage = useMutation(api.game.confirmDamage);
    const passPriority = useMutation(api.game.passPriority);
    const endTurn = useMutation(api.game.endTurn);
    const cancelAutoPass = useMutation(api.game.cancelAutoPass);

    const priorityCtx = {
        playerId,
        activePlayerId,
        priorityPlayerId,
        phase,
        pendingCast,
        pendingActivation,
        pendingTarget,
        combat,
    };

    const isPayingCast = !!pendingCast && pendingCast.playerId === playerId;
    const isPayingActivation =
        !!pendingActivation && pendingActivation.playerId === playerId;
    const isSelectingAttackers = isSelectingAttackersFn(priorityCtx);
    const isSelectingBlockers = isSelectingBlockersFn(priorityCtx);
    const isAssigningDamage = isAssigningDamageFn(priorityCtx);
    const waitingOnOpponent = isWaitingOnOpponent(priorityCtx);
    const opponentSelectingAttackers =
        waitingOnOpponent && phase === "DECLARE_ATTACKERS";
    const hasPriority = computeHasPriority(priorityCtx);
    const isAutoPass = autoPassPlayers?.includes(playerId) ?? false;

    const selectedAttackerIds = combat?.attackerIds ?? [];
    const blockerCount = Object.keys(combat?.blockerAssignments ?? {}).length;

    const blockersPerAttacker = useMemo(() => {
        const map: Record<string, string[]> = {};
        if (!combat) return map;
        for (const [blockerId, attackerIds] of Object.entries(
            combat.blockerAssignments
        )) {
            for (const attackerId of attackerIds) {
                if (!map[attackerId]) map[attackerId] = [];
                map[attackerId].push(blockerId);
            }
        }
        return map;
    }, [combat]);

    const allDamageAssigned = useMemo(() => {
        if (!isAssigningDamage || !combat) return false;
        const attackingPlayer = allPlayers.find((p) => p.id === activePlayerId);
        if (!attackingPlayer) return false;
        for (const attackerId of combat.attackerIds) {
            if ((blockersPerAttacker[attackerId]?.length ?? 0) < 2) continue;
            const attacker = attackingPlayer.battlefield.find(
                (c) => c.id === attackerId
            );
            if (!attacker) continue;
            const power = Math.max(0, attacker.power ?? 0);
            const total = Object.values(
                combat.damageAssignments?.[attackerId] ?? {}
            ).reduce((s, n) => s + n, 0);
            if (total !== power) return false;
        }
        return true;
    }, [
        isAssigningDamage,
        combat,
        blockersPerAttacker,
        allPlayers,
        activePlayerId,
    ]);

    const handlePass = useCallback(() => {
        if (hasPriority && !isAutoPass) passPriority({ gameId, playerId });
    }, [hasPriority, isAutoPass, passPriority, gameId, playerId]);

    const handleEndTurn = useCallback(() => {
        if (hasPriority && !isAutoPass) endTurn({ gameId, playerId });
    }, [hasPriority, isAutoPass, endTurn, gameId, playerId]);

    const handleCancelAutoPass = useCallback(() => {
        if (isAutoPass) cancelAutoPass({ gameId, playerId });
    }, [isAutoPass, cancelAutoPass, gameId, playerId]);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "u" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                if (isPayingCast) {
                    e.preventDefault();
                    cancelCast({ gameId, playerId });
                } else if (isPayingActivation) {
                    e.preventDefault();
                    cancelActivation({ gameId, playerId });
                }
                return;
            }
            if (e.code === "Space" && !e.repeat) {
                e.preventDefault();
                if (isSelectingAttackers) {
                    confirmAttackers({ gameId, playerId });
                } else if (isSelectingBlockers) {
                    confirmBlockers({ gameId, playerId });
                } else {
                    handlePass();
                }
            }
            if (e.code === "Enter" && !e.repeat) {
                e.preventDefault();
                if (isAutoPass) {
                    handleCancelAutoPass();
                } else {
                    handleEndTurn();
                }
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        handlePass,
        handleEndTurn,
        handleCancelAutoPass,
        isAutoPass,
        isPayingCast,
        isPayingActivation,
        isSelectingAttackers,
        isSelectingBlockers,
        cancelCast,
        cancelActivation,
        confirmAttackers,
        confirmBlockers,
        gameId,
        playerId,
    ]);

    const buttons: React.ReactNode[] = [];

    if (isPayingCast) {
        buttons.push(
            <ActionButton
                key="cancel-cast"
                onClick={() => cancelCast({ gameId, playerId })}
                label="Cancel Cast"
                tone="destructive"
                shortcut="U"
            />
        );
    } else if (isPayingActivation) {
        buttons.push(
            <ActionButton
                key="cancel-activation"
                onClick={() => cancelActivation({ gameId, playerId })}
                label="Cancel Ability"
                tone="destructive"
                shortcut="U"
            />
        );
    } else if (isSelectingAttackers) {
        buttons.push(
            <ActionButton
                key="confirm-attackers"
                onClick={() => confirmAttackers({ gameId, playerId })}
                label={
                    selectedAttackerIds.length > 0
                        ? `Confirm Attackers (${selectedAttackerIds.length})`
                        : "Skip Attack"
                }
                tone="primary"
                shortcut="space"
            />
        );
    } else if (isSelectingBlockers) {
        buttons.push(
            <ActionButton
                key="confirm-blockers"
                onClick={() => confirmBlockers({ gameId, playerId })}
                label={
                    blockerCount > 0
                        ? `Confirm Blockers (${blockerCount})`
                        : "No Blockers"
                }
                tone="primary"
                shortcut="space"
            />
        );
    } else if (isAssigningDamage) {
        buttons.push(
            <ActionButton
                key="confirm-damage"
                onClick={() => confirmDamage({ gameId, playerId })}
                label="Confirm Damage"
                tone="primary"
                disabled={!allDamageAssigned}
            />
        );
    } else if (hasPriority) {
        buttons.push(
            <ActionButton
                key="pass"
                onClick={handlePass}
                label="Pass"
                tone="primary"
                shortcut="space"
            />
        );
        buttons.push(
            <ActionButton
                key="pass-turn"
                onClick={handleEndTurn}
                label="Pass Turn"
                tone="destructive"
                shortcut="enter"
            />
        );
    } else if (waitingOnOpponent) {
        buttons.push(
            <div
                key="waiting-opponent"
                className="relative bg-[#0c0d12]/90 border border-zinc-800/80 backdrop-blur-md rounded-sm px-5 py-2 text-zinc-500 text-sm font-beleren tracking-wide shadow-md"
            >
                {opponentSelectingAttackers
                    ? "Opponent declaring attackers..."
                    : "Opponent declaring blockers..."}
            </div>
        );
    } else if (isAutoPass) {
        buttons.push(
            <button
                key="auto-pass"
                onClick={handleCancelAutoPass}
                className="bg-zinc-800/40 hover:bg-zinc-700/40 border border-zinc-600/45 text-zinc-300 px-5 py-2 rounded-sm text-sm font-beleren tracking-wide transition-colors shadow-md cursor-pointer"
            >
                Auto-passing... (cancel)
                <span className="ml-2 text-xs opacity-70 hidden md:inline">
                    [enter]
                </span>
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-40 flex gap-2 items-center">
            {buttons}
            <HotkeysLegend />
            <PauseMenuButton onOpen={onOpenMenu} />
        </div>
    );
}
