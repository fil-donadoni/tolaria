// Monocolour hybrid mana ({2/W}) — cost-system infrastructure, NOT an Effect
// Script Op and NOT a Mechanics Registry keyword. CR 107.4e: a hybrid mana
// symbol "can be paid with either of the two indicated mana types"; for
// `{2/W}` those are one white mana or two generic mana. A card declares them in
// `ManaCost.hybridGeneric`. Which leg each pip takes depends on the mana the
// caster has, so the affordability solver (`solveHybridGenericLegs`) lives in
// `rules.ts` beside the mana model it reuses; this module holds the pure
// representation helpers.
import type { ManaCost } from "../cards/types";

/** Number of monocolour hybrid pips in a cost (Spectral Procession → 3). Zero
 *  for every other cost, so callers can cheaply branch on `> 0`. */
export function hybridGenericPipCount(cost?: ManaCost): number {
    return cost?.hybridGeneric?.length ?? 0;
}

/** CR 107.4e / 601.2b — fold the caster's leg per `{N/C}` pip into ordinary
 *  pips. `colorLegs[i]` true pays pip `i` with one mana of its colour, false
 *  with its `generic` mana. The result carries no `hybridGeneric`, so it
 *  normalizes and pays like any printed cost; the input is not mutated. */
export function foldHybridGenericLegs(
    cost: ManaCost,
    colorLegs: readonly boolean[]
): ManaCost {
    const folded: ManaCost = { ...cost };
    delete folded.hybridGeneric;
    let generic = folded.generic ?? 0;
    (cost.hybridGeneric ?? []).forEach((pip, i) => {
        if (colorLegs[i]) folded[pip.color] = (folded[pip.color] ?? 0) + 1;
        else generic += pip.generic;
    });
    if (generic > 0) folded.generic = generic;
    return folded;
}
