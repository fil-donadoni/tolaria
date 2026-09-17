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
 *   - the throwing wrapper `assertLoyaltyActivationLegal` (`convex/gre/activation.ts`),
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
import { getEffectiveStaticEffects } from "./state";
import { isSorceryTimingFor } from "./phases";
import { tryGetDefinition } from "../cards/registry";

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
    /** CR 606.3 — this permanent's loyalty-activation allowance for the turn
     *  is spent (one activation, unless a `loyalty-activation-allowance`
     *  static effect on the permanent raises it). */
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

/** CR 606.3's printed allowance: ONE loyalty activation per permanent per
 *  turn. "only if no player has previously activated a loyalty ability of that
 *  permanent that turn" is not a lock — it is a count of one, and a permanent
 *  whose own text raises it (Urza, Planeswalker: "You may activate the loyalty
 *  abilities of Urza twice each turn rather than only once") widens the SAME
 *  number rather than escaping a flag (issue #3339). */
export const DEFAULT_LOYALTY_ACTIVATION_ALLOWANCE = 1;

/** The minimum a permanent has to look like for the CR 606.3 allowance to be
 *  computable: the id of the card whose definition carries the text, plus the
 *  chosen mode a modal permanent's effects hang off (CR 700.2).
 *
 *  Structural rather than `CardInstanceState` so the CLIENT's own card view
 *  (`CardInstance`, `src/types/game.ts` — `card: { id: string }`) satisfies it
 *  unchanged. That is the whole reason the UI hint can read this authority
 *  instead of re-deriving the rule. */
export type LoyaltyAllowanceSource = {
    card: { id?: string };
    chosenModeId?: string;
};

/** How many loyalty abilities of this permanent may be activated this turn
 *  (CR 606.3) — the ALLOWANCE half of the pair whose USED half is
 *  {@link loyaltyActivationsUsedThisTurn}.
 *
 *  {@link DEFAULT_LOYALTY_ACTIVATION_ALLOWANCE} plus every
 *  `loyalty-activation-allowance` static effect on the permanent's own
 *  EFFECTIVE static effects (card-level plus the chosen mode's, CR 700.2 —
 *  the same `getEffectiveStaticEffects` the layer system reads). Never a
 *  per-card branch: a future planeswalker printing the same clause declares
 *  the effect and needs no engine change at all.
 *
 *  SELF-SCOPED by construction, because the shipped clause is
 *  ("the loyalty abilities of <this permanent>"); nothing here scans the
 *  board, so the fast path below keeps the allowance off the enumerator's hot
 *  path entirely.
 *
 *  Clamped at the default from below: a negative `extra` is authoring
 *  nonsense, and CR 606.3 never grants FEWER than one activation. */
export function loyaltyActivationAllowance(
    card: LoyaltyAllowanceSource
): number {
    const cardId = card.card?.id;
    if (!cardId) return DEFAULT_LOYALTY_ACTIVATION_ALLOWANCE;
    const def = tryGetDefinition(cardId);
    if (!def) return DEFAULT_LOYALTY_ACTIVATION_ALLOWANCE;
    let allowance = DEFAULT_LOYALTY_ACTIVATION_ALLOWANCE;
    for (const effect of getEffectiveStaticEffects(def, card.chosenModeId)) {
        if (effect.kind !== "loyalty-activation-allowance") continue;
        allowance += effect.extra;
    }
    return Math.max(DEFAULT_LOYALTY_ACTIVATION_ALLOWANCE, allowance);
}

/** CR 606.3 — how many loyalty abilities of this permanent have been activated
 *  this turn. Per PERMANENT, not per ability, and a different tally from the
 *  generic `oncePerTurn` / `activationsThisTurn` one CR 602.5 abilities use.
 *  Cleared at the start of each turn (`gre/phases.ts`). */
export function loyaltyActivationsUsedThisTurn(card: {
    loyaltyActivationsThisTurn?: number;
}): number {
    return card.loyaltyActivationsThisTurn ?? 0;
}

/** CR 606.3 — has this permanent spent its whole loyalty-activation allowance
 *  this turn? THE predicate every surface asks, so that widening the allowance
 *  reaches the enumerator, the search's cost payer, the mutation and the
 *  client's UI hint at once.
 *
 *  The used tally is read FIRST and the allowance computed only when the
 *  default has been reached, so every shipped planeswalker — none of which
 *  declares an allowance effect — costs exactly the field read it cost when
 *  this was a boolean, with no registry lookup on the enumerator's hot path. */
export function loyaltyActivationsExhausted(
    card: LoyaltyAllowanceSource & { loyaltyActivationsThisTurn?: number }
): boolean {
    const used = loyaltyActivationsUsedThisTurn(card);
    if (used < DEFAULT_LOYALTY_ACTIVATION_ALLOWANCE) return false;
    return used >= loyaltyActivationAllowance(card);
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
 *   - CR 606.3, the per-permanent activation allowance (one per turn, unless
 *     the permanent's own static text raises it);
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
    if (loyaltyActivationsExhausted(card)) return "already-activated";
    if (!isSorceryTimingFor(state, card.controllerId)) return "timing";
    if (!loyaltyCostPayable(card, ability)) return "insufficient-loyalty";
    return null;
}

/**
 * CR 606.4 — pay a loyalty ability's cost: put on / remove from the permanent
 * the number of loyalty counters the loyalty symbol names (`+N` adds, `-N`
 * removes), and spend one of the permanent's CR 606.3 activations for the
 * turn.
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
    card.loyaltyActivationsThisTurn = loyaltyActivationsUsedThisTurn(card) + 1;
}
