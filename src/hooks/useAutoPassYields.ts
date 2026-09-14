import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import { usePageVisible } from "~/hooks/usePageVisible";
import { useYieldPrefsStore } from "~/hooks/useYieldPreferences";
import { shouldAutoPassYield } from "~/lib/yields";

/** The **Yield** auto-pass loop (issue #3556 §3) — the sibling of
 *  {@link useAutoPassPhases}, and deliberately a second hook rather than a
 *  branch inside it: the two answer opposite questions about the **Stack**
 *  (a **Phase Stop** never passes past a non-empty one; a **Yield** is only
 *  ever that case). Everything they must agree on is shared underneath, in
 *  `computeAutoPassBlockedCore`.
 *
 *  Passes with no debounce: a yielded ability is one the seat has already
 *  said it will never respond to, so a delay only adds a visible stutter to
 *  the repeating-trigger loop this exists to remove. */
export function useAutoPassYields(): void {
    const ctx = useGameContext();
    const pageVisible = usePageVisible();
    const { yields } = useYieldPrefsStore();
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
        pendingChoices,
        autoPassPlayers,
        combat,
        meleeCombat,
        pendingExtraCleanupStep,
        stackItems,
        gameOver,
    } = ctx;

    useEffect(() => {
        const shouldFire = shouldAutoPassYield(
            {
                playerId,
                activePlayerId,
                priorityPlayerId,
                phase,
                pendingCast,
                pendingActivation,
                pendingTarget,
                pendingChoices,
                combat,
                meleeCombat,
                pendingExtraCleanupStep,
                stackItems,
                autoPassPlayers,
                gameOver,
            },
            yields,
            pageVisible
        );
        if (!shouldFire) return;
        if (inFlight.current) return;
        inFlight.current = true;
        passPriority({ gameId, playerId })
            .catch(() => {
                // The server re-validates (ADR 0074); an idempotent reject
                // (priority already moved) is expected and ignored.
            })
            .finally(() => {
                inFlight.current = false;
            });
    }, [
        yields,
        pageVisible,
        gameId,
        playerId,
        activePlayerId,
        priorityPlayerId,
        phase,
        pendingCast,
        pendingActivation,
        pendingTarget,
        pendingChoices,
        autoPassPlayers,
        combat,
        meleeCombat,
        pendingExtraCleanupStep,
        stackItems,
        gameOver,
        passPriority,
    ]);
}
