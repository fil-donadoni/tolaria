// CR 712.11b — casting the BACK face of a modal double-faced card (issue
// #7200).
//
// "A player casting a modal double-faced card or a copy of a modal
// double-faced card as a spell chooses which face they are casting before
// putting it onto the stack." That choice is announced the way the split half
// (`splitCast.ts`) and the Adventure (`adventure.ts`) announce theirs: as an
// `alternativeCostId`, the ONE string that says which cast option was taken
// (`gre/castPermissions.ts` names its consumers as an invariant). The front
// face is the printed cast, untouched — CR 712.11 ("cast with its front face
// up by default").
//
// The three subrules that make it a cast MODE rather than a price:
//
//   * CR 712.11c — "only the face that will be face up on the stack is
//     evaluated to determine if it can be cast." The `subject` member of
//     `CAST_MODE_CENSUS` (`castMode.ts`), so timing, affordability and
//     targeting all judge the back TWIN before any stack item exists.
//   * CR 712.8f — "while a modal double-faced spell is on the stack or a modal
//     double-faced permanent is on the battlefield, it has only the
//     characteristics of the face that's up." The stamp swaps the stack item's
//     identity to the twin with the SAME markers the land play writes
//     (`stampModalBackFace`, `gre/transform.ts`), so a permanent spell
//     resolves onto the battlefield back face up and leaves it through the
//     existing `revertTransform` funnel with no new code.
//   * CR 712.8a — "in a zone other than the battlefield or stack, it has only
//     the characteristics of its front face." A back-face spell that leaves
//     the stack for anywhere else (it resolved as an instant or sorcery, was
//     countered, fizzled, was bounced) reverts at the stack-departure
//     chokepoints in `state.ts`, beside the Adventure and split reverts.
//
// A LAND back face offers no cast at all: CR 305.1 — a land is played, and
// "it is never a spell" (CR 712.12, `gre/modalLandPlay.ts`).

import { tryGetDefinition } from "../cards";
import {
    isModalDoubleFaced,
    modalBackFaceDefinitionId,
    modalBackFaceParentId,
} from "../cards/modalDfc";
import type { AlternativeCost, CardDefinition } from "../cards/types";
import type { LayerStateView } from "./layers";
import type { CardInstanceState } from "./state/declarations";
import { stampModalBackFace } from "./transform";

/** Namespace prefix for the `alternativeCostId` that announces a modal back
 *  face's cast. Mirrors `SPLIT_CAST_ALT_COST_PREFIX`'s shape so the namespaced
 *  spaces and the card-declared one cannot collide. */
export const MODAL_BACK_CAST_ALT_COST_PREFIX = "modal-back:";

/** The `alternativeCostId` that announces `def`'s back-face cast. Carries the
 *  PARENT's id, because that is what a search `Move` transports and what the
 *  stamp needs to resolve the twin. */
export function modalBackCastAltCostId(def: CardDefinition): string {
    return `${MODAL_BACK_CAST_ALT_COST_PREFIX}${def.id}`;
}

/** CR 712.11b — the registered back-face twin of `def` when that face can be
 *  CAST, else `undefined`: not a modal card, a twin that failed to hydrate, or
 *  a LAND back face (CR 305.1 — played, never a spell). */
export function castableModalBackTwin(
    def: CardDefinition | undefined
): CardDefinition | undefined {
    if (!def || !isModalDoubleFaced(def)) return undefined;
    const twin = tryGetDefinition(modalBackFaceDefinitionId(def.id));
    if (!twin || twin.types.includes("Land")) return undefined;
    return twin;
}

/** `true` when `altCostId` announces THIS card's back-face cast. Fail-closed,
 *  like `isSplitCastId`: a card declaring an ordinary `alternativeCosts[]`
 *  entry with a colliding id cannot smuggle an identity swap onto a card with
 *  no castable back face. */
export function isModalBackCastId(
    def: CardDefinition | undefined,
    altCostId: string | undefined
): boolean {
    if (altCostId === undefined || !castableModalBackTwin(def)) return false;
    return altCostId === modalBackCastAltCostId(def!);
}

/** CR 712.11b — the synthesized cast option for `def`'s back face, or
 *  `undefined` for a card that has none. The cost IS the back face's own
 *  printed mana cost (CR 712.8f): an alternative cost in the CR 118.9 sense
 *  only because the engine has one channel for "this cast announces
 *  something other than the printed spell". */
export function modalBackCastAlternativeCost(
    def: CardDefinition | undefined
): AlternativeCost | undefined {
    const twin = castableModalBackTwin(def);
    if (!twin) return undefined;
    return {
        id: modalBackCastAltCostId(def!),
        // The picker row names the face being cast — the one thing the player
        // is choosing. `alt-cost-picker.tsx` renders `description` verbatim.
        description: `Cast ${twin.name} — ${twin.oracleText ?? ""}`.trim(),
        ...(twin.manaCost ? { mana: twin.manaCost } : {}),
    };
}

/** The back-face cast option on `card` (zero or one) — the instance-level
 *  entry point `independentCastOptionsFor` (`castMode.ts`) reads, mirroring
 *  `splitCastOptionsFor`.
 *
 *  HAND only. A cast from any other zone is licensed by a permission
 *  (Yawgmoth's Will, Bolas's Citadel, an impulse exile) or by an ability of
 *  the FRONT face (flashback, escape), and CR 712.11c evaluates only the face
 *  being cast — so whether each licence reaches the back face is a per-zone
 *  question this module does not answer yet (issue #7398). Withholding the
 *  option keeps every offering surface and the Bot from reaching a cast
 *  `announceCast` refuses. */
export function modalBackCastOptionsFor(
    card: CardInstanceState
): AlternativeCost[] {
    if (card.zone !== "hand") return [];
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return [];
    const alt = modalBackCastAlternativeCost(
        tryGetDefinition(cardId) ?? undefined
    );
    return alt ? [alt] : [];
}

/** CR 712.8f — "while a modal double-faced spell is on the stack … it has
 *  only the characteristics of the face that's up." Stamps the back-face
 *  identity onto the freshly-built stack item. Idempotent, like every census
 *  stamper: an item already showing a face is left alone. */
export function castAsModalBack(
    state: LayerStateView,
    item: CardInstanceState
): void {
    if (item.transformed) return;
    stampModalBackFace(state, item);
}

/** CR 712.8a — the spell leaves the stack for a zone other than the
 *  battlefield, so it has only its FRONT face's characteristics again.
 *  State-free, like `revertSplitIdentity`, because it runs at
 *  `resetStackTransientState`: on the stack the object carries no overlays,
 *  so the front identity is written outright and the layer bases are dropped
 *  for the next reader to recapture. A no-op on every item not cast as a back
 *  face — keyed on the twin id, so a transformed NONMODAL object is never
 *  touched here. */
export function revertModalBackCastIdentity(item: CardInstanceState): void {
    const cardId = (item.card as { id?: string }).id;
    const parentId = cardId ? modalBackFaceParentId(cardId) : undefined;
    if (!item.transformed || parentId === undefined) return;
    const def = tryGetDefinition(parentId);
    if (!def) return;
    delete item.transformed;
    delete item.transformedFrom;
    item.card = { id: def.id };
    item.types = [...def.types];
    item.subtypes = [...(def.subtypes ?? [])];
    item.staticAbilities = [...(def.staticAbilities ?? [])];
    delete item.baseTypes;
    delete item.baseSubtypes;
    delete item.baseStaticAbilities;
    if (def.power !== undefined) item.power = def.power;
    else delete item.power;
    if (def.toughness !== undefined) item.toughness = def.toughness;
    else delete item.toughness;
}
