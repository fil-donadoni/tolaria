import type { EffectOp } from "../../cards/types";

/** The Ops a mana ability's stackless Effect Script
 *  (`ActivatedAbility.manaAbilityEffects`, issue #5509) may hold. A mana
 *  ability resolves immediately, off the stack (CR 605.3b), and never requires
 *  a target (CR 605.1a), so each admitted Op raises no resolution choice and
 *  reads no announced slot; each also has a reversal in
 *  `MANA_ABILITY_EFFECT_REVERSALS` (`gre/manaAbilityEffects.ts`), so the
 *  untap-toggle that refunds the mana (CR 106.4) undoes the effect too. The
 *  constructs (`bind`, `if`, `forEach`) are not admitted. Pure data, so the
 *  validator reads it without importing the engine. */
export const MANA_ABILITY_EFFECT_OPS = [
    "returnToHandAtNextUntap",
] as const satisfies readonly EffectOp["op"][];

export type ManaAbilityEffectOp = (typeof MANA_ABILITY_EFFECT_OPS)[number];

const ADMITTED: ReadonlySet<string> = new Set(MANA_ABILITY_EFFECT_OPS);

export function isManaAbilityEffectOp(op: string): op is ManaAbilityEffectOp {
    return ADMITTED.has(op);
}
