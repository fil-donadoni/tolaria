/**
 * Transform / double-faced permanents (CR 712, CR 701.27, ADR 0067, issue
 * #1210).
 *
 * A double-faced permanent has two DISTINCT printed characteristic sets —
 * front and back — unlike a face-down morph permanent (CR 707.4,
 * `faceDown.ts`), which hides a single REAL identity behind a generic 2/2.
 * Transform information is always PUBLIC (CR 712.1a): both players know
 * both faces, so (unlike `faceDown`) there is no per-viewer hiding at the
 * projection boundary (`gameProjections.ts`) — `slimCard`'s default
 * pass-through already ships `transformed`/`transformedFrom` identically to
 * both players.
 *
 * Scoped to what CR 712 needs for a permanent-level transform primitive:
 * only a permanent ALREADY on the battlefield transforms today (a paid
 * activated-ability cost, "{2}: Transform this artifact", CR 701.27b — the
 * Incubator token shape, CR 701.53 Incubate). A full two-sided-card CASTING
 * model (choosing which face to cast, a distinct mana cost per face, CR 711)
 * is out of scope.
 *
 * Mirrors `faceDown.ts`'s definition-swap pattern: rather than gate every
 * def-derived reader on a `transformed` flag, the instance's `card.card.id`
 * is swapped to a registered back-face `CardDefinition` and the stored
 * mutable characteristic fields (`types`/`subtypes`/`power`/`toughness`/
 * `staticAbilities`) are overwritten to match, so every existing reader
 * (layers, combat, activated-ability discovery, SBA creature-ness checks)
 * observes the new face automatically — no new "effective card" seam needed.
 * The FRONT face's own definition id is retained in `transformedFrom` so a
 * later flip restores it (CR 712.8a — transform is a toggle: the SAME
 * primitive flips either direction).
 *
 * The back-face definition is registered through the SAME
 * `tokenDefinitionId` + `registerTokenDefinition` codec a front-face token
 * uses (`convex/cards/index.ts`) — not a bespoke id format — so the id
 * itself is `token:...`-shaped and the client's EXISTING lazy synthesizer
 * (`maybeSynthesizeToken`) decodes a transformed permanent's new face for
 * free. A second, parallel codec would leave the client unable to resolve
 * the swapped `card.card.id` (no name/art) the moment a permanent transforms.
 */

import {
    registerTokenDefinition,
    tokenDefinitionId,
    tryGetDefinition,
} from "../cards";
import { resolveTokenStaticEffects } from "../cards/tokenStaticEffects";
import type { CardBackFace, ManaCost, TokenSpec } from "../cards/types";
import type { CardInstanceState } from "./state";

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
 *  what makes `tokenDefinitionId` below fold it into the content-derived
 *  id — the wire `card.card.id` a CLIENT decodes independently, with no
 *  server-side registration call ever reaching it (`transformPermanent`
 *  runs server-side only). Without this, `maybeSynthesizeToken`'s
 *  from-scratch decode has no way to know the face was "back". */
function backFaceAsTokenSpec(backFace: CardBackFace): TokenSpec {
    return {
        name: backFace.name,
        types: backFace.types,
        subtypes: backFace.subtypes,
        supertypes: backFace.supertypes,
        power: backFace.power,
        toughness: backFace.toughness,
        colors: backFace.colors,
        staticAbilities: backFace.staticAbilities,
        staticEffectKeys: backFace.staticEffectKeys,
        activatedAbilities: backFace.activatedAbilities,
        imagePrintId: backFace.imagePrintId,
        ...(backFace.imagePrintId ? { imagePrintFace: "back" as const } : {}),
    };
}

/** Registers (idempotently, `registerTokenDefinition`) a synthesized
 *  `CardDefinition` for `backFace` and returns its id. Two permanents
 *  transforming from the SAME front definition with the SAME back-face spec
 *  share one entry (`tokenDefinitionId`'s content-hash convention). */
function registerBackFaceDefinition(backFace: CardBackFace): string {
    const spec = backFaceAsTokenSpec(backFace);
    const id = tokenDefinitionId(spec);
    // Server-side color (`getCardColors`) is derived from `manaCost`, not
    // from `spec.colors` directly — mirrors `createTokenPermanents`
    // (`gre/state.ts`), which builds a one-pip-per-color `manaCost` from
    // `spec.colors` for the exact same reason. Without this, a COLORED back
    // face (e.g. a black werewolf) registers as colorless server-side while
    // the client's `maybeSynthesizeToken` rebuilds color from the encoded
    // id — a server/client color divergence (issue #1210 review).
    const manaCost: ManaCost = {};
    for (const c of spec.colors ?? []) {
        manaCost[c] = (manaCost[c] ?? 0) + 1;
    }
    const backFaceStaticEffects = resolveTokenStaticEffects(
        spec.staticEffectKeys
    );
    registerTokenDefinition({
        id,
        name: spec.name,
        // Rarity is a property of a printing (CR 206); a synthesized back
        // face is not itself a printed object, so a nominal "common"
        // satisfies the required field (mirrors token synthesis).
        rarity: "common",
        manaCost,
        types: [...spec.types],
        ...(spec.subtypes ? { subtypes: [...spec.subtypes] } : {}),
        ...(spec.supertypes ? { supertypes: [...spec.supertypes] } : {}),
        power: spec.power,
        toughness: spec.toughness,
        ...(spec.staticAbilities
            ? { staticAbilities: [...spec.staticAbilities] }
            : {}),
        ...(spec.activatedAbilities
            ? { activatedAbilities: [...spec.activatedAbilities] }
            : {}),
        // CR 611 — rebuilt from the spec's keys through the shared factory
        // table, the same call `maybeSynthesizeToken` makes decoding `id`.
        ...(backFaceStaticEffects.length > 0
            ? { staticEffects: backFaceStaticEffects }
            : {}),
        ...(backFace.oracleText ? { oracleText: backFace.oracleText } : {}),
        // issue #1595 — read back off `spec` (never re-derived ad hoc here):
        // `spec.imagePrintFace` is the SAME value `tokenDefinitionId(spec)`
        // already folded into `id` above, so this server-side registration
        // and the id a client independently decodes always agree.
        ...(spec.imagePrintId ? { imagePrintId: spec.imagePrintId } : {}),
        ...(spec.imagePrintFace ? { imagePrintFace: spec.imagePrintFace } : {}),
    });
    return id;
}

/** Transforms `card` in place (CR 701.27 / 712): flips it to its back face
 *  if currently showing front, or back to front if already transformed (CR
 *  712.8a — the SAME primitive flips either direction). No-op when the
 *  permanent's CURRENT face declares no `backFace` to flip to (front → back)
 *  or when `transformedFrom` is missing/unregistered (back → front,
 *  shouldn't happen in practice — `transformedFrom` is only ever set by this
 *  same function to a definition id it just resolved). */
export function transformPermanent(card: CardInstanceState): void {
    if (!card.transformed) {
        const frontId = (card.card as { id?: string }).id;
        if (!frontId) return;
        const frontDef = tryGetDefinition(frontId);
        const backFace = frontDef?.backFace;
        if (!backFace) return; // CR 712 — nothing to transform into.
        const backId = registerBackFaceDefinition(backFace);
        card.transformedFrom = frontId;
        card.card = { id: backId };
        card.types = [...backFace.types];
        card.subtypes = backFace.subtypes ? [...backFace.subtypes] : [];
        card.power = backFace.power;
        card.toughness = backFace.toughness;
        card.staticAbilities = backFace.staticAbilities
            ? [...backFace.staticAbilities]
            : [];
        card.transformed = true;
    } else {
        const frontId = card.transformedFrom;
        if (!frontId) return;
        const frontDef = tryGetDefinition(frontId);
        if (!frontDef) return;
        card.card = { id: frontId };
        card.types = [...frontDef.types];
        card.subtypes = frontDef.subtypes ? [...frontDef.subtypes] : [];
        card.power = frontDef.power;
        card.toughness = frontDef.toughness;
        card.staticAbilities = frontDef.staticAbilities
            ? [...frontDef.staticAbilities]
            : [];
        delete card.transformed;
        delete card.transformedFrom;
    }
}
