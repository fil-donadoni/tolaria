/**
 * The one evaluator of a card-level block restriction (CR 509.1b, issue #3315).
 *
 * A `StaticBlockRestriction` states which blocks it allows in exactly one of
 * three ways: a `predicate` closure, or an `onlyAgainst` / `neverAgainst`
 * descriptor — JSON-pure data ("can block only creatures with flying", "can't
 * be blocked by blue creatures") the Oracle compiler can emit and Guard C can
 * compare (`sortKeys` renders every closure as the same
 * sentinel, so two different closures look alike and a card holding one is
 * only ever `incomparable`). Every reader — the block validator, the bypass-cost
 * charger, the Brain's restriction pricing — asks this function, so a
 * descriptor-sourced restriction is honoured exactly where a closure is.
 */

import { getEffectiveColors } from "../../effectiveColors";
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
 * a removed one does not (CR 613.1f). A colour
 * is the effective one (CR 613.1e, layer 5), so a creature turned blue matches;
 * a power is the one the caller enriched onto the view (CR 613.4, layer 7).
 */
export function matchesCombatCounterpart(
    filter: CombatCounterpartFilter,
    other: PermanentView
): boolean {
    if ("color" in filter)
        return getEffectiveColors(other).includes(filter.color);
    if ("power" in filter) {
        // CR 208.1 — `other.power` is the effective value the caller enriched
        // (CR 613.4); a view without one reads as 0, as the closures did.
        const power = other.power ?? 0;
        const { min, max } = filter.power;
        return (
            (min === undefined || power >= min) &&
            (max === undefined || power <= max)
        );
    }
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
    if (restriction.neverAgainst !== undefined)
        return !matchesCombatCounterpart(restriction.neverAgainst, other);
    return restriction.predicate(self, other, state);
}
