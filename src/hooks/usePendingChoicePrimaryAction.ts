import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { mayPayCanAfford, mayPaySacrificeCount } from "~/lib/card-utils";
import { isZonePickConfirmEnabled } from "~/lib/pending-choice-confirm";
import { useGameContext } from "./useGameContext";
import { usePendingChoiceBuffer } from "./usePendingChoiceBuffer";

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
        // CR 117.6 / 702.24 — Pay/Yes is legal only once every leg of the cost
        // union (mana / life / sacrifice) can be paid.
        const chooser = allPlayers.find((p) => p.id === choice.playerId);
        // ADR 0042 — a cumulative-upkeep may-pay (`manaRestriction` set) may
        // also be paid with restricted mana carrying that restriction; merge it
        // into the affordability pool so the Pay button enables.
        const extraMana =
            chooser && choice.manaRestriction
                ? chooser.restrictedMana
                      ?.filter((r) => r.restriction === choice.manaRestriction)
                      .reduce<Record<string, number>>((acc, r) => {
                          acc[r.color] = (acc[r.color] ?? 0) + r.amount;
                          return acc;
                      }, {})
                : undefined;
        canConfirm =
            !isBusy &&
            (!choice.cost ||
                (chooser
                    ? mayPayCanAfford(
                          choice.cost,
                          chooser.manaPool,
                          chooser.life,
                          mayPaySacrificeCount(
                              choice.cost,
                              chooser.battlefield
                          ),
                          extraMana
                      )
                    : false));
    } else {
        // Zone picks (incl. Sylvan Library's 0–N topdeck range): Done enables
        // at the minimum allowed selection — 0 when min === 0 (CR 608.2).
        canConfirm =
            !bufferCtx.isPending &&
            isZonePickConfirmEnabled(choice.count, bufferCtx.buffer.length);
    }

    return { canConfirm, confirm, isPending: isBusy || bufferCtx.isPending };
}
