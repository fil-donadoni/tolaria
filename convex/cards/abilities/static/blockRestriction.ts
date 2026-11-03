/**
 * A block restriction stated as DATA (issue #3315) — "This creature can block
 * only creatures with flying" (CR 509.1b).
 *
 * `StaticBlockRestriction.predicate` is a closure, and a closure cannot reach a
 * serialized catalogue row nor be compared by Guard C (`sortKeys` renders every
 * function as the same sentinel, so two different closures look equal). This
 * factory is the one place the predicate is DERIVED from a JSON-pure
 * {@link CombatCounterpartFilter}, and it keeps that filter on the effect as
 * `onlyAgainst`. A hand-written card and the Oracle compiler's expander
 * (`resolveCompiledStatic`) both call it, so the closure is the same code on
 * both sides and the comparison reads the filter.
 */

import type {
    CombatCounterpartFilter,
    PermanentView,
    StaticBlockRestriction,
} from "../../types";

/**
 * Does `other` satisfy the filter? The combat validator hands the predicate the
 * live `CardInstanceState` (cast to `PermanentView`), whose `staticAbilities`
 * the layer system maintains — so a granted flying counts and a removed one
 * does not (CR 613.1f).
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
 * CR 509.1b — a BLOCKER-side restriction: the creature carrying it may block
 * only an attacker matching `onlyAgainst`.
 */
export function counterpartBlockRestriction(args: {
    readonly id: string;
    readonly onlyAgainst: CombatCounterpartFilter;
    readonly oracleText: string;
}): StaticBlockRestriction {
    const { id, onlyAgainst, oracleText } = args;
    return {
        kind: "block-restriction",
        id,
        side: "blocker",
        onlyAgainst,
        predicate: (_self, attacker) =>
            matchesCombatCounterpart(onlyAgainst, attacker),
        oracleText,
    };
}
