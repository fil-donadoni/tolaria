// Battlefield-scanned "<spells> can't be countered" — the
// `spell-counter-immunity` StaticEffect (`cards/types.ts`
// StaticSpellCounterImmunity).
//
// CR 701.6a — to counter a spell is to remove it from the stack. CR 101.2 —
// when an effect directs something to happen and another says it can't, the
// "can't" wins: a counter aimed at a covered spell does nothing, while the
// spell stays a legal target (targeting is not countering).
//
// Read-time only, like `cast-restriction`: nothing is stamped onto the spell,
// so the protection lasts exactly as long as a source sits on the battlefield
// with its abilities (CR 611.3b; a source that lost all its abilities,
// CR 613.1f, protects nothing).

import { tryGetDefinition } from "../cards";
import { getEffectiveColors } from "../cards/effectiveColors";
import { matchesSpellFilter } from "../cards/filters";
import { abilitiesSuppressed, isSpellStackItem } from "./constants";
import type { GameState, StackItem } from "./state";
import { getEffectiveStaticEffects } from "./state";

/** The battlefield permanent whose `spell-counter-immunity` static covers
 *  `spell`, or `undefined` when none does (or `spell` is an ability — the
 *  Oracle says "spells", CR 113.9). Matches the spell's CURRENT stack
 *  characteristics (`types` / `subtypes` on the stack item, layer-5 colours),
 *  not the printed card's. */
export function spellCounterImmunitySource(
    state: Pick<GameState, "players">,
    spell: StackItem
): string | undefined {
    if (!isSpellStackItem(spell)) return undefined;
    const subject = {
        types: spell.types,
        subtypes: spell.subtypes,
        colors: getEffectiveColors(spell),
    };
    for (const player of state.players) {
        for (const source of player.battlefield) {
            if (abilitiesSuppressed(source)) continue;
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            for (const effect of getEffectiveStaticEffects(
                def,
                source.chosenModeId
            )) {
                if (effect.kind !== "spell-counter-immunity") continue;
                // CR 601.2a — the caster is the spell's controller.
                if (
                    effect.controlledBy === "controller" &&
                    spell.castById !== source.controllerId
                ) {
                    continue;
                }
                if (
                    effect.spells !== undefined &&
                    !matchesSpellFilter(subject, effect.spells)
                ) {
                    continue;
                }
                return source.id;
            }
        }
    }
    return undefined;
}
