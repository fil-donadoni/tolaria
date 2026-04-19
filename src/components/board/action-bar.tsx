import { useCallback, useEffect, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import ActionButton from "./action-button";

export default function ActionBar() {
    const {
        gameId,
        playerId,
        activePlayerId,
        priorityPlayerId,
        phase,
        pendingCast,
        pendingTarget,
        autoPassPlayers,
        undoableBy,
        combat,
        allPlayers,
    } = useGameContext();

    const undoManaAbility = useMutation(api.game.undoManaAbility);
    const cancelCast = useMutation(api.game.cancelCast);
    const confirmAttackers = useMutation(api.game.confirmAttackers);
    const confirmBlockers = useMutation(api.game.confirmBlockers);
    const confirmDamage = useMutation(api.game.confirmDamage);
    const passPriority = useMutation(api.game.passPriority);
    const endTurn = useMutation(api.game.endTurn);

    const canUndo = undoableBy === playerId;
    const isPayingCast = !!pendingCast && pendingCast.playerId === playerId;
    const isSelectingAttackers =
        phase === "DECLARE_ATTACKERS" &&
        !!combat &&
        !combat.confirmed &&
        playerId === activePlayerId;
    const isSelectingBlockers =
        phase === "DECLARE_BLOCKERS" &&
        !!combat &&
        !combat.blockersConfirmed &&
        playerId !== activePlayerId;
    const isAssigningDamage =
        phase === "COMBAT_DAMAGE" &&
        !!combat &&
        combat.damageConfirmed === false &&
        playerId === activePlayerId;
    const hasPriority =
        playerId === priorityPlayerId &&
        !pendingCast &&
        !pendingTarget &&
        !isSelectingAttackers &&
        !isSelectingBlockers &&
        !isAssigningDamage;
    const isAutoPass = autoPassPlayers?.includes(playerId) ?? false;

    const selectedAttackerIds = combat?.attackerIds ?? [];
    const blockerCount = Object.keys(combat?.blockerAssignments ?? {}).length;

    const blockersPerAttacker = useMemo(() => {
        const map: Record<string, string[]> = {};
        if (!combat) return map;
        for (const [blockerId, attackerId] of Object.entries(
            combat.blockerAssignments
        )) {
            if (!map[attackerId]) map[attackerId] = [];
            map[attackerId].push(blockerId);
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

    const handleUndo = useCallback(() => {
        if (canUndo) undoManaAbility({ gameId, playerId });
    }, [canUndo, undoManaAbility, gameId, playerId]);

    const handlePass = useCallback(() => {
        if (hasPriority && !isAutoPass) passPriority({ gameId, playerId });
    }, [hasPriority, isAutoPass, passPriority, gameId, playerId]);

    const handleEndTurn = useCallback(() => {
        if (hasPriority && !isAutoPass) endTurn({ gameId, playerId });
    }, [hasPriority, isAutoPass, endTurn, gameId, playerId]);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === "z") {
                e.preventDefault();
                handleUndo();
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
                handleEndTurn();
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        handleUndo,
        handlePass,
        handleEndTurn,
        isSelectingAttackers,
        isSelectingBlockers,
        confirmAttackers,
        confirmBlockers,
        gameId,
        playerId,
    ]);

    const buttons: React.ReactNode[] = [];

    if (canUndo) {
        buttons.push(
            <ActionButton
                key="undo"
                onClick={handleUndo}
                label="Undo"
                color="yellow"
                shortcut="Ctrl+Z"
            />
        );
    }

    if (isPayingCast) {
        buttons.push(
            <ActionButton
                key="cancel-cast"
                onClick={() => cancelCast({ gameId, playerId })}
                label="Cancel Cast"
                color="red"
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
                color="red"
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
                color="blue"
                shortcut="space"
            />
        );
    } else if (isAssigningDamage) {
        buttons.push(
            <ActionButton
                key="confirm-damage"
                onClick={() => confirmDamage({ gameId, playerId })}
                label="Confirm Damage"
                color="red"
                disabled={!allDamageAssigned}
            />
        );
    } else if (hasPriority) {
        buttons.push(
            <ActionButton
                key="pass"
                onClick={handlePass}
                label="Pass"
                color="amber"
                shortcut="space"
            />
        );
        buttons.push(
            <ActionButton
                key="pass-turn"
                onClick={handleEndTurn}
                label="Pass Turn"
                color="red"
                shortcut="enter"
            />
        );
    } else if (isAutoPass) {
        buttons.push(
            <div
                key="auto-pass"
                className="bg-black/60 text-white/60 px-6 py-2 rounded-lg text-sm"
            >
                Auto-passing...
            </div>
        );
    }

    if (!buttons.length) return null;

    return (
        <div className="fixed bottom-4 right-4 z-40 flex gap-2">{buttons}</div>
    );
}
