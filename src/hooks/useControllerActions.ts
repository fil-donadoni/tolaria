import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoicePrimaryAction } from "~/hooks/usePendingChoicePrimaryAction";
import {
    computeHasPriority,
    isAssigningDamage as isAssigningDamageFn,
    isSelectingAttackers as isSelectingAttackersFn,
    isSelectingBlockers as isSelectingBlockersFn,
    isWaitingOnOpponent,
} from "~/lib/priority";

/** Coarse priority cue for the collapsed pod (#331). One of four mutually
 *  exclusive states the player reads at a glance. */
export type ControllerCue = "mine" | "opponent" | "waiting" | "auto-passing";

export type ControllerActionTone = "primary" | "destructive";

/** A single action button the pod (or any controller surface) renders. The
 *  `onClick`/`disabled`/`shortcut` are the SAME wiring the old ActionBar used,
 *  so each button dispatches the identical mutation it did before. */
export type ControllerAction = {
    key: string;
    label: string;
    tone: ControllerActionTone;
    onClick: () => void;
    disabled: boolean;
    shortcut?: "space" | "enter" | "U";
    /** A "status pill" action (e.g. waiting on opponent / auto-passing) renders
     *  as informative chrome rather than a primary call-to-action button. */
    pill?: boolean;
};

export type ControllerState = {
    /** Plain priority cue for the collapsed pod header. */
    cue: ControllerCue;
    /** The action buttons for the current step, in display order. */
    actions: ControllerAction[];
    isAutoPass: boolean;
    isQueuedEndTurn: boolean;
};

/** Hook holding ALL of the controller's mutations, derived priority state,
 *  click handlers, the keyboard-shortcut effect, and the ordered action
 *  descriptors. Extracted verbatim from the old `ActionBar` so the collapsed
 *  pod (#331) reuses the priority helpers and dispatches the SAME mutations —
 *  view-layer only, no GRE changes. Space = act, Enter = pass turn / cancel
 *  auto-pass, U = cancel cast/activation are preserved exactly. */
export function useControllerActions(): ControllerState {
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
    const autoTap = useMutation(api.game.autoTapForPayment);
    const endTurn = useMutation(api.game.endTurn);
    const cancelAutoPass = useMutation(api.game.cancelAutoPass);

    // Non-null only when a mid-resolution choice (CR 608.2) is waiting on THIS
    // viewer — Space then mirrors the PendingChoicePrompt's affirmative button
    // instead of passing priority (passPriority is rejected while a choice is
    // pending — `assertNoPendingChoices`).
    const pendingChoiceAction = usePendingChoicePrimaryAction();

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
                if (isPayingCast || isPayingActivation) {
                    // While the PaymentBanner is up, Space mirrors its
                    // "Auto-tap" button instead of passing priority.
                    autoTap({ gameId, playerId });
                } else if (pendingChoiceAction) {
                    // A mid-resolution choice is waiting on this viewer: Space
                    // mirrors the prompt's affirmative button. When not yet
                    // legal (mana uncovered / too few picks) it's a no-op —
                    // never falls through to a doomed passPriority.
                    if (pendingChoiceAction.canConfirm) {
                        pendingChoiceAction.confirm();
                    }
                } else if (isSelectingAttackers) {
                    confirmAttackers({ gameId, playerId });
                } else if (isSelectingBlockers) {
                    confirmBlockers({ gameId, playerId });
                } else if (isAssigningDamage) {
                    // Mirror the Confirm Damage button: only fire once every
                    // attacker's damage has been legally assigned.
                    if (allDamageAssigned) {
                        confirmDamage({ gameId, playerId });
                    }
                } else {
                    handlePass();
                }
            }
            if (e.code === "Enter" && !e.repeat) {
                e.preventDefault();
                if (isPayingCast) {
                    // PaymentBanner is up: Enter cancels the payment rather than
                    // ending the turn. Ending mid-payment would otherwise leave
                    // a stale cast the server later abandons — cancel cleanly
                    // here so the banner clears and no turn is accidentally
                    // passed in the same keystroke.
                    cancelCast({ gameId, playerId });
                } else if (isPayingActivation) {
                    cancelActivation({ gameId, playerId });
                } else if (isAutoPass || isQueuedEndTurn) {
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
        pendingChoiceAction,
        autoTap,
        isSelectingAttackers,
        isSelectingBlockers,
        isAssigningDamage,
        allDamageAssigned,
        cancelCast,
        cancelActivation,
        confirmAttackers,
        confirmBlockers,
        confirmDamage,
        gameId,
        playerId,
    ]);

    const actions: ControllerAction[] = [];

    const runBusy = (fn: () => Promise<unknown>) => async () => {
        if (isBusy) return;
        setIsBusy(true);
        try {
            await fn();
        } finally {
            setIsBusy(false);
        }
    };

    if (isPayingCast) {
        actions.push({
            key: "cancel-cast",
            label: "Cancel Cast",
            tone: "destructive",
            shortcut: "U",
            disabled: isBusy,
            onClick: runBusy(() => cancelCast({ gameId, playerId })),
        });
    } else if (isPayingActivation) {
        actions.push({
            key: "cancel-activation",
            label: "Cancel Ability",
            tone: "destructive",
            shortcut: "U",
            disabled: isBusy,
            onClick: runBusy(() => cancelActivation({ gameId, playerId })),
        });
    } else if (isSelectingAttackers) {
        actions.push({
            key: "confirm-attackers",
            label:
                selectedAttackerIds.length > 0
                    ? `Confirm Attackers (${selectedAttackerIds.length})`
                    : "Skip Attack",
            tone: "primary",
            shortcut: "space",
            disabled: isBusy,
            onClick: runBusy(() => confirmAttackers({ gameId, playerId })),
        });
        actions.push({
            key: "pass-turn-attackers",
            label: "Pass Turn",
            tone: "destructive",
            shortcut: "enter",
            disabled: isBusy,
            onClick: handleEndTurn,
        });
    } else if (isSelectingBlockers) {
        actions.push({
            key: "confirm-blockers",
            label:
                blockerCount > 0
                    ? `Confirm Blockers (${blockerCount})`
                    : "No Blockers",
            tone: "primary",
            shortcut: "space",
            disabled: isBusy,
            onClick: runBusy(() => confirmBlockers({ gameId, playerId })),
        });
        actions.push({
            key: "pass-turn-blockers",
            label: "Pass Turn",
            tone: "destructive",
            shortcut: "enter",
            disabled: isBusy,
            onClick: handleEndTurn,
        });
    } else if (isAssigningDamage) {
        actions.push({
            key: "confirm-damage",
            label: "Confirm Damage",
            tone: "primary",
            shortcut: "space",
            disabled: isBusy || !allDamageAssigned,
            onClick: runBusy(() => confirmDamage({ gameId, playerId })),
        });
    } else if (hasPriority) {
        actions.push({
            key: "pass",
            label: "Pass",
            tone: "primary",
            shortcut: "space",
            disabled: isBusy,
            onClick: handlePass,
        });
        actions.push({
            key: "pass-turn",
            label: "Pass Turn",
            tone: "destructive",
            shortcut: "enter",
            disabled: isBusy,
            onClick: handleEndTurn,
        });
    } else if (waitingOnOpponent) {
        actions.push({
            key: "waiting-opponent",
            label: opponentSelectingAttackers
                ? "Opponent declaring attackers..."
                : "Opponent declaring blockers...",
            tone: "primary",
            disabled: true,
            pill: true,
            onClick: () => {},
        });
    } else if (isAutoPass) {
        actions.push({
            key: "auto-pass",
            label: "Auto-passing... (cancel)",
            tone: "destructive",
            shortcut: "enter",
            disabled: isBusy,
            pill: true,
            onClick: handleCancelAutoPass,
        });
    }

    // Queued Pass Turn intent (issue #157): the player pressed Enter without
    // priority. Surfaced independently of the priority-driven branches above
    // so it stays visible while waiting for priority to return. Mutually
    // exclusive with isAutoPass (the engine clears the queue once it fires).
    if (isQueuedEndTurn) {
        actions.push({
            key: "queued-end-turn",
            label: "Pass Turn queued (cancel)",
            tone: "destructive",
            shortcut: "enter",
            disabled: isBusy,
            pill: true,
            onClick: handleCancelAutoPass,
        });
    }

    let cue: ControllerCue;
    if (isAutoPass || isQueuedEndTurn) {
        cue = "auto-passing";
    } else if (
        hasPriority ||
        isPayingCast ||
        isPayingActivation ||
        isSelectingAttackers ||
        isSelectingBlockers ||
        isAssigningDamage ||
        pendingChoiceAction
    ) {
        cue = "mine";
    } else if (waitingOnOpponent) {
        cue = "waiting";
    } else {
        cue = "opponent";
    }

    return { cue, actions, isAutoPass, isQueuedEndTurn };
}
