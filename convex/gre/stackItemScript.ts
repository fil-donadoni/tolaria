// The Effect Script an object on the stack resolves through, read off its
// definition. A leaf module on purpose: the search, the client Bot view and
// the resolution-checkpoint lowering all read it, and only the last needs the
// static validator beside it.

import type { CardDefinition, EffectOp } from "../cards/types";
import { tryGetDefinition } from "../cards";
import type { StackItem } from "./state";

/** The Effect Script an object on the stack resolves through, read off its
 *  definition: the card's own for a spell, the named ability's for an
 *  activated or triggered ability. `undefined` for an imperative body, a
 *  granted or engine-synthesised ability, or a definition the catalogue does
 *  not hold. A chosen MODE's script is not looked up. */
export function effectScriptOfStackItem(
    item: Pick<StackItem, "abilityId" | "triggeredAbilityId"> & {
        card: StackItem["card"] | { id?: string };
    }
): EffectOp[] | undefined {
    const cardId = (item.card as { id?: string }).id;
    const def: CardDefinition | undefined = cardId
        ? (tryGetDefinition(cardId) ?? undefined)
        : undefined;
    if (!def) return undefined;
    if (item.abilityId !== undefined) {
        return def.activatedAbilities?.find((a) => a.id === item.abilityId)
            ?.effects;
    }
    if (item.triggeredAbilityId !== undefined) {
        return def.triggeredAbilities?.find(
            (a) => a.id === item.triggeredAbilityId
        )?.effects;
    }
    return def.effects;
}
