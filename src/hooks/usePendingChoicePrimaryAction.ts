import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
    mayPayCanAfford,
    mayPaySacrificeCount,
    mayPaySacrificePower,
    mayPaySacrificePickSatisfied,
    mayPayDiscardPickSatisfied,
} from "~/lib/card-utils";
import { isZonePickConfirmEnabled } from "~/lib/pending-choice-confirm";
import { pendingChoiceRoutesToBattlefield } from "~/lib/pending-choice-labels";
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
    const submitLandEntryChoice = useMutation(api.game.submitLandEntryChoice);
    const submitDrawReplacementPay = useMutation(
        api.game.submitDrawReplacementPay
    );
    const [isBusy, setIsBusy] = useState(false);

    const choice = pendingChoices?.[0];
    const isChooser = !!choice && choice.playerId === playerId;
    // CR 118.3 / 614.12 / 614 (#735) — the yes-no "pay a cost or not" families
    // share the affordability + affirmative rendering; only the submit mutation
    // differs (`may-pay` → submitMayPay, `land-entry-tapped` →
    // submitLandEntryChoice, `draw-replacement` → submitDrawReplacementPay).
    const isYesNoPay =
        choice?.kind === "may-pay" ||
        choice?.kind === "land-entry-tapped" ||
        choice?.kind === "draw-replacement";

    const confirm = useCallback(async () => {
        if (!choice || isBusy) return;
        if (choice.kind === "may-pay") {
            setIsBusy(true);
            try {
                // CR 701.21a — a sacrifice leg with a real victim choice sets
                // `zone: "battlefield"`; the chosen victims are the picks the
                // player accumulated in the shared choice buffer. A plain
                // yes/no (or auto-resolving) may-pay carries no zone → no ids.
                const sacrificeIds = pendingChoiceRoutesToBattlefield(choice)
                    ? bufferCtx.buffer
                    : undefined;
                // CR 701.9 / 118.3 (issue #899) — a discard leg with a real
                // card choice sets `zone: "hand"`; the chosen cards are the
                // picks the player accumulated in the same shared buffer.
                const discardIds =
                    choice.zone === "hand" ? bufferCtx.buffer : undefined;
                await submitMayPay({
                    gameId,
                    playerId,
                    accept: true,
                    ...(sacrificeIds ? { sacrificeIds } : {}),
                    ...(discardIds ? { discardIds } : {}),
                });
            } finally {
                setIsBusy(false);
            }
        } else if (choice.kind === "land-entry-tapped") {
            setIsBusy(true);
            try {
                await submitLandEntryChoice({ gameId, playerId, accept: true });
            } finally {
                setIsBusy(false);
            }
        } else if (choice.kind === "draw-replacement") {
            setIsBusy(true);
            try {
                await submitDrawReplacementPay({
                    gameId,
                    playerId,
                    accept: true,
                });
            } finally {
                setIsBusy(false);
            }
        } else {
            // Zone picks route through the buffer, which owns its own
            // in-flight + error state (see usePendingChoiceBuffer).
            await bufferCtx.submit();
        }
    }, [
        choice,
        isBusy,
        submitMayPay,
        submitLandEntryChoice,
        submitDrawReplacementPay,
        gameId,
        playerId,
        bufferCtx,
    ]);

    if (!choice || !isChooser) return null;

    let canConfirm: boolean;
    if (isYesNoPay) {
        // CR 118.3 / 702.24 — Pay/Yes is legal only once every leg of the cost
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
        // CR 701.21a / 118 — when the choice carries a battlefield sacrifice
        // pick (`zone: "battlefield"`), Pay stays disabled until the buffered
        // victims satisfy the leg: a fixed count, or (threshold mode, Phyrexian
        // Dreadnought) enough summed power to reach `minTotalPower`.
        const sacrificePickSatisfied =
            !pendingChoiceRoutesToBattlefield(choice) ||
            mayPaySacrificePickSatisfied(
                choice.cost,
                bufferCtx.buffer,
                chooser?.battlefield ?? []
            );
        // CR 701.9 / 118.9 (issue #899) — when the choice carries a hand
        // discard pick (`zone: "hand"`), Pay stays disabled until the buffered
        // cards satisfy the leg: the fixed count AND every requirement covered
        // from DISTINCT matching cards. The chooser's own hand is what the
        // per-requirement filters are read against (an opponent's projects to
        // `null`s, which the filter drops).
        const chooserHand = (chooser?.hand ?? []).filter(
            (c): c is NonNullable<typeof c> => c !== null
        );
        const discardPickSatisfied =
            choice.zone !== "hand" ||
            mayPayDiscardPickSatisfied(
                choice.cost,
                bufferCtx.buffer,
                chooserHand
            );
        canConfirm =
            !isBusy &&
            sacrificePickSatisfied &&
            discardPickSatisfied &&
            (!choice.cost ||
                (chooser
                    ? mayPayCanAfford(
                          choice.cost,
                          chooser.manaPool,
                          chooser.life,
                          mayPaySacrificeCount(
                              choice.cost,
                              chooser.battlefield,
                              // CR 701.21 — resolves `controllerRelation`
                              // ("sacrifice two Swamps YOU control") against
                              // the CHOOSER, mirroring the server's own
                              // `sacrificeCandidates` (`convex/gre/state.ts`).
                              // Missing this fails the filter CLOSED and
                              // undercounts a legal sacrifice to 0 (issue
                              // #1938 fixup 2 regression).
                              { selfControllerId: chooser.id }
                          ),
                          extraMana,
                          mayPaySacrificePower(
                              choice.cost,
                              chooser.battlefield,
                              { selfControllerId: chooser.id }
                          ),
                          chooserHand,
                          // CR 122.1 (issue #1194) — energy leg affordability;
                          // energy survives the wire projection unchanged
                          // (`PlayerState.energyCounters`).
                          chooser.energyCounters
                      )
                    : false));
    } else {
        // Zone picks (incl. Sylvan Library's 0–N topdeck range): Done enables
        // at the minimum allowed selection — 0 when min === 0 (CR 608.2).
        // issue #1945 — a CATEGORIZED pick (`choice.categories`) additionally
        // requires the buffered set to admit a legal per-category assignment,
        // not merely the right COUNT. `choice.categoryRule` (carried verbatim
        // through the wire projection) picks the SAME rule the server
        // validates the submission with — see `isZonePickConfirmEnabled`.
        canConfirm =
            !bufferCtx.isPending &&
            isZonePickConfirmEnabled(
                choice.count,
                bufferCtx.buffer.length,
                choice.categories
                    ? {
                          categories: choice.categories,
                          pickedIds: bufferCtx.buffer,
                          rule: choice.categoryRule ?? "injective",
                      }
                    : undefined
            );
    }

    return { canConfirm, confirm, isPending: isBusy || bufferCtx.isPending };
}
