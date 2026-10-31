// The mana leg of a special action (CR 116.2) that pays a cost — the
// turn-up of a morph (CR 702.37e) and the plot action (CR 702.170a).
// Neither is a spell cast, so neither goes through `pendingCast`: the cost is
// solved and paid in the one call that takes the action, from an auto-tap
// plan the action's own legality predicate already accepted.
import type { ManaCost } from "../cards/types";
import type { AutoTapPlan } from "./autoTap";
import {
    buildAutoTapSources,
    manaFromPlan,
    solveSmartAutoTap,
} from "./autoTap";
import {
    MANA_COLORS,
    manaGateBattlefields,
    replaceProducedManaColor,
} from "./constants";
import type { GameState, PlayerState } from "./state";
import {
    commitLandsForCost,
    getManaSubstitutions,
    normalizeManaCost,
    payManaCostForSpell,
    spendablePoolWithRiders,
} from "./state";

/** The auto-tap plan that pays `cost` from `player`'s pool and untapped
 *  sources, or `null` when it cannot be paid. The plan COUNTS a bare-rider
 *  unit (CR 106.6, issue #3354) because {@link paySpecialActionManaCost}
 *  admits one: each action's legality predicate and its payment read this one
 *  plan, so "the action is offered" and "the payment succeeds" cannot drift. */
export function specialActionPaymentPlan(
    state: GameState,
    player: PlayerState,
    cost: ManaCost
): AutoTapPlan | null {
    return solveSmartAutoTap(
        spendablePoolWithRiders(player),
        normalizeManaCost(cost),
        getManaSubstitutions(state, player.id),
        buildAutoTapSources(
            player.battlefield,
            manaGateBattlefields(state),
            undefined,
            state
        )
    );
}

/** Tap `plan`'s sources, add the mana they produce (CR 605.1a, with the
 *  controller's production-colour replacement, CR 614.1a) and pay `cost` from
 *  the pool with NO card types: a genuinely restricted unit is ineligible (a
 *  special action is not a spell cast) while a bare-rider unit is admitted and
 *  spent last (CR 106.6, issue #3354). */
export function paySpecialActionManaCost(
    state: GameState,
    player: PlayerState,
    cost: ManaCost,
    plan: AutoTapPlan
): void {
    const normalized = normalizeManaCost(cost);
    const subs = getManaSubstitutions(state, player.id);
    const sources = buildAutoTapSources(
        player.battlefield,
        manaGateBattlefields(state),
        undefined,
        state
    );
    const tappedIds = new Set(plan.map((step) => step.cardId));
    for (const src of player.battlefield) {
        if (tappedIds.has(src.id)) src.isTapped = true;
    }
    const produced = replaceProducedManaColor(
        state,
        player.id,
        manaFromPlan(sources, plan)
    );
    for (const color of MANA_COLORS) {
        const amount = produced[color];
        if (amount) {
            player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
        }
    }
    payManaCostForSpell(player, normalized, [], subs);
    commitLandsForCost(player, normalized);
}
