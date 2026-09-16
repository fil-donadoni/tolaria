import type {
    ActivatedAbility,
    PermanentView,
    TriggerStateView,
} from "../cards/types";

/**
 * CR 602.5b — an activated ability's own printed restriction ("Activate only
 * if…", "Activate no more than twice each turn") carried as a `canActivate`
 * closure on the definition. Returns the rejection message, or `null` when the
 * ability carries no closure or the closure currently holds.
 *
 * The ONE authority the activation mutations (`gre/activation.ts`,
 * `game.ts`) and the Bot (`enumerateAbilityMoves` in `gre/moves.ts`,
 * `hasFlexibleActivation` in `gre/evaluate.ts`) all read — the
 * `loyaltyActivationViolation` / `classLevelActivationViolation` shape, so the
 * enumerator can never offer an activation the server rejects, nor refuse one
 * the server would accept (issue #3441: before this, both Bot sites skipped
 * EVERY ability carrying a closure, and 21 shipped abilities were unreachable).
 *
 * `source` is the instance exactly as the mutation resolves it, from whichever
 * zone the ability functions in (a battlefield permanent, or the graveyard
 * card of an `activateFromGraveyard` ability); `state` is the live game state.
 */
export function activationPreconditionViolation(
    state: TriggerStateView,
    source: PermanentView,
    ability: Pick<ActivatedAbility, "canActivate">
): string | null {
    if (ability.canActivate === undefined) return null;
    return ability.canActivate(source, state)
        ? null
        : "Ability cannot be activated right now";
}
