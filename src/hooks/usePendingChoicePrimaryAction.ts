import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { PendingChoice } from "~/types/game";
import { isManaCostCovered } from "~/lib/card-utils";
import { useGameContext } from "./useGameContext";
import { usePendingChoiceBuffer } from "./usePendingChoiceBuffer";

function countMin(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.min;
}

function countMax(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.max;
}

export type PendingChoicePrimaryAction = {
    /** Whether the affirmative button is currently legal to fire (mana
     *  covered for `may-pay`; buffer within [min, max] for zone picks). */
    canConfirm: boolean;
    /** Commit the primary choice (Pay/Yes for `may-pay`, Done/Skip for zone
     *  picks). No-op while a submission is in flight. */
    confirm: () => void;
    /** True between dispatch and resolution of the primary submission. */
    isPending: boolean;
};

/** Resolves the PRIMARY confirm action of the active pending choice when the
 *  viewer is its chooser — the affirmative button that
 *  {@link PendingChoicePrompt} renders (Pay/Yes for `may-pay`, Done/Skip for
 *  zone picks). Shared by that button and the Space hotkey so both commit
 *  through one code path. Returns `null` when there is no active choice or the
 *  viewer is not the chooser (the Space hotkey then falls through to its
 *  default Pass behaviour). */
export function usePendingChoicePrimaryAction(): PendingChoicePrimaryAction | null {
    const { gameId, playerId, pendingChoices, allPlayers } = useGameContext();
    const bufferCtx = usePendingChoiceBuffer();
    const submitMayPay = useMutation(api.game.submitMayPay);
    const [isBusy, setIsBusy] = useState(false);

    const choice = pendingChoices?.[0];
    const isChooser = !!choice && choice.playerId === playerId;

    const confirm = useCallback(async () => {
        if (!choice || isBusy) return;
        if (choice.kind === "may-pay") {
            setIsBusy(true);
            try {
                await submitMayPay({ gameId, playerId, accept: true });
            } finally {
                setIsBusy(false);
            }
        } else {
            // Zone picks route through the buffer, which owns its own
            // in-flight + error state (see usePendingChoiceBuffer).
            await bufferCtx.submit();
        }
    }, [choice, isBusy, submitMayPay, gameId, playerId, bufferCtx]);

    if (!choice || !isChooser) return null;

    let canConfirm: boolean;
    if (choice.kind === "may-pay") {
        // CR 117.6 — Pay/Yes is legal only once the pool covers the cost.
        const chooser = allPlayers.find((p) => p.id === choice.playerId);
        canConfirm =
            !isBusy &&
            (!choice.cost ||
                (chooser
                    ? isManaCostCovered(chooser.manaPool, choice.cost)
                    : false));
    } else {
        const selected = bufferCtx.buffer.length;
        canConfirm =
            !bufferCtx.isPending &&
            selected >= countMin(choice.count) &&
            selected <= countMax(choice.count);
    }

    return { canConfirm, confirm, isPending: isBusy || bufferCtx.isPending };
}
