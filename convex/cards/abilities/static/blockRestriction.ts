/**
 * The one evaluator of a card-level block restriction (CR 509.1b, issue #3315).
 *
 * A `StaticBlockRestriction` states which blocks it allows in exactly one of
 * two ways: a `predicate` closure, or an `onlyAgainst` descriptor — JSON-pure
 * data ("can block only creatures with flying") the Oracle compiler can emit
 * and Guard C can compare (`sortKeys` renders every closure as the same
 * sentinel, so two different closures look alike and a card holding one is
 * only ever `incomparable`). Every reader — the block validator, the bypass-cost
 * charger, the Brain's restriction pricing — asks this function, so a
 * descriptor-sourced restriction is honoured exactly where a closure is.
 */

import type {
    CombatCounterpartFilter,
    PermanentView,
    StaticBlockRestriction,
    StaticEffectStateView,
} from "../../types";

/**
 * Does `other` satisfy the filter? The combat validator hands the restriction
 * the live `CardInstanceState` (typed as `PermanentView`), whose
 * `staticAbilities` the layer system maintains — so a granted flying counts and
 * a removed one does not (CR 613.1f).
 */
export function matchesCombatCounterpart(
    filter: CombatCounterpartFilter,
    other: PermanentView
): boolean {
    const keywords =
        (other as { staticAbilities?: readonly string[] }).staticAbilities ??
        [];
    return keywords.includes(filter.keyword);
}

/**
 * Is this block LEGAL under `restriction`? `self` is the creature carrying (or
 * enchanted by) the restriction, `other` the creature on the far side of the
 * block — the attacker for `side: "blocker"`, the candidate blocker for
 * `side: "attacker"`.
 */
export function blockRestrictionAllows(
    restriction: StaticBlockRestriction,
    self: PermanentView,
    other: PermanentView,
    state?: StaticEffectStateView
): boolean {
    if (restriction.onlyAgainst !== undefined)
        return matchesCombatCounterpart(restriction.onlyAgainst, other);
    return restriction.predicate(self, other, state);
}
