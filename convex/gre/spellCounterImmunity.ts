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
//
// Its SOURCE-LESS twin, `isSpellCounterImmuneThisTurn`, reads the turn-scoped
// effect a resolved spell or ability created ("Spells you control can't be
// countered this turn", CR 611.2a): no permanent carries it, so it lives on
// `GameState.spellCounterImmunityThisTurn` until CLEANUP (CR 514.2).

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
    const playerList = state.players;
    for (let i = 0; i < playerList.length; i++) {
        const player = playerList[i];
        const sourceList = player.battlefield;
        for (let j = 0; j < sourceList.length; j++) {
            const source = sourceList[j];
            if (abilitiesSuppressed(source)) continue;
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            const effectList = getEffectiveStaticEffects(
                def,
                source.chosenModeId
            );
            for (let k = 0; k < effectList.length; k++) {
                const effect = effectList[k];
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

/** CR 611.2a / 611.2c / 101.2 — true when `spell` is covered by a turn-scoped
 *  "Spells you control can't be countered this turn": its controller is on
 *  `state.spellCounterImmunityThisTurn`. A rules-modifying effect (CR 611.2c),
 *  so the set of spells is read now, not fixed when the effect began — a spell
 *  cast after it is covered too. An ability is never covered (CR 113.9 — the
 *  text says "spells"). */
export function isSpellCounterImmuneThisTurn(
    state: Pick<GameState, "spellCounterImmunityThisTurn">,
    spell: StackItem
): boolean {
    if (!isSpellStackItem(spell)) return false;
    return (
        state.spellCounterImmunityThisTurn?.includes(spell.controllerId) ??
        false
    );
}
