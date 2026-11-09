// CR 605.1a / 601.2g — charge a cost by auto-tapping the payer's mana sources.
// Moved out of `convex/game.ts` (issue #9001) so the auth-free
// `confirmBlockersOnState` core (`owedInputDeclines.ts`) can charge the
// pay-to-block bypass the same way the `confirmBlockers` mutation does.
import type { ManaCost } from "../cards/types";
import {
    buildAutoTapSources,
    manaFromPlan,
    solveSmartAutoTap,
} from "./autoTap";
import { manaGateBattlefields, replaceProducedManaColor } from "./constants";
import { getPlayer } from "./lookup";
import {
    commitLandsForCost,
    getManaSubstitutions,
    normalizeManaCost,
    payManaCostWithRiders,
    spendablePoolWithRiders,
    type GameState,
} from "./state";

/** Charges `rawCost` to `controllerId` by auto-tapping their mana sources
 *  (generic/fungible; CR 605.1a taps produce mana into the pool, CR 601.2g pays
 *  from it) and committing lands used for the cost. Throws `reason` when the
 *  cost cannot be covered — the caller's mutation clone is discarded, so no
 *  partial state persists. Used by the pay-to-block bypass (Hipparion
 *  `bypassCost`, `collectBlockBypassCharges`). The per-attacker mana attack tax
 *  no longer auto-taps here — it parks on `combat.pendingAttackManaTax` and the
 *  attacking player pays it via a prompt (`beginAttackManaTax` /
 *  `autoTapForAttackTax`, #1053/#1066). Pure apart from mutating `state`. */
export function chargeManaCostOrThrow(
    state: GameState,
    controllerId: string,
    rawCost: ManaCost,
    reason: string
): void {
    const payer = getPlayer(state, controllerId);
    const subs = getManaSubstitutions(state, controllerId);
    const sources = buildAutoTapSources(
        payer.battlefield,
        manaGateBattlefields(state),
        undefined,
        state
    );
    const cost = normalizeManaCost(rawCost);
    // CR 106.6 (issue #3354) — "This doesn't affect the mana's type": a
    // bare-rider unit (Arena of Glory's {R}{R}) imposes NO spend restriction
    // and must pay this exactly like pool mana. It lives outside `manaPool`
    // only because a per-colour count has nowhere to record the tag, so every
    // payment site that used to read the raw pool now reads
    // `spendablePoolWithRiders` / pays through `payManaCostWithRiders`, which
    // draws the fungible pool FIRST and touches a tagged unit only for what
    // the pool cannot cover.
    const plan = solveSmartAutoTap(
        spendablePoolWithRiders(payer),
        cost,
        subs,
        sources
    );
    if (plan === null) {
        throw new Error(reason);
    }
    // Execute the plan: tap the chosen sources and add their mana to the pool
    // (CR 605.1a), then pay the cost from the pool (CR 601.2g).
    const tappedIds = new Set(plan.map((step) => step.cardId));
    for (const src of payer.battlefield) {
        if (tappedIds.has(src.id)) src.isTapped = true;
    }
    const produced = replaceProducedManaColor(
        state,
        payer.id,
        manaFromPlan(sources, plan)
    );
    for (const color of Object.keys(produced)) {
        const v = produced[color as keyof typeof produced];
        if (typeof v === "number" && v > 0) {
            payer.manaPool[color] = (payer.manaPool[color] ?? 0) + v;
        }
    }
    payManaCostWithRiders(payer, cost, subs);
    commitLandsForCost(payer, cost);
}
