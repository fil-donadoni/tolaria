// "A source of your choice" — the pool a damage source is chosen from
// (issue #5601, issue #3731).
//
// CR 609.7a: "If an effect requires a player to choose a source of damage,
// they may choose a permanent; a spell on the stack (including a permanent
// spell); …" The choice is NOT targeting (CR 115.1 — targets are declared as
// the spell or ability is put on the stack, and this one is made as the
// effect is created), so shroud, hexproof and protection remove no candidate
// and choosing one fires no "becomes the target" trigger.
//
// ONE authority for the pool, read by every site that would otherwise
// rebuild it: the `pick-source` choice's raise (`SpellContext`'s
// `getDamageSourceChoiceIds`), the submit validator
// (`pendingChoiceSubmitHandlers.ts`), the legal-action enumeration
// (`zonePickEligibility.ts`) and the Bot's view of the choice. The other
// CR 609.7a categories (objects referred to by a stack object, a waiting
// replacement or delayed trigger; command-zone objects) are not modelled.

import type { DamageSourceFilter } from "../cards/filters";
import { matchesDamageSourceFilter } from "../cards/filters";
import { isSpellStackItem } from "./constants";
import { STATIC_EFFECT_CTX } from "./layers";
import type { CardInstanceState, GameState } from "./state";

/** CR 609.7a — every object a player may choose as a source of damage: each
 *  spell on the stack (a permanent spell included), TOPMOST first, then each
 *  permanent on the battlefield whoever controls it. An ability on the stack
 *  is not in the list — the rule names spells, and an ability's damage is
 *  dealt by the object it came from. Topmost-first is the order a chooser
 *  reads the threat in: the spell about to resolve leads. */
export function damageSourceChoicePool(state: GameState): CardInstanceState[] {
    const spells = state.stack.filter(isSpellStackItem).reverse();
    return [...spells, ...state.players.flatMap((p) => p.battlefield)];
}

/** The ids of {@link damageSourceChoicePool} narrowed by `filter` — "a red
 *  source", "a black or red source" (either colour suffices), "an artifact
 *  source". Read against each object's CURRENT colours (CR 105.2 / 202.2f —
 *  the same layered read a colour target filter uses) and types, as the
 *  choice is made: CR 609.7a — "the source is chosen when the effect is
 *  created". */
export function damageSourceChoiceIds(
    state: GameState,
    filter?: DamageSourceFilter
): string[] {
    return damageSourceChoicePool(state)
        .filter(
            (card) =>
                filter === undefined ||
                matchesDamageSourceFilter(
                    {
                        types: card.types,
                        subtypes: card.subtypes,
                        colors: STATIC_EFFECT_CTX.getColors(card),
                        staticAbilities: card.staticAbilities,
                        controllerId: card.controllerId,
                        instanceId: card.id,
                    },
                    filter
                )
        )
        .map((card) => card.id);
}
