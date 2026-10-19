import type { ActivatedAbility } from "../cards/types";
import { compileEffectScript } from "./effects/interpreter";
import type { ManaAbilityEffectOp } from "./effects/manaAbilityEffectOps";
import { buildSpellContext } from "./state";
import type { CardInstanceState, GameState, StackItem } from "./state";
import { restoreReturnMarkOnUntap } from "./untapReturn";

/** CR 605.1a / 605.3b (issue #5509) — runs a tap mana ability's stackless
 *  Effect Script (`ActivatedAbility.manaAbilityEffects`) as part of the SAME
 *  mana ability resolving: no stack item is created and no priority passes.
 *  The interpreter reads a SpellContext, so it is handed a throwaway item
 *  shaped like the activated ability's own stack object would be — the source
 *  card, controlled by the activator — which makes `$source` the source and
 *  `ctx.controller` the activator, exactly as at the stack site. The item is
 *  never pushed. The validator admits only `MANA_ABILITY_EFFECT_OPS` here, so
 *  the script raises no choice that would need the item to persist.
 *
 *  Shared by every tap-for-mana path, beside `applyDrawCardOnTap`. No-op when
 *  the ability has no such script; an Op naming a source that has left (a
 *  sacrifice cost) skips itself (CR 608.2b). */
export function applyManaAbilityEffects(
    state: GameState,
    ability: ActivatedAbility | undefined | null,
    card: CardInstanceState,
    activatorId: string
): void {
    const effects = ability?.manaAbilityEffects;
    if (!effects || effects.length === 0) return;
    const item: StackItem = { ...card, castById: activatorId };
    compileEffectScript(effects)(buildSpellContext(state, item));
}

/** CR 106.4 — the reversal of each admitted Op, run when the tap that
 *  resolved the mana ability is undone. Keyed by `ManaAbilityEffectOp`, so an
 *  Op admitted at the site without a reversal reds `check:ts`. */
const MANA_ABILITY_EFFECT_REVERSALS: {
    readonly [K in ManaAbilityEffectOp]: (card: CardInstanceState) => void;
} = {
    returnToHandAtNextUntap: restoreReturnMarkOnUntap,
};

/** CR 106.4 — reversing a tap-for-mana (the untap toggle,
 *  `untapSourceFromPayment`, `rollbackPendingCast`, `untapForPayment`) undoes
 *  the whole mana ability, so whatever its stackless Effect Script did goes
 *  with it. Shared by every reversal path beside `restoreExertOnUntap`. */
export function reverseManaAbilityEffectsOnUntap(
    card: CardInstanceState
): void {
    for (const reverse of Object.values(MANA_ABILITY_EFFECT_REVERSALS)) {
        reverse(card);
    }
}
