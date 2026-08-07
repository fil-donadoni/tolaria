import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import { useAttackSequence } from "~/hooks/useAttackSequence";
import { usePendingChoicePrimaryAction } from "~/hooks/usePendingChoicePrimaryAction";
import { usePendingGameIntent } from "~/hooks/usePendingGameIntent";
import { isEditableTarget } from "~/lib/editable-target";
import { eligibleAttackerIds } from "~/lib/attacker-eligibility";
import { isPlaneswalker } from "~/lib/card-utils";
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
    shortcut?: "space" | "enter" | "U" | "S";
    /** A "status pill" action (e.g. waiting on opponent / auto-passing) renders
     *  as informative chrome rather than a primary call-to-action button. */
    pill?: boolean;
};

/** Space-triggered "Attack with all" confirmation (design 2026-07-23). During
 *  DECLARE_ATTACKERS the Space hotkey offers to attack with everything rather
 *  than skipping the attack, so it is gated behind an explicit dialog — Space
 *  is easy to hit by reflex expecting the old "Skip Attack". The pod's own
 *  button stays immediate: a click is already deliberate. */
export type AttackAllConfirm = {
    open: boolean;
    /** How many creatures the confirmation is about to send in. */
    eligibleCount: number;
    confirm: () => void;
    cancel: () => void;
};

export type ControllerState = {
    /** Plain priority cue for the collapsed pod header. */
    cue: ControllerCue;
    /** The action buttons for the current step, in display order. */
    actions: ControllerAction[];
    isAutoPass: boolean;
    isQueuedEndTurn: boolean;
    /** Drives the Space-triggered Attack-with-all confirmation dialog, which
     *  the mounted controller surface (pod or bottom bar) renders. */
    attackAllConfirm: AttackAllConfirm;
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
    const toggleAttacker = useMutation(api.game.toggleAttacker);
    const confirmBlockers = useMutation(api.game.confirmBlockers);
    const confirmDamage = useMutation(api.game.confirmDamage);
    const passPriority = useMutation(api.game.passPriority);
    const autoTap = useMutation(api.game.autoTapForPayment);
    const autoTapForAttackTax = useMutation(api.game.autoTapForAttackTax);
    const cancelAttackTax = useMutation(api.game.cancelAttackTax);
    const endTurn = useMutation(api.game.endTurn);
    const cancelAutoPass = useMutation(api.game.cancelAutoPass);

    // Non-null only when a mid-resolution choice (CR 608.2) is waiting on THIS
    // viewer — Space then mirrors the PendingChoicePrompt's affirmative button
    // instead of passing priority (passPriority is rejected while a choice is
    // pending — `assertNoPendingChoices`).
    const pendingChoiceAction = usePendingChoicePrimaryAction();

    // True while a cast / play / activation this client dispatched is still
    // round-tripping. Gates ONLY the pass-priority / end-turn fall-throughs in
    // the hotkey handler below — see `pending-intent-store.ts`.
    const hasPendingIntent = usePendingGameIntent();

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
    // CR 508.1c/1g — while a declared attack is parked on a mana attack tax
    // (Propaganda / Ghostly Prison), the engine waits for attack-mana-tax input,
    // NOT priority. `isSelectingAttackers` is still true here, so this flag MUST
    // be checked before it everywhere: Space/buttons that fall through to
    // `confirmAttackers` are rejected by `assertExpectedInput` (ADR 0047).
    const isPayingAttackTax =
        !!combat?.pendingAttackManaTax &&
        combat.pendingAttackManaTax.playerId === playerId;
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
    // Scalar, not the array: the keydown effect depends on "has the player
    // declared anything yet", and `selectedAttackerIds` is a fresh array every
    // render, so depending on it would re-bind the listener each time.
    const selectedAttackerCount = selectedAttackerIds.length;
    const blockerCount = Object.keys(combat?.blockerAssignments ?? {}).length;

    // "Attack with all" (design 2026-07-23). The declaring player is always
    // this viewer while `isSelectingAttackers` (they hold priority as the
    // active player); the opponent is the sole other seat. Named for the seat
    // it is read from — it is the VIEWER's player, which merely coincides with
    // `activePlayerId` in this branch.
    const attackSequence = useAttackSequence();
    const viewerPlayer = allPlayers.find((p) => p.id === playerId);
    const opponent = allPlayers.find((p) => p.id !== playerId);
    const eligibleIds = useMemo(
        () =>
            isSelectingAttackers && viewerPlayer && opponent
                ? eligibleAttackerIds(viewerPlayer, opponent, allPlayers)
                : [],
        [isSelectingAttackers, viewerPlayer, opponent, allPlayers]
    );
    const defenderHasPlaneswalker =
        opponent?.battlefield.some((c) => isPlaneswalker(c)) ?? false;
    const [attackAllConfirmOpen, setAttackAllConfirmOpen] = useState(false);

    // Declare every eligible creature vs. the defending player. With no
    // defending planeswalker there is no destination to choose, so confirm
    // immediately; otherwise open the per-attacker destination sequence.
    const handleAttackAll = useCallback(async () => {
        if (isBusy || eligibleIds.length === 0) return;
        setIsBusy(true);
        try {
            // The client eligibility predicate is a SUBSET of the server's
            // `validateAttackerEligibility` (it can't see engine-side
            // restrictions like Arboria / Island Sanctuary / the attacker cap),
            // so an individual toggle may still be rejected. Tolerate each
            // rejection on its own rather than aborting the whole run, and
            // track what actually got declared — the sequence must walk the
            // REAL attackers, never the optimistic client list.
            const declared = [...(combat?.attackerIds ?? [])];
            for (const id of eligibleIds) {
                if (declared.includes(id)) continue;
                try {
                    await toggleAttacker({
                        gameId,
                        playerId,
                        cardInstanceId: id,
                    });
                    declared.push(id);
                } catch {
                    // Server refused this creature (restriction the client
                    // can't see, or the attacker cap). Skip it, keep going.
                }
            }
            if (declared.length === 0) return;
            if (!defenderHasPlaneswalker) {
                await confirmAttackers({ gameId, playerId });
            } else {
                attackSequence.begin(declared);
            }
        } catch {
            // Benign race: priority moved between click and dispatch.
            // Ignore — not actionable.
        } finally {
            setIsBusy(false);
        }
    }, [
        isBusy,
        eligibleIds,
        combat,
        defenderHasPlaneswalker,
        toggleAttacker,
        confirmAttackers,
        attackSequence,
        gameId,
        playerId,
    ]);

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
            // Never hijack keystrokes destined for a text field — Space/Enter/U
            // must type/submit normally when the user is focused in an input,
            // textarea or contenteditable (e.g. renaming a card, chat, forms).
            if (isEditableTarget(e.target)) return;
            if (isBusy) return;
            if (e.key === "u" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                if (isPayingCast) {
                    e.preventDefault();
                    cancelCast({ gameId, playerId });
                } else if (isPayingActivation) {
                    e.preventDefault();
                    cancelActivation({ gameId, playerId });
                } else if (isPayingAttackTax) {
                    e.preventDefault();
                    cancelAttackTax({ gameId, playerId });
                }
                return;
            }
            if (e.code === "Space" && !e.repeat) {
                e.preventDefault();
                if (isPayingCast || isPayingActivation) {
                    // While the PaymentBanner is up, Space mirrors its
                    // "Auto-tap" button instead of passing priority.
                    autoTap({ gameId, playerId });
                } else if (isPayingAttackTax) {
                    // AttackManaTaxBanner is up: Space mirrors its "Auto-tap"
                    // button. Must precede isSelectingAttackers — the engine is
                    // waiting on attack-mana-tax input, so confirmAttackers here
                    // is rejected (ADR 0047).
                    autoTapForAttackTax({ gameId, playerId });
                } else if (pendingChoiceAction) {
                    // A mid-resolution choice is waiting on this viewer: Space
                    // mirrors the prompt's affirmative button. When not yet
                    // legal (mana uncovered / too few picks) it's a no-op —
                    // never falls through to a doomed passPriority.
                    if (pendingChoiceAction.canConfirm) {
                        pendingChoiceAction.confirm();
                    }
                } else if (attackAllConfirmOpen) {
                    // The confirmation dialog owns the keyboard while it is up
                    // — let its own focused button handle Space.
                } else if (isSelectingAttackers && attackSequence.active) {
                    // Destination sequence up: Space keeps the current attacker
                    // on the player and advances, mirroring the "Assign target"
                    // button — never confirms mid-sequence.
                    attackSequence.advance();
                } else if (isSelectingAttackers && selectedAttackerCount > 0) {
                    // At least one attacker already declared: Space means
                    // "Confirm Attackers" — it mirrors the pod's primary
                    // button, which reads the same way. Offering
                    // "Attack with all" here would silently widen a
                    // deliberate, hand-picked attack.
                    confirmAttackers({ gameId, playerId });
                } else if (
                    isSelectingAttackers &&
                    eligibleIds.length > 0 &&
                    !hasPendingIntent
                ) {
                    // Nothing declared yet: Space offers "Attack with all"
                    // rather than skipping the attack — but behind a
                    // confirmation, since it is the same reflex keystroke that
                    // used to mean "Skip Attack".
                    //
                    // Gated on "no intent in flight" because `attackerIds` is
                    // SERVER state: a Space pressed between clicking a creature
                    // and its `toggleAttacker` landing still saw an empty
                    // declaration and offered "Attack with all" — silently
                    // widening a deliberate, hand-picked attack, which is
                    // exactly what the branch above exists to prevent. Dropping
                    // the keystroke keeps the two branches consistent.
                    setAttackAllConfirmOpen(true);
                } else if (isSelectingAttackers && !hasPendingIntent) {
                    // Nothing can attack, so the only thing Space can mean is
                    // skipping the attack step.
                    confirmAttackers({ gameId, playerId });
                } else if (isSelectingBlockers) {
                    confirmBlockers({ gameId, playerId });
                } else if (isAssigningDamage) {
                    // Mirror the Confirm Damage button: only fire once every
                    // attacker's damage has been legally assigned.
                    if (allDamageAssigned) {
                        confirmDamage({ gameId, playerId });
                    }
                } else if (!hasPendingIntent) {
                    // The fall-through — and ONLY the fall-through — is gated on
                    // "no client intent in flight". Clicking a card to cast it
                    // opens the payment banner only after the round-trip; a
                    // Space pressed inside that window still saw no
                    // `pendingCast` and passed priority instead of auto-tapping,
                    // silently burning the turn. Drop the keystroke rather than
                    // reinterpret it (`pending-intent-store.ts`).
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
                } else if (isPayingAttackTax) {
                    // Same rationale as cast/activation: ending the turn while an
                    // attack is parked on its tax is illegal (not priority), so
                    // Enter cancels the tax and drops the declaration cleanly.
                    cancelAttackTax({ gameId, playerId });
                } else if (isAutoPass || isQueuedEndTurn) {
                    handleCancelAutoPass();
                } else if (!hasPendingIntent) {
                    // Same window as Space's fall-through above: Enter meant as
                    // "cancel the payment I just started" must not end the turn
                    // because the banner hasn't rendered yet.
                    handleEndTurn();
                }
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        isBusy,
        hasPendingIntent,
        handlePass,
        handleEndTurn,
        handleCancelAutoPass,
        isAutoPass,
        isQueuedEndTurn,
        isPayingCast,
        isPayingActivation,
        isPayingAttackTax,
        autoTapForAttackTax,
        cancelAttackTax,
        pendingChoiceAction,
        autoTap,
        isSelectingAttackers,
        attackSequence,
        attackAllConfirmOpen,
        eligibleIds,
        selectedAttackerCount,
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

    // Escape cancels a pending cast/activation/attack-tax — same mutation as
    // the U hotkey above. `board.tsx` also binds Escape (bubble phase) to open
    // the pause menu, and its own `POPUP_SELECTORS` guard doesn't recognize
    // the payment banner (a plain draggable panel, not a radix dialog/popover),
    // so without this Escape fell through to the pause menu instead of
    // cancelling the payment. Listening on the CAPTURE phase and calling
    // stopPropagation puts this ahead of that bubble listener — same technique
    // as `reveal-notification-overlay.tsx`. Attached only while a cost is
    // actually pending, so Escape is otherwise untouched (pause menu, card
    // preview, etc. keep working normally).
    useEffect(() => {
        if (!isPayingCast && !isPayingActivation && !isPayingAttackTax) return;
        function onKeyDown(e: KeyboardEvent) {
            if (e.key !== "Escape") return;
            if (isEditableTarget(e.target)) return;
            if (isBusy) return;
            e.preventDefault();
            e.stopPropagation();
            if (isPayingCast) {
                cancelCast({ gameId, playerId });
            } else if (isPayingActivation) {
                cancelActivation({ gameId, playerId });
            } else if (isPayingAttackTax) {
                cancelAttackTax({ gameId, playerId });
            }
        }
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [
        isPayingCast,
        isPayingActivation,
        isPayingAttackTax,
        isBusy,
        cancelCast,
        cancelActivation,
        cancelAttackTax,
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
            disabled: isBusy,
            onClick: runBusy(() => cancelCast({ gameId, playerId })),
        });
    } else if (isPayingActivation) {
        actions.push({
            key: "cancel-activation",
            label: "Cancel Ability",
            tone: "destructive",
            disabled: isBusy,
            onClick: runBusy(() => cancelActivation({ gameId, playerId })),
        });
    } else if (isPayingAttackTax) {
        // The parked attack tax mirrors a cast: the pod shows only Cancel (the
        // Auto-tap affordance lives on AttackManaTaxBanner). Must precede
        // isSelectingAttackers so the pod does not offer a doomed
        // "Confirm Attackers" while the engine waits on tax input.
        actions.push({
            key: "cancel-attack-tax",
            label: "Cancel Attack",
            tone: "destructive",
            disabled: isBusy,
            onClick: runBusy(() => cancelAttackTax({ gameId, playerId })),
        });
    } else if (isSelectingAttackers && attackSequence.active) {
        // "Attack with all" destination sequence (design 2026-07-23): the
        // primary button keeps the current attacker on the defending player and
        // advances to the next; Confirm is intentionally withheld until the
        // sequence completes. A planeswalker click (handled on the board)
        // redirects + advances instead.
        actions.push({
            key: "assign-attack-target-next",
            label: `Assign target (${attackSequence.index + 1}/${attackSequence.order.length})`,
            tone: "primary",
            disabled: isBusy,
            onClick: () => attackSequence.advance(),
        });
        actions.push({
            key: "cancel-attack-sequence",
            label: "Cancel",
            tone: "destructive",
            disabled: isBusy,
            onClick: () => attackSequence.reset(),
        });
        // Pass Turn stays available throughout the sequence (design §6): the
        // server auto-confirms the current declaration on the way out.
        actions.push({
            key: "pass-turn-attackers",
            label: "Pass Turn",
            tone: "destructive",
            disabled: isBusy,
            onClick: handleEndTurn,
        });
    } else if (isSelectingAttackers) {
        actions.push({
            key: "confirm-attackers",
            label:
                selectedAttackerIds.length > 0
                    ? `Confirm Attackers (${selectedAttackerIds.length})`
                    : "Skip Attack",
            tone: "primary",
            disabled: isBusy,
            onClick: runBusy(() => confirmAttackers({ gameId, playerId })),
        });
        if (eligibleIds.length > 0) {
            actions.push({
                key: "attack-with-all",
                label: `Attack with all (${eligibleIds.length})`,
                tone: "primary",
                disabled: isBusy,
                onClick: handleAttackAll,
            });
        }
        actions.push({
            key: "pass-turn-attackers",
            label: "Pass Turn",
            tone: "destructive",
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
            disabled: isBusy,
            onClick: runBusy(() => confirmBlockers({ gameId, playerId })),
        });
        actions.push({
            key: "pass-turn-blockers",
            label: "Pass Turn",
            tone: "destructive",
            disabled: isBusy,
            onClick: handleEndTurn,
        });
    } else if (isAssigningDamage) {
        actions.push({
            key: "confirm-damage",
            label: "Confirm Damage",
            tone: "primary",
            disabled: isBusy || !allDamageAssigned,
            onClick: runBusy(() => confirmDamage({ gameId, playerId })),
        });
    } else if (hasPriority) {
        actions.push({
            key: "pass",
            label: "Pass",
            tone: "primary",
            disabled: isBusy,
            onClick: handlePass,
        });
        actions.push({
            key: "pass-turn",
            label: "Pass Turn",
            tone: "destructive",
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
        isPayingAttackTax ||
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

    // The dialog is only meaningful while attackers are being declared with
    // something able to attack — a phase change or the last eligible creature
    // leaving the board must not strand it open.
    const attackAllConfirm: AttackAllConfirm = {
        open:
            attackAllConfirmOpen &&
            isSelectingAttackers &&
            !attackSequence.active &&
            eligibleIds.length > 0,
        eligibleCount: eligibleIds.length,
        confirm: () => {
            setAttackAllConfirmOpen(false);
            void handleAttackAll();
        },
        cancel: () => setAttackAllConfirmOpen(false),
    };

    return { cue, actions, isAutoPass, isQueuedEndTurn, attackAllConfirm };
}
