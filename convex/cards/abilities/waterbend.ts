// Waterbend (CR 701.67).
//
// CR 701.67a — "'Waterbend [cost]' means 'Pay [cost]. For each generic mana in
//              that cost, you may tap an untapped artifact or creature you
//              control rather than pay that mana.'"
// CR 701.67b — the alternate method pays only the generic mana in the waterbend
//              cost, even if the total cost includes other generic mana.
//
// The substitution rides the tap-other picker (`gre/tapOtherCost.ts`), in the
// shape that owes nothing and pays a generic pip per pick.

import type { ActivatedAbility, ManaCost } from "../types";

/** The cost of "Waterbend {N}" on an activated ability, optionally beside the
 *  ability's OTHER mana (`rest`), whose generic is never substitutable
 *  (CR 701.67b). */
export function waterbendCost(
    generic: number,
    rest: Omit<ManaCost, "X"> & { X?: number } = {}
): ActivatedAbility["cost"] {
    return {
        mana: { ...rest, X: generic + (rest.X ?? 0) },
        tapOtherFilter: {
            filter: {
                types: ["Artifact", "Creature"],
                controllerRelation: "you",
            },
            substitutesGeneric: generic,
        },
    };
}
