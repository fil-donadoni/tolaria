// The Map token (CR 111.10) — shared spec for every card that creates one.
// A Map is a colorless Map artifact token with "{1}, {T}, Sacrifice this
// token: Target creature you control explores. Activate only as a sorcery."
//
// This is exactly a `createToken` Op (CR 111 / 707.2) with an
// `EffectTokenSpec` carrying a token-scoped `activatedAbilities[]` — the
// Clue / Food / Blood shape (`clueToken.ts`, issue #1191). No dedicated
// "create a Map" Op exists or is needed ("generalize, don't add"). Every Map
// producer shares this ONE spec, so their Maps share one synthesized token
// definition (`tokenDefinitionId` is content-derived) and one client-side
// rehydration path.
//
// The ability is the FIRST token-scoped ability in the catalogue that both
// TARGETS and carries a timing restriction, which is why issue #2376 had to
// widen `isTokenActivatedAbility`'s allowlist (`gre/effects/validate.ts`) to
// admit `targetRequirement` and `sorcerySpeedOnly`. Both are plain data, so
// the spec still survives the JSON-purity sweep (ADR 0046).

import type {
    EffectOp,
    EffectPlayerRef,
    EffectTokenSpec,
    EffectValue,
} from "../../types";

/** The Map token's `EffectTokenSpec` (CR 111.10). Colorless artifact, subtype
 *  Map, one activated ability: "{1}, {T}, Sacrifice this token: Target
 *  creature you control explores. Activate only as a sorcery."
 *
 *  - `cost: { mana: { generic: 1 }, tap: true, sacrifice: true }` — the {1},
 *    the {T} and the "Sacrifice this token" leg, which sacrifices the
 *    ability's OWN source (CR 602.1), exactly `FOOD_TOKEN`'s cost shape.
 *  - `useStack: true` — not a mana ability (CR 605.1a), so it uses the stack
 *    and can be responded to.
 *  - `targetRequirement: { type: "Creature", count: 1, controller: "you" }` —
 *    "target creature YOU control" (CR 115.1), announced at activation.
 *  - `sorcerySpeedOnly: true` — "Activate only as a sorcery" (CR 602.3b via
 *    307.5's timing template).
 *  - `effects: [{ op: "explore", target: { target: 0 } }]` — the announced
 *    creature explores (CR 701.44).
 *
 *  `colors` omitted = colorless (CR 105.2 / 110.5); `Map` is an ARTIFACT
 *  subtype (CR 205.3g), never a creature type, so the token has no P/T. */
export const MAP_TOKEN_SPEC: EffectTokenSpec = {
    name: "Map",
    types: ["Artifact"],
    subtypes: ["Map"],
    activatedAbilities: [
        {
            id: "map-token-sacrifice-explore",
            oracleText:
                "{1}, {T}, Sacrifice this token: Target creature you control explores. Activate only as a sorcery.",
            cost: { mana: { generic: 1 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            sorcerySpeedOnly: true,
            effects: [{ op: "explore", target: { target: 0 } }],
        },
    ],
    // Real printed Map token art (tlci #17, the LCI token set the Map was
    // printed in). Pinned rather than left to the per-producer reverse-link:
    // every Map in the game is the same object, and `tokenPrintLookup`'s
    // producer-printing rule has nothing to resolve for a token whose only
    // producers are themselves LCI cards.
    imagePrintId: "64839118-09d2-4645-9d3c-f80755ac781f",
};

/** Sugar for "create a Map token" (CR 111.10) as an Effect Script Op: create
 *  one Map (`MAP_TOKEN_SPEC`) for `controller` (default the resolving
 *  controller, CR 111.2). `count` expresses "create N Map tokens" (Get Lost's
 *  two); omit for a single Map. */
export function createMapTokenOp(
    controller: EffectPlayerRef = "controller",
    count?: EffectValue
): EffectOp {
    return {
        op: "createToken",
        token: MAP_TOKEN_SPEC,
        controller,
        ...(count !== undefined ? { count } : {}),
    };
}
