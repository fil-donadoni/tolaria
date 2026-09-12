/**
 * Transform / double-faced permanents (CR 712, CR 701.27, ADR 0067, issue
 * #1210).
 *
 * A double-faced permanent has two DISTINCT printed characteristic sets —
 * front and back — unlike a face-down morph permanent (CR 707.4,
 * `faceDown.ts`), which hides a single REAL identity behind a generic 2/2.
 * Transform information is always PUBLIC (CR 712.6): both players know
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
import {
    isModalDoubleFaced,
    isPermanentTypeLine,
    modalBackFaceDefinitionId,
} from "../cards/modalDfc";
import { rebuildCopiableValuesAndReplayOverlays } from "./identitySwap";
import type { CardInstanceState } from "./state";
import type { LayerStateView } from "./layers";

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
        // CR 306.5b (issue #2380) — a PLANESWALKER back face's starting
        // loyalty rides the spec (and therefore the content-derived id) so
        // the CR 306.5b entry placement finds it on the synthesized
        // definition, however that definition was obtained: the
        // server-side registration below, or a decode-only rebuild
        // (`maybeSynthesizeToken`) in a cold isolate / client engine run.
        loyalty: backFace.loyalty,
        colors: backFace.colors,
        staticAbilities: backFace.staticAbilities,
        staticEffectKeys: backFace.staticEffectKeys,
        activatedAbilities: backFace.activatedAbilities,
        imagePrintId: backFace.imagePrintId,
        ...(backFace.imagePrintId ? { imagePrintFace: "back" as const } : {}),
    };
}

/** The content-derived definition id a NONMODAL back face presents (CR 712.2)
 *  — the id half of {@link registerBackFaceDefinition}, split out so a reader
 *  can ask "is this def id that card's back face?" without minting a
 *  definition as a side effect ({@link backFaceDefinitionIdOf}). One authority
 *  on the codec: both callers go through here. */
function nonmodalBackFaceDefinitionId(backFace: CardBackFace): string {
    return tokenDefinitionId(backFaceAsTokenSpec(backFace));
}

/** CR 712.2 / 712.8f — the definition id `frontId` presents while TRANSFORMED,
 *  or `undefined` when that card has no back face. PURE: unlike
 *  `registerBackFaceDefinition` it registers nothing, so asking the question is
 *  free of side effects.
 *
 *  Exists for the CR 603.10 look-back (`lookBackSelf`, `gre/copy.ts`), which
 *  has to tell a departed permanent's THREE possible identity reversions apart
 *  — copy, transform, face-down — from the definition id it presented as it
 *  left, and has only that id plus the destination-zone card to go on. */
export function backFaceDefinitionIdOf(frontId: string): string | undefined {
    const frontDef = tryGetDefinition(frontId);
    const backFace = frontDef?.backFace;
    if (!backFace) return undefined;
    return isModalDoubleFaced(frontDef ?? undefined)
        ? modalBackFaceDefinitionId(frontId)
        : nonmodalBackFaceDefinitionId(backFace);
}

/** Registers (idempotently, `registerTokenDefinition`) a synthesized
 *  `CardDefinition` for `backFace` and returns its id. Two permanents
 *  transforming from the SAME front definition with the SAME back-face spec
 *  share one entry (`tokenDefinitionId`'s content-hash convention). */
function registerBackFaceDefinition(backFace: CardBackFace): string {
    const spec = backFaceAsTokenSpec(backFace);
    const id = nonmodalBackFaceDefinitionId(backFace);
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
        // CR 306.5b — read back off `spec` (never re-derived from `backFace`
        // here) for the same reason `imagePrintFace` is below: this is the
        // SAME value `tokenDefinitionId(spec)` folded into `id`, so the
        // server-side registration and a client-side decode of `id` agree.
        ...(spec.loyalty !== undefined ? { loyalty: spec.loyalty } : {}),
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

/** Stamps the BACK-face identity onto a card that is about to ENTER the
 *  battlefield already transformed — the sibling of `transformPermanent`
 *  below, for "exile it, then return it to the battlefield transformed"
 *  (CR 712 / 400.7; the ORI flip-walker cycle, issue #2380).
 *
 *  Deliberately NOT a call into `transformPermanent`, and not a flag on it:
 *  the two model DIFFERENT object identities. `transformPermanent` flips a
 *  permanent that never left the battlefield (CR 712.8a) — the SAME object
 *  keeps its counters, attachments, summoning-sickness clock and every
 *  "leaves the battlefield" reference to it. This one runs on a card sitting
 *  in EXILE, between a real zone change out of the battlefield and a real
 *  zone change back in, so the permanent that appears is a NEW object (CR
 *  400.7): its counters are already gone, its Auras/Equipment already
 *  detached, its ETB triggers fire again, and anything that referenced the
 *  old permanent no longer finds it. Collapsing the two would silently give
 *  one of them the other's identity semantics.
 *
 *  `card` must NOT be on the battlefield — the caller (`SpellContext
 *  .exileAndReturnTransformed`, `gre/state.ts`) has already moved it out
 *  through the ordinary battlefield-departure funnel. Returns false (leaving
 *  `card` untouched) when the current face declares no `backFace`, so the
 *  caller still returns an untransformed card rather than losing it.
 *
 *  The identity swap itself goes through the SAME
 *  `registerBackFaceDefinition` + `rebuildCopiableValuesAndReplayOverlays`
 *  pair `transformPermanent` uses — one definition codec, one copiable-values
 *  rebuild. There are no layer 2–7 overlays left to replay on a card that has
 *  just left the battlefield (`resetBattlefieldTransientState` cleared them),
 *  so the replay is a no-op here; it is called anyway rather than hand-rolling
 *  a second, subtly-different field assignment. */
export function stampBackFaceForEntry(
    state: LayerStateView,
    card: CardInstanceState
): boolean {
    if (card.transformed) return false; // already showing its back face
    const frontId = (card.card as { id?: string }).id;
    if (!frontId) return false;
    const backFace = tryGetDefinition(frontId)?.backFace;
    if (!backFace) return false; // CR 712 — nothing to transform into.
    const backId = registerBackFaceDefinition(backFace);
    card.transformedFrom = frontId;
    card.card = { id: backId };
    rebuildCopiableValuesAndReplayOverlays(state, card, {
        types: [...backFace.types],
        subtypes: backFace.subtypes ? [...backFace.subtypes] : [],
        power: backFace.power,
        toughness: backFace.toughness,
        staticAbilities: backFace.staticAbilities
            ? [...backFace.staticAbilities]
            : [],
    });
    card.transformed = true;
    return true;
}

/** CR 712.12 / 712.8f — stamps the MODAL back-face identity onto a card that
 *  is about to enter the battlefield as that face, because its controller
 *  chose it as the land they are playing (ADR 0122 §2).
 *
 *  The sibling of {@link stampBackFaceForEntry} above and deliberately a
 *  separate function, because the two reach DIFFERENT definitions by different
 *  routes. That one synthesizes a nonmodal face through
 *  `registerBackFaceDefinition`'s content-derived id codec, which carries a
 *  `TokenSpec`'s fields and nothing else. A modal face is a whole card face —
 *  Soporific Springs has an entry replacement AND a mana ability — so it is a
 *  module-registered twin under `${parentId}#back` (`cards/modalDfc.ts`),
 *  already in the registry before this runs, and there is no spec to encode.
 *
 *  What it SHARES is the markers, and that is the point: `transformed` +
 *  `transformedFrom` are what the battlefield-departure funnel
 *  (`removePermanentTo` → {@link revertTransform}) reads, so a Soporific
 *  Springs that dies, is bounced or is exiled leaves as Sink into Stupor with
 *  no new code at all — which is exactly CR 712.8a ("while a double-faced card
 *  is … in a zone other than the battlefield or stack, it has only the
 *  characteristics of its front face").
 *
 *  `card` must NOT yet be on the battlefield: every caller
 *  (`gre/playLand.ts`) stamps between the CR 712.12 face choice and the zone
 *  move, inside one synchronous transition, so nothing ever observes a card in
 *  hand wearing its back face. Returns false, leaving `card` untouched, when
 *  the twin does not resolve — the caller then plays the front face, which is
 *  the only other thing it could legally be. */
export function stampModalBackFaceForPlay(
    state: LayerStateView,
    card: CardInstanceState
): boolean {
    const frontId = (card.card as { id?: string }).id;
    if (!frontId) return false;
    const frontDef = tryGetDefinition(frontId);
    if (!isModalDoubleFaced(frontDef ?? undefined)) return false;
    const backId = modalBackFaceDefinitionId(frontId);
    const backDef = tryGetDefinition(backId);
    if (!backDef) return false;
    card.transformedFrom = frontId;
    card.card = { id: backId };
    rebuildCopiableValuesAndReplayOverlays(state, card, {
        types: [...backDef.types],
        subtypes: backDef.subtypes ? [...backDef.subtypes] : [],
        power: backDef.power,
        toughness: backDef.toughness,
        staticAbilities: backDef.staticAbilities
            ? [...backDef.staticAbilities]
            : [],
    });
    card.transformed = true;
    return true;
}

/** Reverts a permanent showing its BACK face to its FRONT face (CR 712.8a —
 *  while a double-faced card is outside the game or in a zone other than the
 *  battlefield or the stack, it has only the characteristics of its FRONT
 *  face).
 *
 *  The transform sibling of `revertCopy` (CR 707.2, `gre/copy.ts`), and
 *  deliberately the same shape: it is called on the DEPARTURE side, from the
 *  single battlefield-departure funnel (`removePermanentTo`, `gre/state.ts`),
 *  so the card that lands in the graveyard / hand / library / exile is the
 *  front-face card that a later reanimation, re-cast or blink must see.
 *  Without it a flipped planeswalker bounced to hand stays a Legendary
 *  Planeswalker CARD in hand, whose synthesized back-face definition rebuilds
 *  with a colour-derived mana cost and the back face's loyalty abilities.
 *
 *  It must NOT move into `resetBattlefieldTransientState`: that helper also
 *  runs on battlefield ENTRY (`stageReanimatedOnBattlefield`), where it would
 *  wipe a back-face stamp `stampBackFaceForEntry` deliberately applied while
 *  the card sat in exile ("exile it, then return it transformed", issue
 *  #2380). Departure reverts; the stamp runs afterwards and wins.
 *
 *  Also the back → front leg of `transformPermanent` below (CR 701.27 — the
 *  SAME toggle flips either direction), which is why this is one function and
 *  not two.
 *
 *  Returns false, leaving `card` untouched, when it is not showing a back face
 *  (the overwhelmingly common case) or when `transformedFrom` is
 *  missing/unregistered — shouldn't happen in practice, since it is only ever
 *  set to a definition id the transform machinery had just resolved. */
export function revertTransform(
    state: LayerStateView,
    card: CardInstanceState
): boolean {
    if (!card.transformed) return false;
    const frontId = card.transformedFrom;
    if (!frontId) return false;
    const frontDef = tryGetDefinition(frontId);
    if (!frontDef) return false;
    card.card = { id: frontId };
    rebuildCopiableValuesAndReplayOverlays(state, card, {
        types: [...frontDef.types],
        subtypes: frontDef.subtypes ? [...frontDef.subtypes] : [],
        power: frontDef.power,
        toughness: frontDef.toughness,
        staticAbilities: frontDef.staticAbilities
            ? [...frontDef.staticAbilities]
            : [],
    });
    delete card.transformed;
    delete card.transformedFrom;
    return true;
}

/** Transforms `card` in place (CR 701.27 / 712): flips it to its back face
 *  if currently showing front, or back to front if already transformed (CR
 *  712.8a — the SAME primitive flips either direction). No-op when the
 *  permanent's CURRENT face declares no `backFace` to flip to (front → back)
 *  or when `transformedFrom` is missing/unregistered (back → front,
 *  shouldn't happen in practice — `transformedFrom` is only ever set by this
 *  same function to a definition id it just resolved). */
export function transformPermanent(
    state: LayerStateView,
    card: CardInstanceState
): void {
    if (!card.transformed) {
        const frontId = (card.card as { id?: string }).id;
        if (!frontId) return;
        const frontDef = tryGetDefinition(frontId);
        const backFace = frontDef?.backFace;
        if (!backFace) return; // CR 712 — nothing to transform into.
        // CR 712.10 — "if a spell or ability instructs a player to transform a
        // permanent, and the face that permanent would transform into is an
        // instant or sorcery card face … nothing happens." No printed NONMODAL
        // back face is one, so this leg is latent for the 401 transform cards;
        // it is stated because the modal kind makes the mirror leg below live.
        if (!isPermanentTypeLine(backFace.types)) return;
        // CR 712.3 / 712.8f (ADR 0122 §1) — a MODAL back face is already a
        // registered twin, so transform points at THAT definition rather than
        // minting a second one through the token codec. One face, one
        // definition: a codec-synthesized copy would carry neither the face's
        // entry replacement nor its twin id, so a permanent flipped here and a
        // permanent PLAYED as that face would be two different objects wearing
        // one name.
        const backId = isModalDoubleFaced(frontDef ?? undefined)
            ? modalBackFaceDefinitionId(frontId)
            : registerBackFaceDefinition(backFace);
        card.transformedFrom = frontId;
        card.card = { id: backId };
        // CR 701.27b / 712 — transforming is the SAME permanent (CR 400.7
        // needs a zone change), so only its copiable values change; the
        // permanent's own layers 2–7 are replayed on top (issue #1705).
        rebuildCopiableValuesAndReplayOverlays(state, card, {
            types: [...backFace.types],
            subtypes: backFace.subtypes ? [...backFace.subtypes] : [],
            power: backFace.power,
            toughness: backFace.toughness,
            staticAbilities: backFace.staticAbilities
                ? [...backFace.staticAbilities]
                : [],
        });
        card.transformed = true;
    } else {
        // CR 712.10 — the live leg of the same clause, and the reason it is
        // stated at all: a MODAL permanent showing its land back face reverts
        // to its FRONT face, which for Sink into Stupor is an INSTANT card
        // face. "Nothing happens" — without this, an effect that transforms
        // target permanent would leave an Instant sitting on the battlefield
        // (ADR 0122). CR 712.8a's departure revert is a different question and
        // is not gated by this: a card LEAVING the battlefield has no face up
        // at all, and `revertTransform`'s own caller there is
        // `removePermanentTo`.
        const frontId = card.transformedFrom;
        const frontDef = frontId ? tryGetDefinition(frontId) : undefined;
        if (frontDef && !isPermanentTypeLine(frontDef.types)) return;
        // Back → front is exactly the CR 712.8a restore, so it IS that
        // function — one front-face rebuild, not two that can drift apart.
        revertTransform(state, card);
    }
}
