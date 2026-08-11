// The Clue token (CR 701.16a) — shared spec for `investigate`. To
// investigate, a player creates a colorless artifact token with subtype Clue
// and the ability "{2}, Sacrifice this token: Draw a card." ("Investigate N"
// is N separate token creations, CR 701.16a — expressed by a `createToken`
// Op with `count: N`, not a card-specific primitive).
//
// This is exactly a `createToken` Op (CR 111 / 701.7) with an `EffectTokenSpec`
// that now carries a token-scoped `activatedAbilities[]` (issue #1191 — the
// gap that blocked this keyword, Magda's Treasures #778, Voldaren Epicure's
// Blood token, and Sunfall's Incubate #1210 alike). No dedicated `investigate`
// Op exists or is needed: "investigate" IS `{ op: "createToken", token:
// CLUE_TOKEN_SPEC, controller }`, matching the "generalize, don't add"
// primitive-reuse mandate. Every future Investigate source shares this ONE
// spec, so their Clues share one synthesized token definition
// (`tokenDefinitionId` is content-derived) and one client-side rehydration
// path.

import type {
    EffectOp,
    EffectPlayerRef,
    EffectTokenSpec,
    EffectValue,
} from "../../types";

/** The Clue token's `EffectTokenSpec` (CR 701.16a). Colorless artifact,
 *  subtype Clue, one activated ability: "{2}, Sacrifice this token: Draw a
 *  card." — `cost.sacrifice: true` sacrifices the ability's own source (the
 *  token itself, CR 602.1), `cost.mana: { generic: 2 }` is the {2} generic
 *  cost, and the DSL-only `effects: [{ op: "draw", ... }]` body draws one
 *  card for the activating controller. No `imagePrintId` — no Clue print is
 *  wired into `tokenPrintLookup.ts` yet; the renderer falls back to the
 *  in-app placeholder (name/abilities), same as every other token without a
 *  registered print. */
export const CLUE_TOKEN_SPEC: EffectTokenSpec = {
    name: "Clue",
    types: ["Artifact"],
    subtypes: ["Clue"],
    activatedAbilities: [
        {
            id: "sacrifice-draw",
            oracleText: "{2}, Sacrifice this token: Draw a card.",
            cost: { mana: { generic: 2 }, sacrifice: true },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

/** Sugar for "investigate" (CR 701.16 keyword action) as an Effect Script Op:
 *  create one Clue token (`CLUE_TOKEN_SPEC`) for `controller` (default the
 *  resolving controller, CR 111.2). `count` expresses "investigate N"
 *  (CR 701.16a — N separate Clue tokens); omit for a plain "investigate". */
export function investigateOp(
    controller: EffectPlayerRef = "controller",
    count?: EffectValue
): EffectOp {
    return {
        op: "createToken",
        token: CLUE_TOKEN_SPEC,
        controller,
        ...(count !== undefined ? { count } : {}),
    };
}
