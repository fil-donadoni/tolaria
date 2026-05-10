import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import { usePageVisible } from "~/hooks/usePageVisible";
import {
    AUTO_PASS_DELAY_MS,
    shouldAutoPass,
    type PhaseSkipPrefs,
} from "~/lib/skip-phase-prefs";

/** `delayMs` overrides the default debounce (AUTO_PASS_DELAY_MS). Solo mode
 *  passes 0 so the viewer doesn't flash through skipped phases. */
export function useAutoPassPhases(
    prefs: PhaseSkipPrefs,
    delayMs: number = AUTO_PASS_DELAY_MS
): void {
    const ctx = useGameContext();
    const pageVisible = usePageVisible();
    const passPriority = useMutation(api.game.passPriority);
    const inFlight = useRef(false);

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
        undoableBy,
        combat,
        stackCount,
        gameOver,
    } = ctx;

    useEffect(() => {
        const shouldFire = shouldAutoPass(
            {
                playerId,
                activePlayerId,
                priorityPlayerId,
                phase,
                pendingCast,
                pendingActivation,
                pendingTarget,
                combat,
                stackCount,
                autoPassPlayers,
                undoableBy,
                gameOver,
            },
            prefs,
            pageVisible
        );
        if (!shouldFire) return;

        const timer = window.setTimeout(() => {
            if (inFlight.current) return;
            inFlight.current = true;
            passPriority({ gameId, playerId })
                .catch(() => {
                    // idempotent server check may reject; ignore
                })
                .finally(() => {
                    inFlight.current = false;
                });
        }, delayMs);

        return () => {
            window.clearTimeout(timer);
        };
    }, [
        prefs,
        delayMs,
        pageVisible,
        gameId,
        playerId,
        activePlayerId,
        priorityPlayerId,
        phase,
        pendingCast,
        pendingActivation,
        pendingTarget,
        autoPassPlayers,
        undoableBy,
        combat,
        stackCount,
        gameOver,
        passPriority,
    ]);
}
