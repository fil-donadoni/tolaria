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
        queuedEndTurn,
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
    // A "Pass Turn" intent registered while this player lacked priority; it
    // fires the moment they next gain priority (issue #157).
    const isQueuedEndTurn = queuedEndTurn?.includes(playerId) ?? false;

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
        // `endTurn` accepts the call with or without priority: with priority it
        // auto-passes the rest of the turn; without it (issue #157) the server
        // records a queued intent that fires the moment priority next lands on
        // this player. Pass Turn is also valid while declaring attackers, where
        // `drainAutoPasses` auto-confirms the current selection first.
        if (isBusy || isAutoPass || isQueuedEndTurn) return;
        setIsBusy(true);
        try {
            await endTurn({ gameId, playerId });
        } catch {
            // Benign race: priority may have moved between render and click.
            // Ignore — not an actionable error.
        } finally {
            setIsBusy(false);
        }
    }, [isBusy, isAutoPass, isQueuedEndTurn, endTurn, gameId, playerId]);

    const handleCancelAutoPass = useCallback(async () => {
        // Cancels either an active auto-pass or a not-yet-fired queued Pass Turn
        // intent — `cancelAutoPass` clears both flags for the player.
        if (isBusy || (!isAutoPass && !isQueuedEndTurn)) return;
        setIsBusy(true);
        try {
            await cancelAutoPass({ gameId, playerId });
        } finally {
            setIsBusy(false);
        }
    }, [isBusy, isAutoPass, isQueuedEndTurn, cancelAutoPass, gameId, playerId]);

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
                if (isAutoPass || isQueuedEndTurn) {
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
        isQueuedEndTurn,
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

    // Queued Pass Turn intent (issue #157): the player pressed Enter without
    // priority. Surfaced independently of the priority-driven branches above
    // so it stays visible while waiting for priority to return. Mutually
    // exclusive with isAutoPass (the engine clears the queue once it fires).
    if (isQueuedEndTurn) {
        buttons.push(
            <button
                key="queued-end-turn"
                onClick={handleCancelAutoPass}
                disabled={isBusy}
                className="bg-zinc-800/40 hover:bg-zinc-700/40 border border-zinc-600/45 text-zinc-300 px-5 py-2 rounded-sm text-sm font-beleren tracking-wide transition-colors shadow-md cursor-pointer"
            >
                Pass Turn queued (cancel)
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
