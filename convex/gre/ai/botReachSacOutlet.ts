/**
 * What the Bot-play sweep puts on the board for a creature whose activated
 * ability sacrifices a creature to deal damage (CR 602.2, CR 118.8,
 * CR 120.3): "{1}, Sacrifice a creature: this deals 1 damage to any target".
 *
 * The position's holder has no spare body to feed the ability and the
 * opponent no small creature for it to kill, so the ability can only trade
 * the card for nothing and passing is right: the card read `never-chosen`, a
 * limit of the harness, not a fact about the Bot. The board learns the shape
 * instead: spare bodies on the holder's side to sacrifice and small creatures
 * on the opponent's side the damage removes.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** A 1/1 body: sacrificed fodder on one side, a lethal-damage target on the other. */
const SMALL_BODY = "Mons's Goblin Raiders";

/** Bodies posed per side. */
const BODIES_PER_SIDE = 2;

/** Does an activated ability sacrifice a creature to deal damage? */
function sacrificesCreatureForDamage(def: CardDefinition): boolean {
    return (def.activatedAbilities ?? []).some(
        (ability) =>
            (ability.cost.sacrificeFilter?.types?.includes("Creature") ??
                false) &&
            (ability.effects ?? []).some((op) => op.op === "dealDamage")
    );
}

/** The cards the position hands a creature that sacrifices creatures to deal
 *  damage, or none. */
export function sacOutletPose(def: CardDefinition): ScenarioCard[] {
    if (!def.types.includes("Creature")) return [];
    if (!sacrificesCreatureForDamage(def)) return [];
    return [
        {
            name: SMALL_BODY,
            owner: "me",
            zone: "battlefield",
            count: BODIES_PER_SIDE,
        },
        {
            name: SMALL_BODY,
            owner: "opp",
            zone: "battlefield",
            count: BODIES_PER_SIDE,
        },
    ];
}
