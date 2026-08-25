/**
 * CR 606 — loyalty abilities. THE single authority on when one may be
 * activated and what activating it costs (issue #2491).
 *
 * WHY THIS MODULE EXISTS. The rule used to live once, on the human path, as a
 * pair of throwing helpers in `convex/game.ts`
 * (`assertLoyaltyActivationLegal` / `payLoyaltyCost`). The bot's move
 * enumerator could not reach them — `convex/gre/**` must not import
 * `convex/game.ts` (game.ts imports the GRE, never the reverse) — so
 * `enumerateAbilityMoves` refused every loyalty ability outright and the bot
 * cast planeswalkers it then never activated. Re-deriving the rule inside the
 * enumerator would have produced exactly the divergence this repo keeps
 * closing: an enumerator that says "legal" where the mutation says "illegal"
 * half-applies the bot's `activateAbility → selectTarget` sequence.
 *
 * So the rule moved DOWN, into pure engine code, in two shapes of one
 * predicate:
 *   - {@link loyaltyActivationViolation} — the boolean/reason form, consumed by
 *     the move enumerator (`gre/moves.ts`) and the search's cost payer
 *     (`gre/applyMove.ts`);
 *   - the throwing wrapper `assertLoyaltyActivationLegal` (`convex/game.ts`),
 *     which is now nothing but this predicate plus a `throw`.
 *
 * The client's UI hint (`src/lib/card-utils.ts` `getStackAbilities`) reads the
 * two STATE-ONLY clauses from here as well; it cannot use the full predicate
 * because its `TriggerStateView` carries no stack length or priority holder,
 * so its timing check stays a documented narrowing (the server is the gate).
 *
 * PURE: `loyaltyActivationViolation` mutates nothing; `payLoyaltyCost` mutates
 * only the card instance it is handed.
 */

import type { CardInstanceState, GameState } from "./state";
import { isSorceryTimingFor } from "./phases";

/** The engine's canonical loyalty-counter key (CR 306.5b). Loyalty lives in the
 *  generic `counters` map under this exact lowercase key. Re-exported from
 *  `convex/debugScenarioSpec.ts`'s `LOYALTY_COUNTER`, kept as its own constant
 *  here so pure engine code never imports the debug-scenario module. */
export const LOYALTY_COUNTER_KEY = "loyalty";

/** The minimum an activated ability has to look like for the CR 606 rules to
 *  apply to it — a signed `cost.loyalty`. Deliberately structural rather than
 *  `ActivatedAbility`, so a granted/synthesised ability and the definition's
 *  printed one are the same input here (CR 606.2: the loyalty symbol in the
 *  cost IS the marker; there is no separate flag). */
export type LoyaltyCostBearing = { cost: { loyalty?: number } };

/** Which CR 606 clause an attempted activation breaks. `null` from
 *  {@link loyaltyActivationViolation} means "no clause broken", which for a
 *  NON-loyalty ability is vacuously true. */
export type LoyaltyViolation =
    /** CR 606.3 — a loyalty ability of this permanent was already activated
     *  this turn. */
    | "already-activated"
    /** CR 606.3 — outside the controller's own main phase with an empty stack
     *  while they hold priority. */
    | "timing"
    /** CR 606.6 — a negative loyalty cost with fewer counters on the permanent
     *  than the cost removes. */
    | "insufficient-loyalty";

/** The exact message each violation throws on the mutation path. Kept here so
 *  the wording is a property of the RULE rather than of one call site — the
 *  strings are byte-identical to the ones `assertLoyaltyActivationLegal` threw
 *  before the extraction, because the client surfaces them verbatim. */
export const LOYALTY_VIOLATION_MESSAGE: Record<LoyaltyViolation, string> = {
    "already-activated":
        "A loyalty ability of this permanent has already been activated this turn",
    timing: "A loyalty ability can only be activated at sorcery speed on your turn",
    "insufficient-loyalty": "Not enough loyalty to activate this ability",
};

/** CR 606.2 — an activated ability with a loyalty symbol in its cost IS a
 *  loyalty ability. The presence of the signed `cost.loyalty` member is the
 *  entire marker; there is no separate flag, and `0` is a real loyalty cost
 *  (Jace, the Mind Sculptor's `[0]`), so this is an `undefined` check and never
 *  a truthiness one. */
export function isLoyaltyAbility(ability: LoyaltyCostBearing): boolean {
    return ability.cost.loyalty !== undefined;
}

/** The loyalty counters currently on `card` (CR 306.5b / 122.1). */
export function currentLoyalty(card: {
    counters?: Record<string, number>;
}): number {
    return card.counters?.[LOYALTY_COUNTER_KEY] ?? 0;
}

/** CR 606.3 — "only if no player has previously activated a loyalty ability of
 *  that permanent that turn". The lock is per PERMANENT, not per ability, and
 *  is a different flag from the generic `oncePerTurn` / `activationsThisTurn`
 *  tally CR 602.5 abilities use. Cleared in the cleanup step
 *  (`gre/phases.ts`). */
export function loyaltyLockedThisTurn(card: {
    loyaltyActivatedThisTurn?: boolean;
}): boolean {
    return card.loyaltyActivatedThisTurn === true;
}

/** CR 606.6 — "A loyalty ability with a negative loyalty cost … can't be
 *  activated unless the permanent has at least that many loyalty counters on
 *  it." Landing on exactly 0 is legal (the CR forbids going BELOW); the
 *  permanent then dies to the CR 704.5i state-based action.
 *
 *  A non-negative cost is always payable, so this returns true for `+N` / `0`
 *  and for a non-loyalty ability. */
export function loyaltyCostPayable(
    card: { counters?: Record<string, number> },
    ability: LoyaltyCostBearing
): boolean {
    const loyalty = ability.cost.loyalty;
    if (loyalty === undefined || loyalty >= 0) return true;
    return currentLoyalty(card) + loyalty >= 0;
}

/**
 * The whole CR 606 activation gate, as a reason rather than a throw.
 *
 * Returns `null` when the activation is legal — and, vacuously, for any
 * ability that is not a loyalty ability at all, so every call site can apply it
 * unconditionally.
 *
 * The three clauses, in the order the mutation path has always applied them:
 *   - CR 606.3, the per-permanent once-per-turn lock;
 *   - CR 606.3, the timing window — `isSorceryTimingFor(state, controllerId)`
 *     is exactly "any time they have priority and the stack is empty during a
 *     main phase of their turn" (`gre/phases.ts`, the engine's one authority on
 *     that window);
 *   - CR 606.6, the negative-cost floor.
 *
 * `controllerId` on the card is the subject of the timing clause: CR 606.3
 * grants the window to the permanent's controller, so an "any player may
 * activate" grant (CR 113.3c) could never widen it.
 */
export function loyaltyActivationViolation(
    state: GameState,
    card: CardInstanceState,
    ability: LoyaltyCostBearing
): LoyaltyViolation | null {
    if (!isLoyaltyAbility(ability)) return null;
    if (loyaltyLockedThisTurn(card)) return "already-activated";
    if (!isSorceryTimingFor(state, card.controllerId)) return "timing";
    if (!loyaltyCostPayable(card, ability)) return "insufficient-loyalty";
    return null;
}

/**
 * CR 606.4 — pay a loyalty ability's cost: put on / remove from the permanent
 * the number of loyalty counters the loyalty symbol names (`+N` adds, `-N`
 * removes), and set the CR 606.3 per-permanent once-per-turn lock.
 *
 * No-op for a non-loyalty ability, so it may be called unconditionally at an
 * activation commit site.
 *
 * The floor at 0 is belt-and-braces: {@link loyaltyActivationViolation}'s
 * CR 606.6 clause already refuses a cost that would go below, and every commit
 * site runs the gate first.
 */
export function payLoyaltyCost(
    card: CardInstanceState,
    ability: LoyaltyCostBearing
): void {
    const loyalty = ability.cost.loyalty;
    if (loyalty === undefined) return;
    card.counters = {
        ...(card.counters ?? {}),
        [LOYALTY_COUNTER_KEY]: Math.max(0, currentLoyalty(card) + loyalty),
    };
    card.loyaltyActivatedThisTurn = true;
}
