// The one reshaping of a printed `CardBackFace` into the `TokenSpec` whose
// content-derived id (`tokenDefinitionId`) a transformed permanent presents
// (CR 712.2 / 701.27, ADR 0067).
//
// Lives in `cards/` (types only, no engine imports) because TWO readers must
// agree on it byte for byte: `gre/transform.ts`, which registers the back-face
// definition when a permanent transforms, and `cards/registry.ts`, which on a
// cold decode of that id (issue #3249) looks the printed back face back up to
// recover the closures a string cannot carry. A second copy of this function
// would be a second id for one face.
import type { CardBackFace, TokenSpec } from "./types";

/** Reshapes a `CardBackFace` into the `TokenSpec` shape `tokenDefinitionId`
 *  expects (same field vocabulary minus `entersWith`/`backFace` — a back
 *  face is never itself given a further back face).
 *
 *  Stamps `imagePrintFace: "back"` (issue #1595) whenever the back face
 *  carries its own `imagePrintId` — a real double-faced Scryfall print
 *  shares ONE id across both faces (the Incubator/Phyrexian token,
 *  `cards/abilities/tokens/incubatorToken.ts`), each served under its own
 *  `front/`/`back/` CDN path. Setting it HERE, on the `TokenSpec` itself
 *  (not as an ad-hoc extra field on the registered `CardDefinition`), is
 *  what makes `tokenDefinitionId` fold it into the content-derived id — the
 *  wire `card.card.id` a CLIENT decodes independently, with no server-side
 *  registration call ever reaching it (`transformPermanent` runs server-side
 *  only). Without this, `maybeSynthesizeToken`'s from-scratch decode has no
 *  way to know the face was "back". */
export function backFaceAsTokenSpec(backFace: CardBackFace): TokenSpec {
    return {
        name: backFace.name,
        types: backFace.types,
        subtypes: backFace.subtypes,
        supertypes: backFace.supertypes,
        power: backFace.power,
        toughness: backFace.toughness,
        // CR 306.5b (issue #2380) — a PLANESWALKER back face's starting
        // loyalty rides the spec (and therefore the content-derived id) so
        // the CR 306.5b entry placement finds it on the synthesized
        // definition, however that definition was obtained: the
        // server-side registration, or a decode-only rebuild
        // (`maybeSynthesizeToken`) in a cold isolate / client engine run.
        loyalty: backFace.loyalty,
        colors: backFace.colors,
        staticAbilities: backFace.staticAbilities,
        staticEffectKeys: backFace.staticEffectKeys,
        activatedAbilities: backFace.activatedAbilities,
        // CR 712.8e (issue #3249) — the back face's triggered abilities ride
        // the id by `id`/`oracleText`/`event`/`effects`, exactly as a token's
        // do; the closures are recovered from the printed card on a cold
        // decode.
        triggeredAbilities: backFace.triggeredAbilities,
        imagePrintId: backFace.imagePrintId,
        ...(backFace.imagePrintId ? { imagePrintFace: "back" as const } : {}),
    };
}
