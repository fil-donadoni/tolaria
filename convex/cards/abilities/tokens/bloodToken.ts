// The Blood token (CR 707.2) — shared spec for the "create a Blood token"
// clause (Voldaren Epicure, vow/red.ts). A colorless artifact token with
// subtype Blood and the activated ability "{1}, {T}, Discard a card,
// Sacrifice this token: Draw a card." Every printed Blood producer creates
// this EXACT spec, so their Bloods share one synthesized token definition
// (`tokenDefinitionId` is content-derived) and one client-side rehydration
// path — same "one canonical spec" discipline as `CLUE_TOKEN_SPEC`.
//
// Unblocked by issue #778 widening `TOKEN_ABILITY_COST_KEYS` /
// `isTokenAbilityCost` (`gre/effects/validate.ts`) to accept a token-scoped
// ability's `discardFilter` cost leg — Blood is the first token to combine
// FOUR cost legs (`mana`, `tap`, `discardFilter`, `sacrifice`) on one
// ability; each leg is already a real `ActivatedAbility.cost` primitive
// (Arc Mage — nem/red.ts — already combines `mana`+`tap`+`discardFilter` on a
// printed card's ability), so no new primitive was needed, only the token
// spec's allow-list catching up to what `ActivatedAbility.cost` already
// supports.

import type {
    EffectOp,
    EffectPlayerRef,
    EffectTokenSpec,
    EffectValue,
} from "../../types";

/** The Blood token's `EffectTokenSpec` (CR 707.2). Colorless artifact,
 *  subtype Blood, one activated ability: "{1}, {T}, Discard a card,
 *  Sacrifice this token: Draw a card." — `cost.mana: { generic: 1 }` is the
 *  {1} generic cost, `cost.tap: true` taps the token, `cost.discardFilter:
 *  { filter: {}, count: 1 }` is "discard a card" (a match-all filter, the
 *  same shape Arc Mage's "discard a card" leg uses — nem/red.ts), and
 *  `cost.sacrifice: true` sacrifices the ability's own source (the token
 *  itself, CR 602.1). The DSL-only `effects: [{ op: "draw", ... }]` body
 *  draws one card for the activating controller. No `imagePrintId` — no
 *  Blood print is wired into `tokenPrintLookup.ts` yet; the renderer falls
 *  back to the in-app placeholder (name/abilities), same as Clue. */
export const BLOOD_TOKEN_SPEC: EffectTokenSpec = {
    name: "Blood",
    types: ["Artifact"],
    subtypes: ["Blood"],
    activatedAbilities: [
        {
            id: "sacrifice-discard-draw",
            oracleText:
                "{1}, {T}, Discard a card, Sacrifice this token: Draw a card.",
            cost: {
                mana: { generic: 1 },
                tap: true,
                discardFilter: { filter: {}, count: 1 },
                sacrifice: true,
            },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

/** Sugar for "create a Blood token" as an Effect Script Op: create one Blood
 *  token (`BLOOD_TOKEN_SPEC`) for `controller` (default the resolving
 *  controller, CR 111.2). `count` allows "create N Blood tokens" the same
 *  way `investigateOp` allows Investigate N. */
export function createBloodTokenOp(
    controller: EffectPlayerRef = "controller",
    count?: EffectValue
): EffectOp {
    return {
        op: "createToken",
        token: BLOOD_TOKEN_SPEC,
        controller,
        ...(count !== undefined ? { count } : {}),
    };
}
