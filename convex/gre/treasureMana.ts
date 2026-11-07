import { tryGetDefinition } from "../cards";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import { effectiveTriggeredAbilities } from "./copy";
import type { CardInstanceState } from "./state/declarations";

/**
 * Which sacrifice mana sources the human Auto-Tap may spend, and in what order.
 *
 * CR 111.10a — a Treasure token is an artifact token with "{T}, Sacrifice this
 * token: Add one mana of any color." Auto-Tap (CR 601.2g / 605.3a: the player
 * activates mana abilities while paying) admits exactly that source among the
 * sacrifice mana abilities: a Black Lotus or a Lion's Eye Diamond is a card,
 * never a token, and stays manual.
 *
 * Read off the live instance (`types` / `subtypes` / `counters` /
 * `staticAbilities` carry the layered characteristics) plus the post-layer
 * activated and triggered ability readers, so a granted ability or an added
 * card type counts the moment it applies.
 */

/** CR 111.10a — the permanent is a Treasure token. */
export function isTreasureToken(card: CardInstanceState): boolean {
    return card.isToken === true && card.subtypes.includes("Treasure");
}

/** CR 111.10a — does this Treasure carry anything worth keeping beyond the
 *  mana its own ability makes? A positive extra is:
 *   - a counter other than a -1/-1 counter (CR 122.1);
 *   - an Aura or Equipment attached to it that its controller controls
 *     (CR 303.4 / 301.5), read off `battlefield`, the controller's own board;
 *   - a card type beyond Artifact (CR 205.2a — an animated Treasure is a
 *     creature too);
 *   - an activated, triggered or static ability beyond its own mana ability.
 *  A Treasure whose only extras are drawbacks (a -1/-1 counter, an opponent's
 *  Aura) has none. Auto-Tap sacrifices a Treasure without one first. */
export function treasureHasPositiveExtra(
    card: CardInstanceState,
    battlefield: readonly CardInstanceState[]
): boolean {
    for (const [kind, count] of Object.entries(card.counters ?? {})) {
        if (count > 0 && kind !== "-1/-1") return true;
    }
    const attachedOwnAuraOrEquipment = battlefield.some(
        (other) =>
            other.attachedTo === card.id &&
            other.controllerId === card.controllerId &&
            (other.subtypes.includes("Aura") ||
                other.subtypes.includes("Equipment"))
    );
    if (attachedOwnAuraOrEquipment) return true;
    if (card.types.some((type) => type !== "Artifact")) return true;
    if (getEffectiveActivatedAbilities(card).length > 1) return true;
    if (effectiveTriggeredAbilities(card).length > 0) return true;
    if (card.staticAbilities.length > 0) return true;
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    return (def?.staticEffects?.length ?? 0) > 0;
}
