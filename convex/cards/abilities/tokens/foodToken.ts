// The Food token (CR 707.2) — shared spec for the "create a Food token"
// clause (issue #778, engine infra; no catalogue producer required yet). A
// colorless artifact token with subtype Food and the activated ability "{2},
// {T}, Sacrifice this token: Gain 3 life." Mirrors `CLUE_TOKEN_SPEC` /
// `BLOOD_TOKEN_SPEC`'s "one canonical spec, every producer shares it" shape.

import type {
    EffectOp,
    EffectPlayerRef,
    EffectTokenSpec,
    EffectValue,
} from "../../types";

/** The Food token's `EffectTokenSpec` (CR 707.2). Colorless artifact,
 *  subtype Food, one activated ability: "{2}, {T}, Sacrifice this token:
 *  Gain 3 life." — `cost.mana: { generic: 2 }` is the {2} generic cost,
 *  `cost.tap: true` taps the token, `cost.sacrifice: true` sacrifices the
 *  ability's own source (the token itself, CR 602.1). The DSL-only
 *  `effects: [{ op: "gainLife", ... }]` body gains 3 life for the
 *  activating controller. No `imagePrintId` — no Food print is wired into
 *  `tokenPrintLookup.ts` yet; the renderer falls back to the in-app
 *  placeholder (name/abilities), same as Clue/Blood. */
export const FOOD_TOKEN_SPEC: EffectTokenSpec = {
    name: "Food",
    types: ["Artifact"],
    subtypes: ["Food"],
    activatedAbilities: [
        {
            id: "sacrifice-gain-life",
            oracleText: "{2}, {T}, Sacrifice this token: Gain 3 life.",
            cost: { mana: { generic: 2 }, tap: true, sacrifice: true },
            useStack: true,
            effects: [{ op: "gainLife", player: "controller", amount: 3 }],
        },
    ],
};

/** Sugar for "create a Food token" as an Effect Script Op: create one Food
 *  token (`FOOD_TOKEN_SPEC`) for `controller` (default the resolving
 *  controller, CR 111.2). `count` allows "create N Food tokens" the same
 *  way `investigateOp` allows Investigate N. */
export function createFoodTokenOp(
    controller: EffectPlayerRef = "controller",
    count?: EffectValue
): EffectOp {
    return {
        op: "createToken",
        token: FOOD_TOKEN_SPEC,
        controller,
        ...(count !== undefined ? { count } : {}),
    };
}
