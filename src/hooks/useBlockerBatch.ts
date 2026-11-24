import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useAttackSequence } from "~/hooks/useAttackSequence";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import {
    hasPendingGameIntent,
    trackGameIntent,
} from "~/lib/pending-intent-store";

export type BlockerBatch = {
    /** Send every awaiting blocker at `attackerId`, one `selectBlocker` +
     *  `assignBlockerTarget` pair each, chained. A blocker the server refuses
     *  stays awaiting with a visible error; the accepted ones keep their
     *  assignment. */
    assign: (attackerId: string) => void;
};

/** The one place a multiple block is dispatched (CR 509.1a: blockers are
 *  declared together; CR 509.1b: each assignment is validated on its own).
 *
 *  Client-only, like the attacker side (`useAttackTargetChooser`): the awaiting
 *  set lives in `useAttackSequence`, no `GameState` field, and the batch reuses
 *  the existing per-blocker mutations so `assertCanBlock` and
 *  `applyBlockerAssignment` still validate each one. Block declaration is
 *  unconfirmed while the batch runs, so the opponent never acts on the
 *  intermediate state. */
export function useBlockerBatch(): BlockerBatch {
    const { gameId, playerId } = useGameContext();
    const selectBlocker = useMutation(api.game.selectBlocker);
    const assignBlockerTarget = useMutation(api.game.assignBlockerTarget);
    const bufferCtx = usePendingChoiceBuffer();
    const sequence = useAttackSequence();

    async function declareOne(blockerId: string, attackerId: string) {
        // `selectBlocker` TOGGLES a pending blocker, so a select that landed
        // before a refused assignment must be undone — else the next attempt
        // at the same creature would deselect it instead.
        await selectBlocker({ gameId, playerId, cardInstanceId: blockerId });
        try {
            await assignBlockerTarget({ gameId, playerId, attackerId });
        } catch (err) {
            await selectBlocker({
                gameId,
                playerId,
                cardInstanceId: blockerId,
            }).catch(() => undefined);
            throw err;
        }
    }

    async function runBatch(ids: string[], attackerId: string) {
        // Sequential on purpose: `pendingBlockerId` is a single server slot, so
        // each select→assign pair must finish before the next starts.
        for (const id of ids) {
            try {
                await declareOne(id, attackerId);
                sequence.resolveAwaitingBlockers([id]);
            } catch (err) {
                bufferCtx.reportError(err);
            }
        }
    }

    function assign(attackerId: string) {
        // A second click inside the first batch's round trip still sees the old
        // combat and the full awaiting set: it would send the batch twice.
        if (hasPendingGameIntent()) return;
        const ids = [...sequence.awaitingBlockers];
        if (ids.length === 0) return;
        void trackGameIntent(runBatch(ids, attackerId));
    }

    return { assign };
}
