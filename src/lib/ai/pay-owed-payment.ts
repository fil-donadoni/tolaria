// Realises an owed-payment submission (ADR 0091, issue #1209) — the bot's half
// of the payment-park seam.
//
// `nextOwedPayment` (`convex/gre/owedPayment.ts`) says WHAT the bot still owes
// on its own in-progress announcement, `pickForOwedPayment`
// (`convex/gre/paymentPicks.ts`) says WITH WHAT, and this dispatches that answer
// to the EXISTING human mutation, one pick per call. No bot-only entry point
// into cost legality (ADR 0091 decision 5): the server re-validates every pick
// exactly as it would a human's click.
//
// The switch is `assertNever`-closed over `OwedPaymentSubmission["mutation"]`,
// which — together with the census in `owedPayment.ts` and the
// `Record<ParkKind, …>` route in `brain.ts` — is the third and last place a new
// park must be classified before it can compile. That chain is what turns "a
// new park silently stalls the bot" (fixed nine times one park at a time:
// #161, #163, #164, #1336, #1338, #1446, #1506, #1507, #1659) into a build
// error.

import type { OwedPaymentSubmission } from "@convex/gre/paymentPicks";
import type { Id } from "@convex/_generated/dataModel";

type Seat = { gameId: Id<"games">; playerId: string };

/** The public `game.ts` mutations an owed-payment submission can name. Exactly
 *  the pickers a human's clicks drive — see `PARK_KEYS_*` in
 *  `convex/gre/owedPayment.ts` for the park each one answers. */
export type OwedPaymentMutations = {
    selectSacrifice: (a: Seat & { cardInstanceId: string }) => Promise<unknown>;
    selectAdditionalCost: (
        a: Seat & { cardInstanceId: string }
    ) => Promise<unknown>;
    selectConvokeCreatures: (
        a: Seat & { creatureInstanceIds: string[] }
    ) => Promise<unknown>;
    selectCastExileCost: (
        a: Seat & { cardInstanceIds: string[] }
    ) => Promise<unknown>;
    selectCastAlternativeHandCost: (
        a: Seat & { cardInstanceIds: string[] }
    ) => Promise<unknown>;
    selectActivationCost: (
        a: Seat & { cardInstanceId: string }
    ) => Promise<unknown>;
    selectActivationExileCost: (
        a: Seat & { graveyardOwnerId: string; cardInstanceIds: string[] }
    ) => Promise<unknown>;
    selectActivationDiscardCost: (
        a: Seat & { cardInstanceIds: string[] }
    ) => Promise<unknown>;
    resolveManaSpendChoice: (
        a: Seat & { spendOrder: string[] }
    ) => Promise<unknown>;
};

function assertNever(x: never): never {
    throw new Error(`Unhandled owed-payment submission: ${JSON.stringify(x)}`);
}

/** Submit `submission` through the human mutations it names. Sequential and
 *  awaited throughout: the `*Each` shapes (CR 701.16 filtered sacrifice, CR
 *  118.8 crew) fire one call per id and the server COMMITS the announcement the
 *  moment the last one lands, so firing them concurrently would race the commit
 *  against the picks that still have to reach it. */
export async function submitOwedPayment(
    submission: OwedPaymentSubmission,
    seat: Seat,
    mutations: OwedPaymentMutations
): Promise<void> {
    switch (submission.mutation) {
        case "selectSacrifice":
            for (const cardInstanceId of submission.cardInstanceIdEach) {
                await mutations.selectSacrifice({ ...seat, cardInstanceId });
            }
            return;
        case "selectAdditionalCost":
            await mutations.selectAdditionalCost({
                ...seat,
                cardInstanceId: submission.cardInstanceId,
            });
            return;
        case "selectConvokeCreatures":
            await mutations.selectConvokeCreatures({
                ...seat,
                creatureInstanceIds: submission.creatureInstanceIds,
            });
            return;
        case "selectCastExileCost":
            await mutations.selectCastExileCost({
                ...seat,
                cardInstanceIds: submission.cardInstanceIds,
            });
            return;
        case "selectCastAlternativeHandCost":
            await mutations.selectCastAlternativeHandCost({
                ...seat,
                cardInstanceIds: submission.cardInstanceIds,
            });
            return;
        case "selectActivationCost":
            for (const cardInstanceId of submission.cardInstanceIdEach) {
                await mutations.selectActivationCost({
                    ...seat,
                    cardInstanceId,
                });
            }
            return;
        case "selectActivationExileCost":
            await mutations.selectActivationExileCost({
                ...seat,
                graveyardOwnerId: submission.graveyardOwnerId,
                cardInstanceIds: submission.cardInstanceIds,
            });
            return;
        case "selectActivationDiscardCost":
            await mutations.selectActivationDiscardCost({
                ...seat,
                cardInstanceIds: submission.cardInstanceIds,
            });
            return;
        case "resolveManaSpendChoice":
            await mutations.resolveManaSpendChoice({
                ...seat,
                spendOrder: submission.spendOrder,
            });
            return;
        default:
            return assertNever(submission);
    }
}
