/**
 * Counters as a standing resource in the leaf evaluation (issue #8294).
 *
 * A counter that pays one of its own permanent's activated abilities is an
 * activation still to come (CR 122.1, CR 118.3). Priced at nothing, keeping one
 * read as no gain at all, and any activation with a small payoff beat holding it.
 *
 * ONE unit prices every such activation: `latent.cardAdvantage`, one card drawn,
 * the scale of the one-shot effect an activation buys. Nothing here is a new
 * weight, so the term moves with the fitted vector. The body counters a creature
 * pays with are left out, `evaluateCreature` reads them through its power and
 * toughness, and so are mana charges (`finiteManaUses`, `evaluate.ts`).
 *
 * A planeswalker's counters are read by what they protect (CR 306.9, CR 606.4):
 * its loyalty already scales its body (`loyaltyValue.ts`), and what spending it
 * gives up beyond that is the turns of activations ahead. A walker the opposing
 * creatures cannot finish in one attack has them; one they can does not, however
 * small the gain that took it there.
 *
 * PURE: reads the definition registry and the instance, mutates nothing.
 */

import type { LatentWeights } from "./evalWeights";
import type { CardInstanceState, GameState } from "../state";
import { currentLoyalty } from "../loyalty";
import { isCreature, isPlaneswalker } from "../constants";
import { getEffectivePT } from "../layers";
import { tryGetDefinition } from "../../cards";
import { spendsStandingCounter } from "./abilityTiming";

/** The activations a walker that survives the next attack has ahead of it. */
const SAFE_WALKER_ACTIVATIONS = 4;

/** How many more activations the counters on `perm` can pay for, on the ability
 *  that gets the most out of them. Zero with no counter-paid ability. */
export function standingCounterUses(perm: CardInstanceState): number {
    if (!perm.counters) return 0;
    const def = tryGetDefinition(String(perm.card.id ?? ""));
    let uses = 0;
    for (const ability of def?.activatedAbilities ?? []) {
        const leg = ability.cost.removeCounter;
        if (!leg || !spendsStandingCounter(ability)) continue;
        uses = Math.max(
            uses,
            Math.floor((perm.counters[leg.type] ?? 0) / leg.count)
        );
    }
    return uses;
}

/** Whether the creatures of `walker`'s opponents, swinging together with nothing
 *  in the way, deal less than its loyalty (CR 120.3c): it lives to activate again. */
export function walkerOutlastsNextAttack(
    state: GameState,
    walker: CardInstanceState
): boolean {
    let power = 0;
    for (const player of state.players) {
        if (player.id === walker.controllerId) continue;
        for (const card of player.battlefield) {
            if (
                !isCreature(card) ||
                card.staticAbilities.includes("defender")
            ) {
                continue;
            }
            power += Math.max(0, getEffectivePT(state, card).power);
        }
    }
    return power < currentLoyalty(walker);
}

/** The worth of the activations `perm`'s counters still pay for. */
export function standingCounterWorth(
    state: GameState,
    perm: CardInstanceState,
    latent: LatentWeights
): number {
    const activations = isPlaneswalker(perm)
        ? walkerOutlastsNextAttack(state, perm)
            ? SAFE_WALKER_ACTIVATIONS
            : 0
        : standingCounterUses(perm);
    return activations * latent.cardAdvantage;
}
