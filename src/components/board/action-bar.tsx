import { useCallback, useEffect, useMemo, useState } from "react";
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

    const [isBusy, setIsBusy] = useState(false);

    const selectedAttackerIds = combat?.attackerIds ?? [];
    const blockerCount = Object.keys(combat?.blockerAssignments ?? {}).length;

    // Every multi-target source THIS player is responsible for (CR 702.21j-k
    // can split authority between attacker and defender) must have its full
    // power assigned before the player can confirm.
    const allDamageAssigned = useMemo(() => {
        if (!isAssigningDamage || !combat) return false;
        const assigners = combat.damageAssignerIds ?? {};
        for (const [sourceId, assignerId] of Object.entries(assigners)) {
            if (assignerId !== playerId) continue;
            const source = allPlayers
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === sourceId);
            if (!source) continue;
            const power = Math.max(0, source.power ?? 0);
            const total = Object.values(
                combat.damageAssignments?.[sourceId] ?? {}
            ).reduce((s, n) => s + n, 0);
            if (total !== power) return false;
        }
        return true;
    }, [isAssigningDamage, combat, allPlayers, playerId]);

    const handlePass = useCallback(async () => {
        if (isBusy || !hasPriority || isAutoPass) return;
        setIsBusy(true);
        try {
            await passPriority({ gameId, playerId });
        } catch {
            // Benign race: priority may have moved (opponent/AI acted, auto-pass
            // fired) between render and this click, so the server rejects with
            // "You don't have priority". Ignore — it's not an actionable error.
        } finally {
            setIsBusy(false);
        }
    }, [isBusy, hasPriority, isAutoPass, passPriority, gameId, playerId]);

    const handleEndTurn = useCallback(async () => {
        // Pass Turn is also valid while declaring attackers: `endTurn` reads
        // priority as the active player there and `drainAutoPasses` auto-confirms
        // the current attacker selection before fast-forwarding to end of turn.
        if (isBusy || isAutoPass) return;
        if (!hasPriority && !isSelectingAttackers) return;
        setIsBusy(true);
        try {
            await endTurn({ gameId, playerId });
        } catch {
            // Benign race: priority may have moved between render and click;
            // the server rejects with "You don't have priority". Ignore.
        } finally {
            setIsBusy(false);
        }
    }, [
        isBusy,
        hasPriority,
        isSelectingAttackers,
        isAutoPass,
        endTurn,
        gameId,
        playerId,
    ]);

    const handleCancelAutoPass = useCallback(async () => {
        if (isBusy || !isAutoPass) return;
        setIsBusy(true);
        try {
            await cancelAutoPass({ gameId, playerId });
        } finally {
            setIsBusy(false);
        }
    }, [isBusy, isAutoPass, cancelAutoPass, gameId, playerId]);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (isBusy) return;
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
        isBusy,
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
                onClick={async () => {
                    if (isBusy) return;
                    setIsBusy(true);
                    try {
                        await cancelCast({ gameId, playerId });
                    } finally {
                        setIsBusy(false);
                    }
                }}
                label="Cancel Cast"
                tone="destructive"
                shortcut="U"
                disabled={isBusy}
            />
        );
    } else if (isPayingActivation) {
        buttons.push(
            <ActionButton
                key="cancel-activation"
                onClick={async () => {
                    if (isBusy) return;
                    setIsBusy(true);
                    try {
                        await cancelActivation({ gameId, playerId });
                    } finally {
                        setIsBusy(false);
                    }
                }}
                label="Cancel Ability"
                tone="destructive"
                shortcut="U"
                disabled={isBusy}
            />
        );
    } else if (isSelectingAttackers) {
        buttons.push(
            <ActionButton
                key="confirm-attackers"
                onClick={async () => {
                    if (isBusy) return;
                    setIsBusy(true);
                    try {
                        await confirmAttackers({ gameId, playerId });
                    } finally {
                        setIsBusy(false);
                    }
                }}
                label={
                    selectedAttackerIds.length > 0
                        ? `Confirm Attackers (${selectedAttackerIds.length})`
                        : "Skip Attack"
                }
                tone="primary"
                shortcut="space"
                disabled={isBusy}
            />
        );
        buttons.push(
            <ActionButton
                key="pass-turn-attackers"
                onClick={handleEndTurn}
                label="Pass Turn"
                tone="destructive"
                shortcut="enter"
                disabled={isBusy}
            />
        );
    } else if (isSelectingBlockers) {
        buttons.push(
            <ActionButton
                key="confirm-blockers"
                onClick={async () => {
                    if (isBusy) return;
                    setIsBusy(true);
                    try {
                        await confirmBlockers({ gameId, playerId });
                    } finally {
                        setIsBusy(false);
                    }
                }}
                label={
                    blockerCount > 0
                        ? `Confirm Blockers (${blockerCount})`
                        : "No Blockers"
                }
                tone="primary"
                shortcut="space"
                disabled={isBusy}
            />
        );
    } else if (isAssigningDamage) {
        buttons.push(
            <ActionButton
                key="confirm-damage"
                onClick={async () => {
                    if (isBusy) return;
                    setIsBusy(true);
                    try {
                        await confirmDamage({ gameId, playerId });
                    } finally {
                        setIsBusy(false);
                    }
                }}
                label="Confirm Damage"
                tone="primary"
                disabled={isBusy || !allDamageAssigned}
            />
        );
    } else if (hasPriority) {
        buttons.push(
            <ActionButton
                key="pass"
                onClick={handlePass}
                label="Pass"
                tone="primary"
                disabled={isBusy}
            />
        );
        buttons.push(
            <ActionButton
                key="pass-turn"
                onClick={handleEndTurn}
                label="Pass Turn"
                tone="destructive"
                disabled={isBusy}
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
                disabled={isBusy}
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
